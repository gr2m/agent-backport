import { tool } from "ai";
import { z } from "zod";
import { addJobLog, updateJob, type BackportJob } from "@/lib/jobs";

// Context that will be provided to all tools via experimental_context
export interface LoggingToolContext {
  jobId: string;
}

/**
 * Log progress for a backport job
 */
export const logProgress = tool({
  description: "Add a log entry to track progress of the backport operation",
  inputSchema: z.object({
    message: z.string().describe("The log message to record"),
  }),
  execute: async function ({ message }, { experimental_context }) {
    "use step";

    const { jobId } = experimental_context as LoggingToolContext;
    await addJobLog(jobId, message);

    return { success: true };
  },
});

/**
 * Update the job status
 */
export const updateJobStatus = tool({
  description: "Update the status of the backport job",
  inputSchema: z.object({
    status: z
      .enum(["pending", "in_progress", "completed", "failed"])
      .describe("The new status"),
    resultPR: z
      .number()
      .optional()
      .describe("The resulting PR number (if completed successfully)"),
    error: z.string().optional().describe("Error message (if failed)"),
  }),
  execute: async function ({ status, resultPR, error }, { experimental_context }) {
    "use step";

    const { jobId } = experimental_context as LoggingToolContext;
    const updates: Partial<Omit<BackportJob, "id" | "createdAt" | "logs">> = {
      status,
    };

    if (resultPR !== undefined) {
      updates.resultPR = resultPR;
    }

    if (error !== undefined) {
      updates.error = error;
    }

    await updateJob(jobId, updates);

    return { success: true };
  },
});

export const loggingTools = {
  logProgress,
  updateJobStatus,
};
