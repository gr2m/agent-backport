import { sleep, FatalError } from "workflow";
import { getInstallationOctokit } from "@/lib/github";
import { updateJob, addJobLog } from "@/lib/jobs";
import {
  analyzeDiff,
  analyzeBackportFeasibility,
  generateBackportPRDescription,
  type DiffAnalysis,
  type BackportAnalysis,
} from "@/lib/ai";
import { executeBackport, getGitCredentials } from "@/lib/sandbox";

export interface BackportParams {
  jobId: string;
  installationId: number;
  repository: string;
  prNumber: number;
  targetBranch: string;
  commentId: number;
}

export interface BackportResult {
  success: boolean;
  resultPR?: number;
  error?: string;
}

interface PRDetails {
  title: string;
  body: string | null;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  commits: Array<{ sha: string; message: string }>;
  merged: boolean;
  mergeCommitSha: string | null;
  diff: string;
}

interface AnalysisResult {
  diffAnalysis: DiffAnalysis;
  backportAnalysis: BackportAnalysis;
}

/**
 * Main backport workflow
 *
 * This workflow handles the entire backport process:
 * 1. Fetch PR details and commits
 * 2. Analyze the changes and target branch with AI
 * 3. Create a sandbox and perform git operations
 * 4. Handle any conflicts with AI assistance
 * 5. Create the result PR or report failure
 */
export async function backportPullRequest(
  params: BackportParams
): Promise<BackportResult> {
  "use workflow";

  const { jobId, installationId, repository, prNumber, targetBranch, commentId } =
    params;

  try {
    // Step 1: Acknowledge the request
    await acknowledgeRequest(installationId, repository, commentId);
    await addJobLog(jobId, "Request acknowledged");

    // Step 2: Fetch PR details
    await addJobLog(jobId, "Fetching PR details...");
    const prDetails = await fetchPRDetails(installationId, repository, prNumber);
    await addJobLog(jobId, `PR title: ${prDetails.title}`);
    await addJobLog(jobId, `Commits: ${prDetails.commits.length}`);

    // Step 3: Validate target branch exists
    await addJobLog(jobId, `Validating target branch: ${targetBranch}`);
    const targetBranchInfo = await validateTargetBranch(
      installationId,
      repository,
      targetBranch
    );
    await addJobLog(jobId, "Target branch exists");

    // Step 4: Analyze the changes with AI
    await addJobLog(jobId, "Analyzing changes with AI...");
    const analysis = await analyzeChangesWithAI(
      prDetails,
      targetBranch,
      targetBranchInfo.context
    );
    await addJobLog(jobId, `AI Analysis complete:`);
    await addJobLog(jobId, `  - Change type: ${analysis.diffAnalysis.changeType}`);
    await addJobLog(jobId, `  - Complexity: ${analysis.diffAnalysis.complexity}`);
    await addJobLog(jobId, `  - Can backport: ${analysis.backportAnalysis.canBackport}`);
    await addJobLog(
      jobId,
      `  - Confidence: ${Math.round(analysis.backportAnalysis.confidence * 100)}%`
    );
    await addJobLog(
      jobId,
      `  - Estimated effort: ${analysis.backportAnalysis.estimatedEffort}`
    );

    // Check if AI thinks backport is not feasible
    if (
      !analysis.backportAnalysis.canBackport &&
      analysis.backportAnalysis.confidence > 0.8
    ) {
      const reasons = analysis.backportAnalysis.potentialConflicts
        .map((c) => `- ${c.file}: ${c.reason}`)
        .join("\n");
      const error = `AI analysis indicates this backport may not be feasible:\n${reasons}\n\nRecommendations:\n${analysis.backportAnalysis.recommendations.join("\n")}`;

      await addJobLog(jobId, `Backport not recommended by AI: ${error}`);
      await reportFailure(installationId, repository, prNumber, targetBranch, error);
      await updateJob(jobId, { status: "failed", error });

      return { success: false, error };
    }

    // Step 5: Perform the backport in a sandbox
    await addJobLog(jobId, "Performing backport in sandbox...");
    const backportResult = await performBackport(
      installationId,
      repository,
      prNumber,
      prDetails,
      targetBranch,
      analysis,
      jobId
    );

    // Step 6: Create result PR or report failure
    if (backportResult.success) {
      await addJobLog(jobId, "Backport successful, creating PR...");

      // Generate AI-powered PR description
      const prDescription = await generateBackportPRDescription(
        { title: prDetails.title, number: prNumber, body: prDetails.body },
        repository,
        targetBranch,
        analysis.diffAnalysis,
        analysis.backportAnalysis
      );

      const resultPR = await createBackportPR(
        installationId,
        repository,
        prNumber,
        targetBranch,
        backportResult.branch!,
        prDescription
      );

      await reportSuccess(
        installationId,
        repository,
        prNumber,
        resultPR,
        targetBranch
      );

      await updateJob(jobId, {
        status: "completed",
        resultPR,
      });
      await addJobLog(jobId, `Backport PR created: #${resultPR}`);

      return { success: true, resultPR };
    } else {
      await addJobLog(jobId, `Backport failed: ${backportResult.error}`);
      await reportFailure(
        installationId,
        repository,
        prNumber,
        targetBranch,
        backportResult.error!
      );

      await updateJob(jobId, {
        status: "failed",
        error: backportResult.error,
      });

      return { success: false, error: backportResult.error };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await addJobLog(jobId, `Workflow error: ${errorMessage}`);
    await updateJob(jobId, {
      status: "failed",
      error: errorMessage,
    });

    // Re-throw to let workflow handle it
    throw error;
  }
}

// Step implementations

async function acknowledgeRequest(
  installationId: number,
  repository: string,
  commentId: number
) {
  "use step";
  const octokit = await getInstallationOctokit(installationId);
  const [owner, repo] = repository.split("/");

  // React to the comment to acknowledge
  await octokit.rest.reactions.createForIssueComment({
    owner,
    repo,
    comment_id: commentId,
    content: "eyes",
  });
}

async function fetchPRDetails(
  installationId: number,
  repository: string,
  prNumber: number
): Promise<PRDetails> {
  "use step";
  const octokit = await getInstallationOctokit(installationId);
  const [owner, repo] = repository.split("/");

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  const { data: commits } = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number: prNumber,
  });

  // Get the diff for AI analysis
  const { data: diff } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: {
      format: "diff",
    },
  });

  return {
    title: pr.title,
    body: pr.body,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
    })),
    merged: pr.merged,
    mergeCommitSha: pr.merge_commit_sha,
    diff: diff as unknown as string,
  };
}

async function validateTargetBranch(
  installationId: number,
  repository: string,
  targetBranch: string
): Promise<{ sha: string; context: string }> {
  "use step";
  const octokit = await getInstallationOctokit(installationId);
  const [owner, repo] = repository.split("/");

  try {
    const { data: branch } = await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch: targetBranch,
    });

    // Get some context about the target branch (recent commits)
    const { data: commits } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      sha: targetBranch,
      per_page: 5,
    });

    const context = `Target branch: ${targetBranch}\nRecent commits:\n${commits
      .map((c) => `- ${c.sha.slice(0, 7)}: ${c.commit.message.split("\n")[0]}`)
      .join("\n")}`;

    return { sha: branch.commit.sha, context };
  } catch (error) {
    throw new FatalError(`Target branch '${targetBranch}' does not exist`);
  }
}

async function analyzeChangesWithAI(
  prDetails: PRDetails,
  targetBranch: string,
  targetBranchContext: string
): Promise<AnalysisResult> {
  "use step";

  // First, analyze the diff
  const diffAnalysis = await analyzeDiff(
    prDetails.diff,
    prDetails.title,
    prDetails.body
  );

  // Then, analyze backport feasibility
  const backportAnalysis = await analyzeBackportFeasibility(
    prDetails.diff,
    diffAnalysis,
    prDetails.baseBranch,
    targetBranch,
    targetBranchContext
  );

  return { diffAnalysis, backportAnalysis };
}

async function performBackport(
  installationId: number,
  repository: string,
  prNumber: number,
  prDetails: PRDetails,
  targetBranch: string,
  analysis: AnalysisResult,
  jobId: string
): Promise<{ success: boolean; branch?: string; error?: string }> {
  "use step";

  const octokit = await getInstallationOctokit(installationId);

  // Get git credentials for sandbox operations
  const gitCredentials = await getGitCredentials(octokit);

  // Execute backport in sandbox
  const result = await executeBackport(
    {
      repository,
      targetBranch,
      commits: prDetails.commits,
      prNumber,
      diffAnalysis: analysis.diffAnalysis,
      gitCredentials,
    },
    async (message) => {
      await addJobLog(jobId, `[Sandbox] ${message}`);
    }
  );

  if (result.resolvedConflicts && result.resolvedConflicts > 0) {
    await addJobLog(
      jobId,
      `AI resolved ${result.resolvedConflicts} conflict(s) automatically`
    );
  }

  return result;
}

async function createBackportPR(
  installationId: number,
  repository: string,
  sourcePR: number,
  targetBranch: string,
  backportBranch: string,
  description: string
): Promise<number> {
  "use step";
  const octokit = await getInstallationOctokit(installationId);
  const [owner, repo] = repository.split("/");

  const { data: pr } = await octokit.rest.pulls.create({
    owner,
    repo,
    title: `[Backport ${targetBranch}] Changes from #${sourcePR}`,
    head: backportBranch,
    base: targetBranch,
    body: description,
  });

  return pr.number;
}

async function reportSuccess(
  installationId: number,
  repository: string,
  prNumber: number,
  resultPR: number,
  targetBranch: string
) {
  "use step";
  const octokit = await getInstallationOctokit(installationId);
  const [owner, repo] = repository.split("/");

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: `✅ Successfully backported to \`${targetBranch}\`!\n\nSee #${resultPR}`,
  });
}

async function reportFailure(
  installationId: number,
  repository: string,
  prNumber: number,
  targetBranch: string,
  error: string
) {
  "use step";
  const octokit = await getInstallationOctokit(installationId);
  const [owner, repo] = repository.split("/");

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: `❌ Failed to backport to \`${targetBranch}\`.\n\n**Error:** ${error}\n\nPlease try backporting manually.`,
  });
}
