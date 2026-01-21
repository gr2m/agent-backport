import { sleep, FatalError } from "workflow";
import { getInstallationOctokit } from "@/lib/github";

export interface BackportParams {
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

/**
 * Main backport workflow
 *
 * This workflow handles the entire backport process:
 * 1. Fetch PR details and commits
 * 2. Analyze the changes and target branch
 * 3. Create a sandbox and perform git operations
 * 4. Handle any conflicts with AI assistance
 * 5. Create the result PR or report failure
 */
export async function backportPullRequest(
  params: BackportParams
): Promise<BackportResult> {
  "use workflow";

  const { installationId, repository, prNumber, targetBranch, commentId } =
    params;

  // Step 1: Acknowledge the request
  await acknowledgeRequest(installationId, repository, commentId);

  // Step 2: Fetch PR details
  const prDetails = await fetchPRDetails(installationId, repository, prNumber);

  // Step 3: Validate target branch exists
  await validateTargetBranch(installationId, repository, targetBranch);

  // Step 4: Analyze the changes (AI-powered)
  const analysis = await analyzeChanges(prDetails, targetBranch);

  // Step 5: Perform the backport in a sandbox
  const backportResult = await performBackport(
    installationId,
    repository,
    prDetails,
    targetBranch,
    analysis
  );

  // Step 6: Create result PR or report failure
  if (backportResult.success) {
    const resultPR = await createBackportPR(
      installationId,
      repository,
      prNumber,
      targetBranch,
      backportResult.branch!
    );

    await reportSuccess(
      installationId,
      repository,
      prNumber,
      resultPR,
      targetBranch
    );

    return { success: true, resultPR };
  } else {
    await reportFailure(
      installationId,
      repository,
      prNumber,
      targetBranch,
      backportResult.error!
    );

    return { success: false, error: backportResult.error };
  }
}

// Step implementations (stubs for now)

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
) {
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

  return {
    title: pr.title,
    body: pr.body,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
    })),
    merged: pr.merged,
    mergeCommitSha: pr.merge_commit_sha,
  };
}

async function validateTargetBranch(
  installationId: number,
  repository: string,
  targetBranch: string
) {
  "use step";
  const octokit = await getInstallationOctokit(installationId);
  const [owner, repo] = repository.split("/");

  try {
    await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch: targetBranch,
    });
  } catch (error) {
    throw new FatalError(`Target branch '${targetBranch}' does not exist`);
  }
}

async function analyzeChanges(prDetails: any, targetBranch: string) {
  "use step";
  // TODO: Implement AI-powered analysis
  return {
    complexity: "low",
    potentialConflicts: [],
    recommendations: [],
  };
}

async function performBackport(
  installationId: number,
  repository: string,
  prDetails: any,
  targetBranch: string,
  analysis: any
): Promise<{ success: boolean; branch?: string; error?: string }> {
  "use step";
  // TODO: Implement sandbox-based git operations
  return {
    success: false,
    error: "Backport execution not yet implemented",
  };
}

async function createBackportPR(
  installationId: number,
  repository: string,
  sourcePR: number,
  targetBranch: string,
  backportBranch: string
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
    body: `This is an automated backport of #${sourcePR} to \`${targetBranch}\`.\n\nCreated by agent-backport.`,
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
