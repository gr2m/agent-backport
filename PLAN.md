# Agent Backport - Implementation Plan

An AI-powered GitHub App that intelligently backports pull requests and commits across branches.

## Overview

The agent responds to comments like `@agent-backport backport to release-v5.0` on pull requests, automatically understanding both branches, the PR context, and creating clean backports without conflicts.

## Technology Stack

- **Next.js 15** - React framework with App Router
- **Vercel AI SDK** - For AI-powered code understanding and decision making
- **Vercel AI Gateway** - Unified API for accessing AI models with automatic failover
- **Vercel Workflow DevKit** - For durable, long-running backport workflows
- **Vercel Sandbox** - For safe git operations in isolated environments
- **GitHub App** - For webhooks and API access
- **GitHub OAuth** - For user authentication in web UI
- **Vercel KV/Postgres** - For storing backport job status

---

## Phase 1: Project Setup & Basic Infrastructure

**Goal**: Create the foundational Next.js project with all dependencies configured.

### Tasks

1. Initialize Next.js 15 project with TypeScript and App Router
2. Install and configure dependencies:
   - `ai` (Vercel AI SDK)
   - `workflow` (Vercel Workflow DevKit)
   - `@vercel/sandbox`
   - `octokit` (GitHub API client)
3. Configure Next.js for Workflow DevKit
4. Set up project structure:
   ```
   ├── app/
   │   ├── api/
   │   │   ├── github/
   │   │   │   └── webhooks/route.ts
   │   │   └── auth/
   │   │       └── [...nextauth]/route.ts
   │   ├── page.tsx
   │   └── layout.tsx
   ├── lib/
   │   ├── github.ts
   │   └── ai.ts
   ├── workflows/
   │   └── backport.ts
   └── components/
   ```
5. Create environment variable templates
6. Set up ESLint and Prettier

### Deliverables

- Working Next.js project
- All dependencies installed and configured
- Basic project structure in place

---

## Phase 2: GitHub App Integration

**Goal**: Set up GitHub App webhooks and OAuth authentication.

### Tasks

1. Create GitHub webhook handler for `issue_comment` events
2. Parse and validate incoming webhook payloads
3. Detect `@agent-backport backport to <branch>` command pattern
4. Set up GitHub OAuth with NextAuth.js
5. Create GitHub API client utilities using Octokit
6. Implement webhook signature verification

### Deliverables

- Working webhook endpoint that receives and validates GitHub events
- OAuth login flow for web UI
- GitHub API client configured

---

## Phase 3: Web UI - Dashboard

**Goal**: Build the web interface showing backport status.

### Tasks

1. Create login page with "Login with GitHub" button
2. Build dashboard showing list of backport jobs
3. Display job status, source PR, target branch, and progress
4. Add real-time updates using server-sent events or polling
5. Show repository filter (only repos user has write access to)
6. Create job detail page with logs and timeline

### Deliverables

- Functional login/logout flow
- Dashboard with backport job list
- Job detail view with progress tracking

---

## Phase 4: Backport Workflow Foundation

**Goal**: Implement the core backport workflow using Workflow DevKit.

### Tasks

1. Create the main backport workflow function with `"use workflow"`
2. Define workflow steps:
   - Fetch PR details and diff
   - Analyze source and target branches
   - Create sandbox environment
   - Execute git operations
   - Create result PR or report conflicts
3. Implement job status persistence
4. Add error handling and retry logic with `FatalError`
5. Set up workflow observability

### Deliverables

- Durable backport workflow that survives failures
- Job status tracking in database
- Basic error handling

---

## Phase 5: AI-Powered Code Analysis

**Goal**: Use AI SDK with AI Gateway to understand code context and make intelligent backporting decisions.

### Tasks

1. Configure AI SDK with Vercel AI Gateway (unified access to Claude, GPT, etc.)
2. Create tools for the AI agent:
   - `analyze_diff` - Understand what changed in the PR
   - `analyze_branch_differences` - Compare source and target branches
   - `suggest_resolution` - Propose conflict resolutions
   - `validate_backport` - Verify the backport is correct
3. Build prompts for backport analysis:
   - Understand the intent of the changes
   - Identify potential conflicts
   - Suggest adaptations for target branch
4. Implement conflict detection and resolution suggestions

### Deliverables

- AI agent with code analysis capabilities
- Intelligent conflict detection
- Suggested resolutions for complex cases

---

## Phase 6: Sandbox Git Operations

**Goal**: Execute actual git operations safely in Vercel Sandbox.

### Tasks

1. Create sandbox initialization with repository clone
2. Implement git operations:
   - Checkout target branch
   - Cherry-pick commits from PR
   - Handle conflicts (with AI assistance)
   - Create new branch for backport
   - Push changes
3. Add file reading/writing for conflict resolution
4. Implement cleanup and resource management
5. Handle authentication for private repositories

### Deliverables

- Safe git operations in isolated sandbox
- Automated cherry-pick with conflict handling
- Push capability for creating backport branches

---

## Phase 7: Pull Request Creation & Reporting

**Goal**: Create the backported PR and report results.

### Tasks

1. Create PR on target branch with backported changes
2. Generate PR description:
   - Link to original PR
   - Summary of changes
   - Any modifications made for compatibility
3. Post comment on original PR with result:
   - Success: Link to new PR
   - Failure: Explanation and manual steps
4. Handle partial success scenarios
5. Add labels and assignees to created PR

### Deliverables

- Automatic PR creation for successful backports
- Clear status reporting on original PR
- Helpful failure messages with guidance

---

## Phase 8: Testing & Polish

**Goal**: Comprehensive testing and production readiness.

### Tasks

1. Write unit tests for core logic
2. Create integration tests for GitHub webhook handling
3. Test workflow durability and recovery
4. Add rate limiting and abuse prevention
5. Implement logging and monitoring
6. Create documentation for GitHub App setup
7. Add configuration options (target branch patterns, etc.)

### Deliverables

- Test coverage for critical paths
- Production-ready error handling
- Setup documentation

---

## Phase 9: Deployment & Documentation

**Goal**: Deploy to Vercel and document everything.

### Tasks

1. Configure Vercel project settings
2. Set up environment variables in Vercel
3. Deploy to production
4. Create GitHub App manifest for easy installation
5. Write user documentation
6. Create troubleshooting guide

### Deliverables

- Live deployment on Vercel
- GitHub App ready for installation
- Complete documentation

---

## Environment Variables Required

```env
# GitHub App
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=

# GitHub OAuth
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Vercel AI Gateway
AI_GATEWAY_API_KEY=

# Vercel
VERCEL_TEAM_ID=
VERCEL_PROJECT_ID=
VERCEL_TOKEN=

# Database
DATABASE_URL=

# NextAuth
NEXTAUTH_SECRET=
NEXTAUTH_URL=
```

---

## Success Criteria

1. ✅ User can install GitHub App on repository
2. ✅ Commenting `@agent-backport backport to <branch>` triggers backport
3. ✅ AI understands code context and branch differences
4. ✅ Successful backports create new PR automatically
5. ✅ Conflicts are detected and reported with suggestions
6. ✅ Web UI shows status of all backport jobs
7. ✅ System is durable and recovers from failures
