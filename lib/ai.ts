import { generateText, streamText, tool } from "ai";
import { z } from "zod";

// AI Gateway model identifiers
// Using Vercel AI Gateway for unified access to multiple providers
export const MODELS = {
  // Claude models via AI Gateway
  CLAUDE_SONNET: "anthropic/claude-sonnet-4",
  CLAUDE_HAIKU: "anthropic/claude-haiku",
  // OpenAI models via AI Gateway
  GPT_4O: "openai/gpt-4o",
  GPT_4O_MINI: "openai/gpt-4o-mini",
} as const;

// Default model for backport analysis
export const DEFAULT_MODEL = MODELS.CLAUDE_SONNET;

// Tool definitions for the backport agent
export const backportTools = {
  analyzeDiff: tool({
    description:
      "Analyze a git diff to understand what changes were made in the pull request",
    inputSchema: z.object({
      diff: z.string().describe("The git diff content to analyze"),
      context: z
        .string()
        .optional()
        .describe("Additional context about the changes"),
    }),
    execute: async ({ diff, context }) => {
      // This will be implemented to provide structured analysis
      return {
        summary: "Diff analysis placeholder",
        filesChanged: [],
        changeType: "unknown",
      };
    },
  }),

  analyzeBranchDifferences: tool({
    description:
      "Compare two branches to identify differences that might affect backporting",
    inputSchema: z.object({
      sourceBranch: z.string().describe("The source branch name"),
      targetBranch: z.string().describe("The target branch name"),
      relevantFiles: z
        .array(z.string())
        .describe("List of files relevant to the backport"),
    }),
    execute: async ({ sourceBranch, targetBranch, relevantFiles }) => {
      // This will be implemented to compare branches
      return {
        compatible: true,
        potentialConflicts: [],
        recommendations: [],
      };
    },
  }),

  suggestResolution: tool({
    description: "Suggest a resolution for a merge conflict",
    inputSchema: z.object({
      conflictMarkers: z
        .string()
        .describe("The conflict markers from the file"),
      originalChange: z
        .string()
        .describe("The original change from the PR"),
      targetContext: z
        .string()
        .describe("The context in the target branch"),
    }),
    execute: async ({ conflictMarkers, originalChange, targetContext }) => {
      // This will be implemented to suggest resolutions
      return {
        suggestedResolution: "",
        confidence: 0,
        explanation: "",
      };
    },
  }),

  validateBackport: tool({
    description:
      "Validate that a backport correctly applies the intended changes",
    inputSchema: z.object({
      originalDiff: z.string().describe("The original PR diff"),
      backportDiff: z.string().describe("The backported changes diff"),
      targetBranch: z.string().describe("The target branch name"),
    }),
    execute: async ({ originalDiff, backportDiff, targetBranch }) => {
      // This will be implemented to validate backports
      return {
        isValid: true,
        issues: [],
        suggestions: [],
      };
    },
  }),
};

// Helper to generate text with AI Gateway
export async function analyzeWithAI(
  prompt: string,
  model: string = DEFAULT_MODEL
) {
  const result = await generateText({
    model,
    prompt,
  });

  return result.text;
}

// Helper to stream text with AI Gateway
export async function streamAnalysis(
  prompt: string,
  model: string = DEFAULT_MODEL
) {
  const result = streamText({
    model,
    prompt,
  });

  return result;
}
