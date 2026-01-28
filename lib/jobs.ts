// Job storage for backport operations (in-memory, does not persist across deployments)
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
