import { tool } from "ai";
import { z } from "zod";
import { getInstallationOctokit } from "@/lib/github";
import {
  executeBackport as executeBackportInSandbox,
  resolveConflictsInBranch as resolveConflictsInBranchInSandbox,
  getGitCredentials,
  type BackportConfig,
} from "@/lib/sandbox";
import type { DiffAnalysis } from "@/lib/ai";
import { addJobLog } from "@/lib/jobs";

// Context that will be provided to all tools via experimental_context
export interface SandboxToolContext {
  installationId: number;
  repository: string;
  jobId: string;
}

/**
 * Execute the backport operation in a sandbox environment
 * This clones the repo, cherry-picks commits, handles conflicts, and pushes
 */
export const executeBackport = tool({
  description:
    "Execute the backport operation in a secure sandbox. Clones the repository, cherry-picks commits from the source PR, handles any merge conflicts with AI assistance, and pushes the resulting branch.",
  inputSchema: z.object({
    targetBranch: z.string().describe("The branch to backport to"),
    prNumber: z.number().describe("The source PR number"),
    commits: z
      .array(
        z.object({
          sha: z.string().describe("Commit SHA"),
          message: z.string().describe("Commit message"),
        })
      )
      .describe("The commits to cherry-pick"),
    diffAnalysis: z
      .object({
        summary: z.string(),
        intent: z.string(),
        filesChanged: z.array(
          z.object({
            path: z.string(),
            changeType: z.enum(["added", "modified", "deleted", "renamed"]),
            description: z.string(),
          })
        ),
        changeType: z.enum([
          "bugfix",
          "feature",
          "refactor",
          "docs",
          "test",
          "config",
          "other",
        ]),
        complexity: z.enum(["low", "medium", "high"]),
        dependencies: z.array(z.string()),
        risks: z.array(z.string()),
      })
      .describe("The diff analysis from the AI"),
  }),
  execute: async function (
    { targetBranch, prNumber, commits, diffAnalysis },
    { experimental_context }
  ) {
    "use step";

    const { installationId, repository, jobId } = experimental_context as SandboxToolContext;
    const octokit = await getInstallationOctokit(installationId);
    const gitCredentials = await getGitCredentials(octokit);

    // Create logging callback
    const onLog = async (message: string) => {
      await addJobLog(jobId, `[Sandbox] ${message}`);
    };

    const config: BackportConfig = {
      repository,
      targetBranch,
      commits,
      prNumber,
      diffAnalysis: diffAnalysis as DiffAnalysis,
      gitCredentials,
    };

    const result = await executeBackportInSandbox(config, onLog);

    return {
      success: result.success,
      branch: result.branch,
      error: result.error,
      conflictFiles: result.conflictFiles,
      resolvedConflicts: result.resolvedConflicts,
    };
  },
});

/**
 * Resolve conflicts in an existing backport branch
 * This fetches the conflicted branch, detects conflict markers, uses AI to resolve them, and pushes
 */
export const resolveConflictsInBranch = tool({
  description:
    "Resolve merge conflicts in an existing backport branch. Fetches the PR branch, detects conflict markers in files, uses AI to analyze and resolve each conflict, commits the changes, and pushes to remote.",
  inputSchema: z.object({
    prNumber: z.number().describe("The PR number with conflicts"),
    branchName: z.string().describe("The branch name containing conflicts"),
    baseBranch: z.string().describe("The base branch being merged into"),
  }),
  execute: async function (
    { prNumber, branchName, baseBranch },
    { experimental_context }
  ) {
    "use step";

    const { installationId, repository, jobId } = experimental_context as SandboxToolContext;
    const octokit = await getInstallationOctokit(installationId);
    const gitCredentials = await getGitCredentials(octokit);

    // Create logging callback
    const onLog = async (message: string) => {
      await addJobLog(jobId, `[Conflict Resolution] ${message}`);
    };

    const config = {
      repository,
      prNumber,
      branchName,
      baseBranch,
      gitCredentials,
    };

    const result = await resolveConflictsInBranchInSandbox(config, onLog);

    return {
      success: result.success,
      resolvedFiles: result.resolvedFiles,
      commitSha: result.commitSha,
      error: result.error,
    };
  },
});

export const sandboxTools = {
  executeBackport,
  resolveConflictsInBranch,
};
