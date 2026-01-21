import { App, Octokit } from "octokit";

// GitHub App instance for webhook handling and installation authentication
let app: App | null = null;

export function getGitHubApp(): App {
  if (!app) {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !privateKey) {
      throw new Error(
        "Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY environment variables"
      );
    }

    app = new App({
      appId,
      privateKey,
      webhooks: {
        secret: process.env.GITHUB_WEBHOOK_SECRET || "",
      },
    });
  }

  return app;
}

// Get an authenticated Octokit instance for a specific installation
export async function getInstallationOctokit(
  installationId: number
): Promise<Octokit> {
  const app = getGitHubApp();
  return app.getInstallationOctokit(installationId);
}

// Get an Octokit instance authenticated with a user's access token
export function getUserOctokit(accessToken: string): Octokit {
  return new Octokit({
    auth: accessToken,
  });
}

// Parse the backport command from a comment body
// Example: "@agent-backport backport to release-v5.0"
export function parseBackportCommand(
  commentBody: string
): { targetBranch: string } | null {
  const pattern = /@agent-backport\s+backport\s+to\s+(\S+)/i;
  const match = commentBody.match(pattern);

  if (match) {
    return {
      targetBranch: match[1],
    };
  }

  return null;
}

// Verify webhook signature
export async function verifyWebhookSignature(
  payload: string,
  signature: string
): Promise<boolean> {
  const app = getGitHubApp();
  try {
    await app.webhooks.verify(payload, signature);
    return true;
  } catch {
    return false;
  }
}
