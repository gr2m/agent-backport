import { tool } from "ai";
import { z } from "zod";
import { getInstallationOctokit } from "@/lib/github";
import { FatalError } from "workflow";

// Context that will be provided to all tools via experimental_context
export interface GitHubToolContext {
  installationId: number;
  repository: string;
}

/**
 * Fetch PR details including title, body, commits, and diff
 */
export const fetchPRDetails = tool({
  description:
    "Fetch details about a pull request including title, body, commits, and diff",
  inputSchema: z.object({
    prNumber: z.number().describe("The pull request number to fetch"),
  }),
  execute: async function ({ prNumber }, { experimental_context }) {
    "use step";
    const { installationId, repository } = experimental_context as GitHubToolContext;
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
  },
});

/**
 * Validate that a target branch exists and get context about it
 */
export const validateBranch = tool({
  description: "Check if a target branch exists and get context about it",
  inputSchema: z.object({
    branchName: z.string().describe("The branch name to validate"),
  }),
  execute: async function ({ branchName }, { experimental_context }) {
    "use step";
    const { installationId, repository } = experimental_context as GitHubToolContext;
    const octokit = await getInstallationOctokit(installationId);
    const [owner, repo] = repository.split("/");

    try {
      const { data: branch } = await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: branchName,
      });

      // Get some context about the target branch (recent commits)
      const { data: commits } = await octokit.rest.repos.listCommits({
        owner,
        repo,
        sha: branchName,
        per_page: 5,
      });

      const branchContext = `Target branch: ${branchName}\nRecent commits:\n${commits
        .map((c) => `- ${c.sha.slice(0, 7)}: ${c.commit.message.split("\n")[0]}`)
        .join("\n")}`;

      return {
        exists: true,
        sha: branch.commit.sha,
        context: branchContext,
      };
    } catch (error) {
      throw new FatalError(`Target branch '${branchName}' does not exist`);
    }
  },
});

/**
 * Create a pull request for the backport
 */
export const createPullRequest = tool({
  description: "Create a new pull request for the backport",
  inputSchema: z.object({
    title: z.string().describe("The title for the pull request"),
    headBranch: z.string().describe("The branch containing the changes"),
    baseBranch: z.string().describe("The target branch to merge into"),
    body: z.string().describe("The pull request description/body"),
  }),
  execute: async function ({ title, headBranch, baseBranch, body }, { experimental_context }) {
    "use step";
    const { installationId, repository } = experimental_context as GitHubToolContext;
    const octokit = await getInstallationOctokit(installationId);
    const [owner, repo] = repository.split("/");

    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      head: headBranch,
      base: baseBranch,
      body,
    });

    return {
      number: pr.number,
      url: pr.html_url,
    };
  },
});

/**
 * Add a reaction to a comment
 */
export const addReaction = tool({
  description: "Add a reaction emoji to a comment",
  inputSchema: z.object({
    commentId: z.number().describe("The comment ID to react to"),
    reaction: z
      .enum(["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes"])
      .describe("The reaction emoji to add"),
  }),
  execute: async function ({ commentId, reaction }, { experimental_context }) {
    "use step";
    const { installationId, repository } = experimental_context as GitHubToolContext;
    const octokit = await getInstallationOctokit(installationId);
    const [owner, repo] = repository.split("/");

    await octokit.rest.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: commentId,
      content: reaction,
    });

    return { success: true };
  },
});

/**
 * Post a comment on a pull request
 */
export const postComment = tool({
  description: "Post a comment on a pull request",
  inputSchema: z.object({
    prNumber: z.number().describe("The pull request number to comment on"),
    body: z.string().describe("The comment body (supports markdown)"),
  }),
  execute: async function ({ prNumber, body }, { experimental_context }) {
    "use step";
    const { installationId, repository } = experimental_context as GitHubToolContext;
    const octokit = await getInstallationOctokit(installationId);
    const [owner, repo] = repository.split("/");

    const { data: comment } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });

    return {
      id: comment.id,
      url: comment.html_url,
    };
  },
});

/**
 * Update an existing comment
 */
export const updateComment = tool({
  description: "Update an existing comment on a pull request",
  inputSchema: z.object({
    commentId: z.number().describe("The comment ID to update"),
    body: z.string().describe("The new comment body (supports markdown)"),
  }),
  execute: async function ({ commentId, body }, { experimental_context }) {
    "use step";
    const { installationId, repository } = experimental_context as GitHubToolContext;
    const octokit = await getInstallationOctokit(installationId);
    const [owner, repo] = repository.split("/");

    const { data: comment } = await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: commentId,
      body,
    });

    return {
      id: comment.id,
      url: comment.html_url,
    };
  },
});

/**
 * Create a progress comment with initial checklist
 */
export const createProgressComment = tool({
  description: "Create a progress comment with a task checklist that can be updated as the backport progresses",
  inputSchema: z.object({
    prNumber: z.number().describe("The pull request number to comment on"),
    targetBranch: z.string().describe("The target branch for the backport"),
    jobUrl: z.string().optional().describe("Optional URL to the job logs"),
  }),
  execute: async function ({ prNumber, targetBranch, jobUrl }, { experimental_context }) {
    "use step";
    const { installationId, repository } = experimental_context as GitHubToolContext;
    const octokit = await getInstallationOctokit(installationId);
    const [owner, repo] = repository.split("/");

    const footer = jobUrl
      ? `---\n<sub>[agent-backport](https://github.com/agent-backport/app) • [View logs](${jobUrl})</sub>`
      : `---\n<sub>[agent-backport](https://github.com/agent-backport/app)</sub>`;

    const body = `## Backport in Progress

- [x] Acknowledged request
- [ ] Fetching PR details
- [ ] Validating target branch \`${targetBranch}\`
- [ ] Analyzing changes
- [ ] Executing backport
- [ ] Creating PR

⏳ **Status:** Starting backport...

${footer}`;

    const { data: comment } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });

    return {
      id: comment.id,
      url: comment.html_url,
    };
  },
});

export const githubTools = {
  fetchPRDetails,
  validateBranch,
  createPullRequest,
  addReaction,
  postComment,
  updateComment,
  createProgressComment,
};
