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
    await sandbox.runCommand({
      cmd: "git",
      args: ["config", "--global", "user.email", "agent-backport@vercel.app"],
    });
    await sandbox.runCommand({
      cmd: "git",
      args: ["config", "--global", "user.name", "Agent Backport"],
    });

    // Clone the repository
    const repoUrl = `https://${config.gitCredentials.username}:${config.gitCredentials.token}@github.com/${config.repository}.git`;
    await onLog(`Cloning repository ${config.repository}...`);

    const cloneResult = await sandbox.runCommand({
      cmd: "git",
      args: ["clone", "--depth", "100", repoUrl, "repo"],
      cwd: "/vercel/sandbox",
    });

    if (cloneResult.exitCode !== 0) {
      const stderr = await cloneResult.stderr();
      throw new Error(`Failed to clone repository: ${stderr}`);
    }

    const repoPath = "/vercel/sandbox/repo";

    // Fetch all branches
    await onLog("Fetching branches...");
    await sandbox.runCommand({
      cmd: "git",
      args: ["fetch", "origin", config.targetBranch],
      cwd: repoPath,
    });

    // Checkout target branch
    await onLog(`Checking out target branch: ${config.targetBranch}...`);
    const checkoutResult = await sandbox.runCommand({
      cmd: "git",
      args: ["checkout", "-b", `backport-${config.prNumber}`, `origin/${config.targetBranch}`],
      cwd: repoPath,
    });

    if (checkoutResult.exitCode !== 0) {
      const stderr = await checkoutResult.stderr();
      throw new Error(`Failed to checkout target branch: ${stderr}`);
    }

    // Fetch the commits we need to cherry-pick
    for (const commit of config.commits) {
      await sandbox.runCommand({
        cmd: "git",
        args: ["fetch", "origin", commit.sha],
        cwd: repoPath,
      });
    }

    // Cherry-pick each commit
    const backportBranch = `backport-pr-${config.prNumber}-to-${config.targetBranch}`;
    let conflictFiles: string[] = [];
    let resolvedConflicts = 0;

    await onLog(`Cherry-picking ${config.commits.length} commit(s)...`);

    for (const commit of config.commits) {
      await onLog(`Cherry-picking commit ${commit.sha.slice(0, 7)}: ${commit.message.split("\n")[0]}`);

      const cherryPickResult = await sandbox.runCommand({
        cmd: "git",
        args: ["cherry-pick", "--no-commit", commit.sha],
        cwd: repoPath,
      });

      if (cherryPickResult.exitCode !== 0) {
        // Check for conflicts
        const statusResult = await sandbox.runCommand({
          cmd: "git",
          args: ["status", "--porcelain"],
          cwd: repoPath,
        });

        const status = await statusResult.stdout();
        const conflicting = status
          .split("\n")
          .filter((line) => line.startsWith("UU") || line.startsWith("AA") || line.startsWith("DD"))
          .map((line) => line.substring(3).trim());

        if (conflicting.length > 0) {
          await onLog(`Conflict detected in ${conflicting.length} file(s)`);
          conflictFiles = conflicting;

          // Try to resolve conflicts with AI
          for (const file of conflicting) {
            await onLog(`Attempting AI-assisted conflict resolution for: ${file}`);

            const resolved = await resolveConflictWithAI(
              sandbox,
              repoPath,
              file,
              commit.message,
              config.diffAnalysis.intent
            );

            if (resolved) {
              resolvedConflicts++;
              await onLog(`Successfully resolved conflict in: ${file}`);
            } else {
              await onLog(`Could not auto-resolve conflict in: ${file}`);
              // Abort and report failure
              await sandbox.runCommand({
                cmd: "git",
                args: ["cherry-pick", "--abort"],
                cwd: repoPath,
              });
              throw new Error(
                `Could not resolve merge conflict in ${file}. Manual intervention required.`
              );
            }
          }
        } else {
          const stderr = await cherryPickResult.stderr();
          throw new Error(`Cherry-pick failed: ${stderr}`);
        }
      }

      // Stage and commit the cherry-picked changes
      await sandbox.runCommand({
        cmd: "git",
        args: ["add", "-A"],
        cwd: repoPath,
      });

      const commitResult = await sandbox.runCommand({
        cmd: "git",
        args: [
          "commit",
          "-m",
          `${commit.message}\n\n(cherry picked from commit ${commit.sha})`,
        ],
        cwd: repoPath,
      });

      if (commitResult.exitCode !== 0) {
        // Check if there's nothing to commit (already applied)
        const status = await sandbox.runCommand({
          cmd: "git",
          args: ["status", "--porcelain"],
          cwd: repoPath,
        });
        const statusOutput = await status.stdout();
        if (statusOutput.trim() === "") {
          await onLog(`Commit ${commit.sha.slice(0, 7)} already applied, skipping...`);
          continue;
        }
        const stderr = await commitResult.stderr();
        throw new Error(`Failed to commit cherry-picked changes: ${stderr}`);
      }
    }

    // Rename branch to final name
    await sandbox.runCommand({
      cmd: "git",
      args: ["branch", "-m", backportBranch],
      cwd: repoPath,
    });

    // Push the branch
    await onLog(`Pushing branch ${backportBranch}...`);
    const pushResult = await sandbox.runCommand({
      cmd: "git",
      args: ["push", "origin", backportBranch],
      cwd: repoPath,
    });

    if (pushResult.exitCode !== 0) {
      const stderr = await pushResult.stderr();
      throw new Error(`Failed to push branch: ${stderr}`);
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
  changeIntent: string
): Promise<boolean> {
  try {
    // Read the conflicted file
    const fileBuffer = await sandbox.readFileToBuffer({
      path: filePath,
      cwd: repoPath,
    });

    if (!fileBuffer) {
      return false;
    }

    const conflictContent = fileBuffer.toString("utf-8");

    // Check if it has conflict markers
    if (
      !conflictContent.includes("<<<<<<<") ||
      !conflictContent.includes(">>>>>>>")
    ) {
      return false;
    }

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
    const resolution = await suggestConflictResolution(
      conflictContent,
      theirSection, // The changes we're trying to cherry-pick
      ourSection, // The target branch content
      changeIntent
    );

    // Only apply if confidence is high enough
    if (resolution.confidence < 0.7) {
      return false;
    }

    // Write the resolved content
    await sandbox.writeFiles([
      {
        path: `${repoPath}/${filePath}`,
        content: Buffer.from(resolution.resolvedContent, "utf-8"),
      },
    ]);

    // Stage the resolved file
    await sandbox.runCommand({
      cmd: "git",
      args: ["add", filePath],
      cwd: repoPath,
    });

    return true;
  } catch (error) {
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
