import { Sandbox } from "@vercel/sandbox";
import { suggestConflictResolution, type DiffAnalysis } from "./ai";

export interface BackportConfig {
  repository: string;
  targetBranch: string;
  commits: Array<{ sha: string; message: string }>;
  prNumber: number;
  diffAnalysis: DiffAnalysis;
  gitCredentials: {
    username: string;
    token: string;
  };
}

export interface BackportExecutionResult {
  success: boolean;
  branch?: string;
  error?: string;
  conflictFiles?: string[];
  resolvedConflicts?: number;
}

/**
 * Helper to run a git command with full logging
 */
async function runGitCommand(
  sandbox: Sandbox,
  args: string[],
  cwd: string,
  onLog: (message: string) => Promise<void>,
  options?: { maskToken?: string }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  // Log the command (masking sensitive data)
  let cmdDisplay = `git ${args.join(" ")}`;
  if (options?.maskToken) {
    cmdDisplay = cmdDisplay.replace(options.maskToken, "***");
  }
  await onLog(`$ ${cmdDisplay}`);

  const result = await sandbox.runCommand({
    cmd: "git",
    args,
    cwd,
  });

  const stdout = await result.stdout();
  const stderr = await result.stderr();

  // Log stdout if present
  if (stdout.trim()) {
    for (const line of stdout.trim().split("\n")) {
      await onLog(`  ${line}`);
    }
  }

  // Log stderr if present (git often outputs progress to stderr)
  if (stderr.trim()) {
    let stderrDisplay = stderr;
    if (options?.maskToken) {
      stderrDisplay = stderrDisplay.replace(options.maskToken, "***");
    }
    for (const line of stderrDisplay.trim().split("\n")) {
      await onLog(`  ${result.exitCode !== 0 ? "[ERROR] " : ""}${line}`);
    }
  }

  // Log exit code if non-zero
  if (result.exitCode !== 0) {
    await onLog(`  Exit code: ${result.exitCode}`);
  }

  return { exitCode: result.exitCode, stdout, stderr };
}

/**
 * Execute a backport operation in a Vercel Sandbox
 */
export async function executeBackport(
  config: BackportConfig,
  onLog: (message: string) => Promise<void>
): Promise<BackportExecutionResult> {
  let sandbox: Sandbox | null = null;

  try {
    await onLog("Creating sandbox environment...");

    // Create sandbox with git repository
    sandbox = await Sandbox.create({
      runtime: "node24",
      timeout: 5 * 60 * 1000, // 5 minutes
    });

    await onLog(`Sandbox created: ${sandbox.sandboxId}`);

    // Configure git
    await onLog("Configuring git...");
    await runGitCommand(
      sandbox,
      ["config", "--global", "user.email", "agent-backport@vercel.app"],
      "/vercel/sandbox",
      onLog
    );
    await runGitCommand(
      sandbox,
      ["config", "--global", "user.name", "Agent Backport"],
      "/vercel/sandbox",
      onLog
    );

    // Clone the repository
    const repoUrl = `https://${config.gitCredentials.username}:${config.gitCredentials.token}@github.com/${config.repository}.git`;
    await onLog(`Cloning repository ${config.repository}...`);

    const cloneResult = await runGitCommand(
      sandbox,
      ["clone", "--depth", "100", repoUrl, "repo"],
      "/vercel/sandbox",
      onLog,
      { maskToken: config.gitCredentials.token }
    );

    if (cloneResult.exitCode !== 0) {
      throw new Error(`Failed to clone repository: ${cloneResult.stderr}`);
    }

    const repoPath = "/vercel/sandbox/repo";

    // Fetch target branch explicitly (shallow clone doesn't include other branches)
    await onLog(`Fetching target branch: ${config.targetBranch}...`);
    const fetchBranchResult = await runGitCommand(
      sandbox,
      [
        "fetch",
        "--depth",
        "100",
        "origin",
        `${config.targetBranch}:refs/remotes/origin/${config.targetBranch}`,
      ],
      repoPath,
      onLog
    );

    if (fetchBranchResult.exitCode !== 0) {
      throw new Error(
        `Failed to fetch target branch '${config.targetBranch}': ${fetchBranchResult.stderr}`
      );
    }

    // Checkout target branch
    await onLog(`Checking out target branch: ${config.targetBranch}...`);
    const checkoutResult = await runGitCommand(
      sandbox,
      ["checkout", "-b", `backport-${config.prNumber}`, `origin/${config.targetBranch}`],
      repoPath,
      onLog
    );

    if (checkoutResult.exitCode !== 0) {
      throw new Error(`Failed to checkout target branch: ${checkoutResult.stderr}`);
    }

    // Fetch the commits we need to cherry-pick
    // Use --depth to ensure we can fetch commits even from deleted branches
    await onLog(`Fetching ${config.commits.length} commit(s) to cherry-pick...`);
    for (const commit of config.commits) {
      await onLog(`Fetching commit ${commit.sha.slice(0, 7)}...`);
      const fetchCommitResult = await runGitCommand(
        sandbox,
        ["fetch", "--depth", "1", "origin", commit.sha],
        repoPath,
        onLog
      );

      if (fetchCommitResult.exitCode !== 0) {
        throw new Error(
          `Failed to fetch commit ${commit.sha.slice(0, 7)}: ${fetchCommitResult.stderr}`
        );
      }
    }

    // Cherry-pick each commit
    const backportBranch = `backport-pr-${config.prNumber}-to-${config.targetBranch}`;
    let conflictFiles: string[] = [];
    let resolvedConflicts = 0;

    await onLog(`Cherry-picking ${config.commits.length} commit(s)...`);

    for (const commit of config.commits) {
      await onLog(`Cherry-picking commit ${commit.sha.slice(0, 7)}: ${commit.message.split("\n")[0]}`);

      const cherryPickResult = await runGitCommand(
        sandbox,
        ["cherry-pick", "--no-commit", commit.sha],
        repoPath,
        onLog
      );

      if (cherryPickResult.exitCode !== 0) {
        // Check for conflicts
        await onLog("Cherry-pick failed, checking for conflicts...");
        const statusResult = await runGitCommand(
          sandbox,
          ["status", "--porcelain"],
          repoPath,
          onLog
        );

        const conflicting = statusResult.stdout
          .split("\n")
          .filter((line) => line.startsWith("UU") || line.startsWith("AA") || line.startsWith("DD"))
          .map((line) => line.substring(3).trim());

        if (conflicting.length > 0) {
          await onLog(`Conflict detected in ${conflicting.length} file(s): ${conflicting.join(", ")}`);
          conflictFiles = conflicting;

          // Try to resolve conflicts with AI
          for (const file of conflicting) {
            await onLog(`Attempting AI-assisted conflict resolution for: ${file}`);

            const resolved = await resolveConflictWithAI(
              sandbox,
              repoPath,
              file,
              commit.message,
              config.diffAnalysis.intent,
              onLog
            );

            if (resolved) {
              resolvedConflicts++;
              await onLog(`Successfully resolved conflict in: ${file}`);
            } else {
              await onLog(`Could not auto-resolve conflict in: ${file}`);
              // Abort and report failure
              await onLog("Aborting cherry-pick...");
              await runGitCommand(
                sandbox,
                ["cherry-pick", "--abort"],
                repoPath,
                onLog
              );
              throw new Error(
                `Could not resolve merge conflict in ${file}. Manual intervention required.`
              );
            }
          }
        } else {
          throw new Error(`Cherry-pick failed: ${cherryPickResult.stderr}`);
        }
      }

      // Stage and commit the cherry-picked changes
      await onLog("Staging changes...");
      await runGitCommand(sandbox, ["add", "-A"], repoPath, onLog);

      await onLog("Committing cherry-picked changes...");
      const commitResult = await runGitCommand(
        sandbox,
        [
          "commit",
          "-m",
          `${commit.message}\n\n(cherry picked from commit ${commit.sha})`,
        ],
        repoPath,
        onLog
      );

      if (commitResult.exitCode !== 0) {
        // Check if there's nothing to commit (already applied)
        const statusResult = await runGitCommand(
          sandbox,
          ["status", "--porcelain"],
          repoPath,
          onLog
        );
        if (statusResult.stdout.trim() === "") {
          await onLog(`Commit ${commit.sha.slice(0, 7)} already applied, skipping...`);
          continue;
        }
        throw new Error(`Failed to commit cherry-picked changes: ${commitResult.stderr}`);
      }

      await onLog(`Successfully cherry-picked commit ${commit.sha.slice(0, 7)}`);
    }

    // Rename branch to final name
    await onLog(`Renaming branch to ${backportBranch}...`);
    await runGitCommand(sandbox, ["branch", "-m", backportBranch], repoPath, onLog);

    // Delete existing remote branch if it exists (from a previous failed attempt)
    await onLog(`Checking if remote branch ${backportBranch} already exists...`);
    const deleteResult = await runGitCommand(
      sandbox,
      ["push", "origin", "--delete", backportBranch],
      repoPath,
      onLog
    );
    if (deleteResult.exitCode === 0) {
      await onLog(`Deleted existing remote branch ${backportBranch}`);
    } else {
      await onLog(`No existing remote branch to delete (this is expected for new backports)`);
    }

    // Push the branch
    await onLog(`Pushing branch ${backportBranch}...`);
    const pushResult = await runGitCommand(
      sandbox,
      ["push", "origin", backportBranch],
      repoPath,
      onLog
    );

    if (pushResult.exitCode !== 0) {
      throw new Error(`Failed to push branch: ${pushResult.stderr}`);
    }

    await onLog("Backport completed successfully!");

    return {
      success: true,
      branch: backportBranch,
      conflictFiles: conflictFiles.length > 0 ? conflictFiles : undefined,
      resolvedConflicts: resolvedConflicts > 0 ? resolvedConflicts : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await onLog(`Backport failed: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    // Clean up sandbox
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Attempt to resolve a conflict using AI
 */
async function resolveConflictWithAI(
  sandbox: Sandbox,
  repoPath: string,
  filePath: string,
  commitMessage: string,
  changeIntent: string,
  onLog: (message: string) => Promise<void>
): Promise<boolean> {
  try {
    // Read the conflicted file
    await onLog(`Reading conflicted file: ${filePath}`);
    const fileBuffer = await sandbox.readFileToBuffer({
      path: filePath,
      cwd: repoPath,
    });

    if (!fileBuffer) {
      await onLog(`Failed to read file: ${filePath}`);
      return false;
    }

    const conflictContent = fileBuffer.toString("utf-8");
    await onLog(`File size: ${conflictContent.length} bytes`);

    // Check if it has conflict markers
    if (
      !conflictContent.includes("<<<<<<<") ||
      !conflictContent.includes(">>>>>>>")
    ) {
      await onLog("No conflict markers found in file");
      return false;
    }

    // Count conflict sections
    const conflictCount = (conflictContent.match(/<<<<<<</g) || []).length;
    await onLog(`Found ${conflictCount} conflict section(s)`);

    // Extract the context around conflicts
    const lines = conflictContent.split("\n");
    let inConflict = false;
    let conflictSection = "";
    let ourSection = "";
    let theirSection = "";

    for (const line of lines) {
      if (line.startsWith("<<<<<<<")) {
        inConflict = true;
        conflictSection = "";
        ourSection = "";
        theirSection = "";
      } else if (line.startsWith("=======") && inConflict) {
        ourSection = conflictSection;
        conflictSection = "";
      } else if (line.startsWith(">>>>>>>") && inConflict) {
        theirSection = conflictSection;
        inConflict = false;
      } else if (inConflict) {
        conflictSection += line + "\n";
      }
    }

    // Use AI to suggest resolution
    await onLog("Calling AI for conflict resolution...");
    const resolution = await suggestConflictResolution(
      conflictContent,
      theirSection, // The changes we're trying to cherry-pick
      ourSection, // The target branch content
      changeIntent
    );

    await onLog(`AI confidence: ${Math.round(resolution.confidence * 100)}%`);
    await onLog(`AI explanation: ${resolution.explanation}`);

    // Only apply if confidence is high enough
    if (resolution.confidence < 0.7) {
      await onLog("AI confidence too low (< 70%), skipping auto-resolution");
      return false;
    }

    // Write the resolved content
    await onLog("Writing resolved content...");
    await sandbox.writeFiles([
      {
        path: `${repoPath}/${filePath}`,
        content: Buffer.from(resolution.resolvedContent, "utf-8"),
      },
    ]);

    // Stage the resolved file
    await onLog("Staging resolved file...");
    await runGitCommand(sandbox, ["add", filePath], repoPath, onLog);

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await onLog(`AI conflict resolution failed: ${errorMessage}`);
    console.error("AI conflict resolution failed:", error);
    return false;
  }
}

/**
 * Get installation token for git operations
 */
export async function getGitCredentials(
  installationOctokit: any
): Promise<{ username: string; token: string }> {
  // Get installation access token
  const { data: installation } = await installationOctokit.rest.apps.getAuthenticated();

  // The installation token can be used with x-access-token as password
  const token = await installationOctokit.auth({ type: "installation" });

  return {
    username: "x-access-token",
    token: token.token,
  };
}
