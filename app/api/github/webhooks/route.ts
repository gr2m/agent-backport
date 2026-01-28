import { NextRequest, NextResponse } from "next/server";
import {
  getGitHubApp,
  getInstallationOctokit,
  parseBackportCommand,
  verifyWebhookSignature,
} from "@/lib/github";
import { createJob, updateJob, addJobLog } from "@/lib/jobs";
import { start } from "workflow/api";
import { backportPullRequest } from "@/workflows/backport";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-hub-signature-256") || "";
  const event = request.headers.get("x-github-event") || "";
  const deliveryId = request.headers.get("x-github-delivery") || "";

  // Get the raw body for signature verification
  const payload = await request.text();

  // Skip signature verification in development if no secret is set
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (webhookSecret) {
    const isValid = await verifyWebhookSignature(payload, signature);
    if (!isValid) {
      console.error(`Invalid webhook signature for delivery ${deliveryId}`);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  // Parse the payload
  let body: any;
  try {
    body = JSON.parse(payload);
  } catch (e) {
    console.error("Failed to parse webhook payload:", e);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Handle issue_comment events (covers both issues and PRs)
  if (event === "issue_comment" && body.action === "created") {
    return handleIssueComment(body, deliveryId);
  }

  // Handle installation events for logging
  if (event === "installation") {
    console.log(
      `GitHub App ${body.action} on ${body.installation?.account?.login}`
    );
    return NextResponse.json({ message: "Installation event logged" });
  }

  return NextResponse.json({ message: "Event not handled", event });
}

async function handleIssueComment(body: any, deliveryId: string) {
  // Check if this is a comment on a pull request
  if (!body.issue?.pull_request) {
    return NextResponse.json({ message: "Not a PR comment" });
  }

  // Parse the backport command
  const command = parseBackportCommand(body.comment?.body || "");
  if (!command) {
    return NextResponse.json({ message: "No backport command found" });
  }

  const { targetBranch } = command;
  const installationId = body.installation?.id;
  const repository = body.repository?.full_name;
  const prNumber = body.issue?.number;
  const commentId = body.comment?.id;
  const requestedBy = body.comment?.user?.login || "unknown";

  // Validate required fields
  if (!installationId || !repository || !prNumber || !commentId) {
    console.error("Missing required fields in webhook payload");
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  console.log(
    `[${deliveryId}] Backport requested: ${repository}#${prNumber} to ${targetBranch} by ${requestedBy}`
  );

  // Check if the user has write access to the repository
  try {
    const octokit = await getInstallationOctokit(installationId);
    const [owner, repo] = repository.split("/");

    const { data: permission } = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: requestedBy,
    });

    const allowedPermissions = ["admin", "write", "maintain"];
    if (!allowedPermissions.includes(permission.permission)) {
      console.log(
        `[${deliveryId}] User ${requestedBy} does not have write access (permission: ${permission.permission})`
      );

      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `@${requestedBy} You need write access to this repository to request backports.`,
      });

      return NextResponse.json({
        message: "Permission denied",
        requestedBy,
        permission: permission.permission,
      });
    }
  } catch (error) {
    console.error(`[${deliveryId}] Error checking permissions:`, error);
    // Continue anyway - the user might have permissions through other means
  }

  // Create a job record
  const job = await createJob({
    repository,
    installationId,
    sourcePR: prNumber,
    targetBranch,
    requestedBy,
    commentId,
  });

  console.log(`[${deliveryId}] Created job ${job.id}`);
  await addJobLog(job.id, `Backport requested by @${requestedBy}`);
  await addJobLog(job.id, `Target branch: ${targetBranch}`);

  // Start the backport workflow
  try {
    await updateJob(job.id, { status: "in_progress" });
    await addJobLog(job.id, "Starting backport workflow...");

    await start(backportPullRequest, [
      {
        jobId: job.id,
        installationId,
        repository,
        prNumber,
        targetBranch,
        commentId,
      },
    ]);

    return NextResponse.json({
      message: "Backport workflow started",
      jobId: job.id,
      repository,
      prNumber,
      targetBranch,
    });
  } catch (error) {
    console.error(`[${deliveryId}] Error starting workflow:`, error);
    await updateJob(job.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    await addJobLog(job.id, `Failed to start workflow: ${error}`);

    // Try to notify on the PR
    try {
      const octokit = await getInstallationOctokit(installationId);
      const [owner, repo] = repository.split("/");

      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `❌ Failed to start backport workflow. Please try again later or contact support.`,
      });
    } catch (notifyError) {
      console.error(`[${deliveryId}] Error notifying about failure:`, notifyError);
    }

    return NextResponse.json(
      {
        error: "Failed to start workflow",
        jobId: job.id,
      },
      { status: 500 }
    );
  }
}
