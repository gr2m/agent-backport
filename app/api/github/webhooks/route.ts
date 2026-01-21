import { NextRequest, NextResponse } from "next/server";
import {
  getGitHubApp,
  parseBackportCommand,
  verifyWebhookSignature,
} from "@/lib/github";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-hub-signature-256") || "";
  const event = request.headers.get("x-github-event") || "";
  const deliveryId = request.headers.get("x-github-delivery") || "";

  // Get the raw body for signature verification
  const payload = await request.text();

  // Verify webhook signature
  const isValid = await verifyWebhookSignature(payload, signature);
  if (!isValid) {
    console.error(`Invalid webhook signature for delivery ${deliveryId}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse the payload
  const body = JSON.parse(payload);

  // Handle issue_comment events (covers both issues and PRs)
  if (event === "issue_comment" && body.action === "created") {
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

    console.log(
      `Backport requested: ${repository}#${prNumber} to ${targetBranch}`
    );

    // TODO: Start the backport workflow
    // await startBackportWorkflow({
    //   installationId,
    //   repository,
    //   prNumber,
    //   targetBranch,
    //   commentId,
    // });

    return NextResponse.json({
      message: "Backport workflow started",
      repository,
      prNumber,
      targetBranch,
    });
  }

  return NextResponse.json({ message: "Event not handled" });
}
