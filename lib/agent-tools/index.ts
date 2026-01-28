export { githubTools, type GitHubToolContext } from "./github";
export { sandboxTools, type SandboxToolContext } from "./sandbox";
export { analysisTools } from "./analysis";
export { loggingTools, type LoggingToolContext } from "./logging";
export { BACKPORT_AGENT_SYSTEM_PROMPT } from "./system-prompt";

// Combined tool context for all tools
export interface AgentToolContext {
  installationId: number;
  repository: string;
  jobId: string;
}
