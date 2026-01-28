# Agent Backport

An AI-powered GitHub App that intelligently backports pull requests across branches.

## Features

- **AI-Powered Analysis**: Understands code changes and predicts backport feasibility
- **Automatic Conflict Resolution**: Uses AI to resolve merge conflicts when possible
- **Isolated Execution**: Runs git operations in Vercel Sandbox for safety
- **Real-time Dashboard**: Track backport jobs and view detailed logs
- **GitHub Integration**: Responds to comments on pull requests

## How It Works

1. **Trigger**: Comment on a merged PR with `@agent-backport backport to <branch>`
2. **Analyze**: AI analyzes the changes and target branch for compatibility
3. **Execute**: Cherry-picks commits in an isolated sandbox environment
4. **Resolve**: AI attempts to resolve any merge conflicts
5. **Create PR**: Opens a new pull request with the backported changes

## Tech Stack

- **[Next.js 16](https://nextjs.org/)** - React framework with App Router
- **[Vercel AI SDK](https://ai-sdk.dev/)** - AI-powered code analysis
- **[Vercel AI Gateway](https://vercel.com/ai-gateway)** - Unified AI model access
- **[Vercel Workflow DevKit](https://useworkflow.dev/)** - Durable workflows
- **[Vercel Sandbox](https://vercel.com/docs/vercel-sandbox)** - Isolated git operations
- **[Octokit](https://github.com/octokit/octokit.js)** - GitHub API client

## Setup

### Prerequisites

- Node.js 18+
- A Vercel account
- A GitHub account with permission to create GitHub Apps

### 1. Create a GitHub App

1. Go to [GitHub Developer Settings](https://github.com/settings/apps)
2. Click "New GitHub App"
3. Configure the app:
   - **Name**: `agent-backport` (or your preferred name)
   - **Homepage URL**: Your Vercel deployment URL
   - **Webhook URL**: `https://your-app.vercel.app/api/github/webhooks`
   - **Webhook Secret**: Generate a secure random string
   - **Permissions**:
     - Repository: Contents (Read & Write)
     - Repository: Pull requests (Read & Write)
     - Repository: Issues (Read & Write)
   - **Events**: Issue comment
4. Generate and download a private key
5. Note your App ID and Client ID/Secret

### 2. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/agent-backport/app)

Or deploy manually:

```bash
# Clone the repository
git clone https://github.com/agent-backport/app.git
cd agent-backport

# Install dependencies
npm install

# Deploy to Vercel
vercel
```

### 3. Configure Environment Variables

Set these in your Vercel project settings:

```env
# GitHub App
GITHUB_APP_ID=your_app_id
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# GitHub OAuth (for dashboard login)
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret

# Vercel AI Gateway
AI_GATEWAY_API_KEY=your_ai_gateway_key

# NextAuth
NEXTAUTH_SECRET=generate_a_random_string
NEXTAUTH_URL=https://your-app.vercel.app
```

### 4. Install the GitHub App

1. Go to your GitHub App settings
2. Click "Install App"
3. Select the repositories you want to enable backporting for

## Usage

### Requesting a Backport

On any merged pull request, comment:

```
@agent-backport backport to release-v5.0
```

The bot will:
1. React with 👀 to acknowledge the request
2. Analyze the changes
3. Attempt the backport
4. Comment with the result (success link or failure reason)

### Dashboard

Visit your deployment URL to sign in with GitHub.

## Development

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your values

# Run development server
npm run dev

# Build for production
npm run build
```

### Testing Webhooks Locally

Use [smee.io](https://smee.io/) to forward webhooks to your local machine:

```bash
# Install smee client
npm install -g smee-client

# Forward webhooks
smee -u https://smee.io/your-channel -t http://localhost:3000/api/github/webhooks
```

## Architecture

```
agent-backport/
├── app/
│   ├── api/
│   │   ├── github/webhooks/  # GitHub webhook handler
│   │   └── auth/             # NextAuth.js endpoints
│   ├── page.tsx              # Dashboard
│   └── layout.tsx
├── lib/
│   ├── ai.ts                 # AI analysis functions
│   ├── auth.ts               # NextAuth configuration
│   ├── github.ts             # GitHub App utilities
│   ├── jobs.ts               # Job storage (in-memory)
│   └── sandbox.ts            # Vercel Sandbox operations
├── workflows/
│   └── backport.ts           # Main backport workflow
└── components/
    ├── dashboard.tsx         # User dashboard
    ├── login-button.tsx      # GitHub OAuth button
    └── providers.tsx         # Session provider
```

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
