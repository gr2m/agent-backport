import { tool } from "ai";
import { z } from "zod";
import {
  analyzeDiff as analyzeDiffAI,
  analyzeBackportFeasibility as analyzeBackportFeasibilityAI,
  generateBackportPRDescription as generateBackportPRDescriptionAI,
  type DiffAnalysis,
  type BackportAnalysis,
} from "@/lib/ai";

/**
 * Analyze a diff to understand what changes were made
 */
export const analyzeDiff = tool({
  description:
    "Analyze a git diff to understand what changes were made, their intent, complexity, and potential risks",
  inputSchema: z.object({
    diff: z.string().describe("The git diff content"),
    prTitle: z.string().describe("The pull request title"),
    prBody: z.string().nullable().describe("The pull request body/description"),
  }),
  execute: async function ({ diff, prTitle, prBody }) {
    "use step";

    const analysis = await analyzeDiffAI(diff, prTitle, prBody);

    return analysis;
  },
});

/**
 * Analyze whether a PR can be backported to a target branch
 */
export const analyzeBackportFeasibility = tool({
  description:
    "Analyze whether a PR can be cleanly backported to a target branch, predicting potential conflicts and estimating effort",
  inputSchema: z.object({
    diff: z.string().describe("The git diff content"),
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
      .describe("The previously computed diff analysis"),
    sourceBranch: z.string().describe("The source branch name"),
    targetBranch: z.string().describe("The target branch to backport to"),
    targetBranchContext: z
      .string()
      .describe("Context about the target branch (recent commits, etc.)"),
  }),
  execute: async function ({
    diff,
    diffAnalysis,
    sourceBranch,
    targetBranch,
    targetBranchContext,
  }) {
    "use step";

    const analysis = await analyzeBackportFeasibilityAI(
      diff,
      diffAnalysis as DiffAnalysis,
      sourceBranch,
      targetBranch,
      targetBranchContext
    );

    return analysis;
  },
});

/**
 * Generate a PR description for the backport
 */
export const generatePRDescription = tool({
  description: "Generate a pull request description for the backport",
  inputSchema: z.object({
    originalPR: z.object({
      title: z.string(),
      number: z.number(),
      body: z.string().nullable(),
    }),
    repository: z.string().describe("The repository in owner/repo format"),
    targetBranch: z.string().describe("The target branch for the backport"),
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
      .describe("The diff analysis"),
    backportAnalysis: z
      .object({
        canBackport: z.boolean(),
        confidence: z.number(),
        potentialConflicts: z.array(
          z.object({
            file: z.string(),
            reason: z.string(),
            severity: z.enum(["low", "medium", "high"]),
          })
        ),
        recommendations: z.array(z.string()),
        manualStepsRequired: z.array(z.string()),
        estimatedEffort: z.enum(["trivial", "easy", "moderate", "difficult"]),
      })
      .describe("The backport feasibility analysis"),
  }),
  execute: async function ({
    originalPR,
    repository,
    targetBranch,
    diffAnalysis,
    backportAnalysis,
  }) {
    "use step";

    const description = await generateBackportPRDescriptionAI(
      originalPR,
      repository,
      targetBranch,
      diffAnalysis as DiffAnalysis,
      backportAnalysis as BackportAnalysis
    );

    return { description };
  },
});

export const analysisTools = {
  analyzeDiff,
  analyzeBackportFeasibility,
  generatePRDescription,
};
