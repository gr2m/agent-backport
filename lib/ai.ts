import { generateText, generateObject } from "ai";
import { z } from "zod";

// AI Gateway model identifiers
// The AI SDK automatically uses AI Gateway when AI_GATEWAY_API_KEY is set
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

// Schema for diff analysis result
const DiffAnalysisSchema = z.object({
  summary: z.string().describe("Brief summary of what the changes do"),
  intent: z.string().describe("The intent/purpose of the changes"),
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
  dependencies: z.array(z.string()).describe("External dependencies affected"),
  risks: z.array(z.string()).describe("Potential risks or concerns"),
});

export type DiffAnalysis = z.infer<typeof DiffAnalysisSchema>;

// Schema for backport analysis result
const BackportAnalysisSchema = z.object({
  canBackport: z.boolean(),
  confidence: z.number().min(0).max(1),
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
});

export type BackportAnalysis = z.infer<typeof BackportAnalysisSchema>;

// Schema for conflict resolution suggestion
const ConflictResolutionSchema = z.object({
  resolvedContent: z.string(),
  explanation: z.string(),
  confidence: z.number().min(0).max(1),
  alternatives: z.array(
    z.object({
      content: z.string(),
      reason: z.string(),
    })
  ),
});

export type ConflictResolution = z.infer<typeof ConflictResolutionSchema>;

/**
 * Analyze a git diff to understand what changes were made
 */
export async function analyzeDiff(
  diff: string,
  prTitle: string,
  prBody: string | null,
  model: string = DEFAULT_MODEL
): Promise<DiffAnalysis> {
  const result = await generateObject({
    model,
    schema: DiffAnalysisSchema,
    prompt: `Analyze this git diff from a pull request and provide a structured analysis.

PR Title: ${prTitle}
PR Description: ${prBody || "No description provided"}

Git Diff:
\`\`\`diff
${diff.slice(0, 50000)}
\`\`\`

Analyze the changes and provide:
1. A brief summary of what the changes do
2. The intent/purpose of the changes
3. List of files changed with descriptions
4. Type of change (bugfix, feature, refactor, etc.)
5. Complexity assessment
6. Any external dependencies affected
7. Potential risks or concerns`,
  });

  return result.object;
}

/**
 * Analyze whether a PR can be backported to a target branch
 */
export async function analyzeBackportFeasibility(
  diff: string,
  diffAnalysis: DiffAnalysis,
  sourceBranch: string,
  targetBranch: string,
  targetBranchContext: string,
  model: string = DEFAULT_MODEL
): Promise<BackportAnalysis> {
  const result = await generateObject({
    model,
    schema: BackportAnalysisSchema,
    prompt: `Analyze whether this PR can be backported from "${sourceBranch}" to "${targetBranch}".

## Change Summary
${diffAnalysis.summary}

## Change Intent
${diffAnalysis.intent}

## Files Changed
${diffAnalysis.filesChanged.map((f) => `- ${f.path}: ${f.description}`).join("\n")}

## Complexity: ${diffAnalysis.complexity}

## Git Diff
\`\`\`diff
${diff.slice(0, 30000)}
\`\`\`

## Target Branch Context
${targetBranchContext}

Analyze:
1. Can this be cleanly backported?
2. What conflicts might occur?
3. What recommendations do you have?
4. Are there manual steps required?
5. How difficult will this backport be?`,
  });

  return result.object;
}

/**
 * Suggest a resolution for a merge conflict
 */
export async function suggestConflictResolution(
  conflictContent: string,
  originalChange: string,
  fileContext: string,
  changeIntent: string,
  model: string = DEFAULT_MODEL
): Promise<ConflictResolution> {
  const result = await generateObject({
    model,
    schema: ConflictResolutionSchema,
    prompt: `Help resolve this merge conflict during a backport operation.

## Conflict Markers
\`\`\`
${conflictContent}
\`\`\`

## Original Change Intent
${changeIntent}

## Original Change
\`\`\`
${originalChange}
\`\`\`

## File Context
${fileContext}

Provide:
1. The resolved content (without conflict markers)
2. Explanation of your resolution strategy
3. Confidence level (0-1)
4. Alternative resolutions if applicable`,
  });

  return result.object;
}

/**
 * Generate a commit message for the backport
 */
export async function generateBackportCommitMessage(
  originalPR: { title: string; number: number; body: string | null },
  targetBranch: string,
  diffAnalysis: DiffAnalysis,
  model: string = MODELS.CLAUDE_HAIKU // Use faster model for simple tasks
): Promise<string> {
  const result = await generateText({
    model,
    prompt: `Generate a concise git commit message for backporting PR #${originalPR.number} to the "${targetBranch}" branch.

Original PR Title: ${originalPR.title}
Original PR Description: ${originalPR.body?.slice(0, 500) || "None"}

Change Summary: ${diffAnalysis.summary}
Change Type: ${diffAnalysis.changeType}

Generate a commit message in this format:
[backport ${targetBranch}] <concise description>

The message should be under 72 characters for the first line.`,
  });

  return result.text.trim();
}

/**
 * Generate a PR description for the backport
 */
export async function generateBackportPRDescription(
  originalPR: { title: string; number: number; body: string | null },
  repository: string,
  targetBranch: string,
  diffAnalysis: DiffAnalysis,
  backportAnalysis: BackportAnalysis,
  model: string = DEFAULT_MODEL
): Promise<string> {
  const result = await generateText({
    model,
    prompt: `Generate a pull request description for a backport.

## Original PR
- Repository: ${repository}
- PR: #${originalPR.number}
- Title: ${originalPR.title}
- Description: ${originalPR.body?.slice(0, 1000) || "None"}

## Backport Details
- Target Branch: ${targetBranch}
- Change Type: ${diffAnalysis.changeType}
- Complexity: ${diffAnalysis.complexity}

## Analysis
- Summary: ${diffAnalysis.summary}
- Intent: ${diffAnalysis.intent}
- Risks: ${diffAnalysis.risks.join(", ") || "None identified"}

## Backport Recommendations
${backportAnalysis.recommendations.join("\n") || "None"}

Generate a PR description in markdown format that includes:
1. A brief summary of the backport
2. Link to the original PR
3. Any important notes about the backport
4. Testing recommendations if applicable

Keep it concise but informative.`,
  });

  return result.text.trim();
}

/**
 * Simple text analysis helper
 */
export async function analyzeWithAI(
  prompt: string,
  model: string = DEFAULT_MODEL
): Promise<string> {
  const result = await generateText({
    model,
    prompt,
  });

  return result.text;
}
