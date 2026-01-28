// Job storage for backport operations
// TODO: Re-enable Upstash Redis for persistence
// import { Redis } from "@upstash/redis";

// const redis = new Redis({
//   url: process.env.UPSTASH_REDIS_REST_URL!,
//   token: process.env.UPSTASH_REDIS_REST_TOKEN!,
// });

// In-memory storage (temporary - does not persist across requests/deployments)
const jobStore = new Map<string, BackportJob>();

export interface BackportJob {
  id: string;
  repository: string;
  installationId: number;
  sourcePR: number;
  targetBranch: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  createdAt: Date;
  updatedAt: Date;
  requestedBy: string;
  commentId: number;
  resultPR?: number;
  error?: string;
  logs: string[];
}

// Redis serialization types removed - using in-memory storage

export function generateJobId(): string {
  return `bp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export async function createJob(
  params: Omit<BackportJob, "id" | "status" | "createdAt" | "updatedAt" | "logs">
): Promise<BackportJob> {
  const now = new Date();
  const job: BackportJob = {
    ...params,
    id: generateJobId(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
    logs: [],
  };

  jobStore.set(job.id, job);
  return job;
}

export async function getJob(id: string): Promise<BackportJob | null> {
  return jobStore.get(id) || null;
}

export async function updateJob(
  id: string,
  updates: Partial<Omit<BackportJob, "id" | "createdAt" | "logs">>
): Promise<BackportJob | null> {
  const existing = jobStore.get(id);
  if (!existing) return null;

  const updated: BackportJob = {
    ...existing,
    ...updates,
    updatedAt: new Date(),
  };

  jobStore.set(id, updated);
  return updated;
}

export async function addJobLog(id: string, message: string): Promise<void> {
  const logEntry = `[${new Date().toISOString()}] ${message}`;
  console.log(`Job ${id} log: ${message}`);

  const job = jobStore.get(id);
  if (job) {
    job.logs.push(logEntry);
    job.updatedAt = new Date();
    jobStore.set(id, job);
  }
}

export async function listJobs(options?: {
  repository?: string;
  status?: BackportJob["status"];
  limit?: number;
}): Promise<BackportJob[]> {
  const limit = options?.limit || 50;

  // Get all jobs sorted by creation time (newest first)
  let result = Array.from(jobStore.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  if (options?.repository) {
    result = result.filter((j) => j.repository === options.repository);
  }

  if (options?.status) {
    result = result.filter((j) => j.status === options.status);
  }

  return result.slice(0, limit);
}

export async function listJobsForUser(
  accessToken: string,
  limit?: number
): Promise<BackportJob[]> {
  // TODO: Filter by repositories the user has access to
  // For now, return all jobs
  return listJobs({ limit });
}
