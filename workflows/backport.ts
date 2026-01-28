import { DurableAgent } from "@workflow/ai/agent";
import { getWritable } from "workflow";
import type { UIMessageChunk } from "ai";
import {
  githubTools,
  sandboxTools,
  analysisTools,
  loggingTools,
  BACKPORT_AGENT_SYSTEM_PROMPT,
  type AgentToolContext,
} from "@/lib/agent-tools";

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

/**
 * Main backport workflow using DurableAgent
 *
 * The agent autonomously handles the entire backport process:
 * 1. Creates a progress comment with task checklist
 * 2. Fetches PR details and validates target branch
 * 3. Analyzes changes and backport feasibility with AI
 * 4. Executes the backport in a sandbox (cherry-pick, conflict resolution)
 * 5. Creates the result PR or reports failure
 */
export async function backportPullRequest(
  params: BackportParams
): Promise<BackportResult> {
  "use workflow";

  const { jobId, installationId, repository, prNumber, targetBranch, commentId } =
    params;

  // Create the context that tools will use
  const context: AgentToolContext = {
    installationId,
    repository,
    jobId,
  };

  // Create the DurableAgent with all tools
  const agent = new DurableAgent({
    model: "anthropic/claude-sonnet-4",
    system: BACKPORT_AGENT_SYSTEM_PROMPT,
    tools: {
      ...githubTools,
      ...sandboxTools,
      ...analysisTools,
      ...loggingTools,
    },
    toolChoice: "auto",
  });

  // Create the user message with all context the agent needs
  const userMessage = `Backport PR #${prNumber} from repository ${repository} to branch "${targetBranch}".

The request was triggered by comment ID ${commentId}.

Job ID for logging: ${jobId}

Please execute the full backport workflow:
1. Create a progress comment with task checklist
2. Fetch PR details
3. Validate the target branch exists
4. Analyze the diff and backport feasibility
5. If feasible, execute the backport
6. Create the result PR or report failure`;

  // Get a writable stream for the workflow output
  const writable = getWritable<UIMessageChunk>();

  // Run the agent with streaming
  const result = await agent.stream({
    messages: [{ role: "user", content: userMessage }],
    writable,
    experimental_context: context,
    collectUIMessages: true,
  });

  // Parse the result from the agent's final messages
  return parseAgentResult(result);
}

/**
 * Parse the agent's result to extract backport outcome
 */
function parseAgentResult(
  result: { messages: Array<{ role: string; content: unknown }> }
): BackportResult {
  // Look through the messages to find tool results
  for (const message of result.messages) {
    if (message.role === "tool" && Array.isArray(message.content)) {
      for (const part of message.content) {
        const toolPart = part as { type?: string; toolName?: string; result?: unknown };

        // Check for createPullRequest results
        if (toolPart.toolName === "createPullRequest" && toolPart.result) {
          const prResult = toolPart.result as { number?: number };
          if (prResult.number) {
            return {
              success: true,
              resultPR: prResult.number,
            };
          }
        }

        // Check for updateJobStatus with failure
        if (toolPart.toolName === "updateJobStatus" && toolPart.result) {
          const statusResult = toolPart.result as { success?: boolean };
          // Look at the tool call input to determine status
        }
      }
    }
  }

  // Check for any error indicators in the final assistant message
  const lastMessage = result.messages[result.messages.length - 1];
  if (lastMessage?.role === "assistant") {
    const content = typeof lastMessage.content === "string"
      ? lastMessage.content
      : "";

    // Try to infer from the message content
    if (content.toLowerCase().includes("success") && content.includes("#")) {
      const prMatch = content.match(/#(\d+)/);
      if (prMatch) {
        return {
          success: true,
          resultPR: parseInt(prMatch[1], 10),
        };
      }
    }

    if (content.toLowerCase().includes("fail") || content.toLowerCase().includes("error")) {
      return {
        success: false,
        error: content.slice(0, 500) || "Backport failed",
      };
    }
  }

  // Try to find PR number from tool calls
  for (const message of result.messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) {
        const toolCall = part as { type?: string; toolName?: string; args?: unknown };
        if (toolCall.type === "tool-call" && toolCall.toolName === "updateJobStatus") {
          const args = toolCall.args as { status?: string; resultPR?: number; error?: string } | undefined;
          if (args?.status === "completed" && args?.resultPR) {
            return {
              success: true,
              resultPR: args.resultPR,
            };
          }
          if (args?.status === "failed") {
            return {
              success: false,
              error: args.error || "Backport failed",
            };
          }
        }
      }
    }
  }

  // Default to unknown outcome
  return {
    success: false,
    error: "Could not determine backport outcome from agent response",
  };
}
