# agent-system

A multi-agent AI development system for solo developers. Plan, design, build, validate, and ship features with full visibility — across new or existing projects.

```bash
npx agent-system init
agent run "add user authentication with login and register"
```

---

## How it works

```
agent run "add user login"
        ↓
   PRD Agent          → docs/prd.json + contracts
        ↓
  [You review plan]   → approve or edit before any code runs
        ↓
  Designer Agent      → docs/designs/[task]-spec.json
        ↓
  Builder Agent       → writes code + test file
        ↓
  Static Validators   → ownership, AST, contracts — no LLM
        ↓
  Git Worktree        → isolated per-attempt branch
        ↓
  Sandbox             → install → typecheck → test → playwright
        ↓
  Artifact Collection → logs, test results, screenshots, traces
        ↓
  Hooks               → beforeRetry, onFailure, beforeCommit, ...
        ↓
  Reviewer Agent      → logic + acceptance criteria
        ↓
  Confidence Gate     → high → auto commit / medium → approval / low → escalate
        ↓
  Cherry-pick → main  → one clean commit per passing task
        ↓
  E2E Tests           → feature tests, then critical paths
        ↓
  Attribution Engine  → if regression: localised retry
```

Each attempt runs in a throwaway git worktree. On review pass the commit is cherry-picked into the main branch. On failure the worktree is discarded — the working tree stays clean.

---

## Installation

### New project

```bash
mkdir my-app && cd my-app
npm init -y
npx agent-system@latest init
```

### Existing project

```bash
cd my-existing-project
npx agent-system@latest init

# To pre-populate registry from your existing components:
npx agent-system@latest init --scan-existing
```

### Install globally (optional)

```bash
npm install -g agent-system
# then in any project:
agent init
agent run "..."
```

---

## Setup

Two project shapes are supported. Choose the one that matches your repo.

---

### Single-project setup

A standard repo where all code lives at the root — Next.js app, Express API, Vite frontend, etc.

#### 1. Scaffold

```bash
cd my-project
npx agent-system@latest init
```

This creates:

```
.agent/
  config.json          ← edit this
  skills/
    shared/project.md  ← auto-filled with your stack
    fe/design-system.md ← ⭐ edit with your actual tokens
    be/api-conventions.md
tests/e2e/
  critical-paths/      ← fill in your key flows
  features/            ← agents write here
  fixtures/
playwright.config.ts   ← pre-configured
.env.example           ← copy to .env
```

#### 2. Configure

```bash
cp .env.example .env
# Add ANTHROPIC_API_KEY=sk-ant-...
```

`.agent/config.json` (single-project defaults):

```json
{
  "model": "claude-sonnet-4-6",
  "fastModel": "claude-haiku-4-5-20251001",
  "maxRetries": 2,
  "requireApproval": true,
  "monthlyBudgetUsd": 20.00,
  "framework": "next",
  "language": "ts",
  "srcDir": "src",
  "docsDir": "docs",
  "tracesDir": ".agent/traces",
  "skillsDir": ".agent/skills",
  "mockupsDir": ".agent/mockups",
  "testDir": "tests/e2e"
}
```

Set `framework` to match your project: `next` · `express` · `fastify` · `vite` · `remix` · `generic`.

#### 3. Edit your design system

Open `.agent/skills/fe/design-system.md` and replace the placeholder tokens with your actual values:

```markdown
## Colors
- Primary: `var(--color-primary)` → `#6366f1`
- Background: `var(--color-bg)` → `#ffffff`
...

## Component library
- Button → shadcn/ui `<Button>`
- Input → shadcn/ui `<Input>`
- Card → shadcn/ui `<Card>`
```

This file is injected verbatim into every FE builder prompt. If it reflects your actual project, agents produce design-consistent output on the first attempt.

#### 4. Fill in critical paths

`tests/e2e/critical-paths/` contains placeholder tests for your key user flows. Fill these in before running any features — they run after every task to catch regressions.

```typescript
// tests/e2e/critical-paths/cp-001-login.e2e.ts
test('user can log in', async ({ page }) => {
  await page.goto('/login')
  await page.getByTestId('email-input').fill('user@example.com')
  await page.getByTestId('password-input').fill('password123')
  await page.getByTestId('submit-button').click()
  await expect(page).toHaveURL('/dashboard')
})
```

#### 5. Run a feature

```bash
agent run "add user authentication with login and register pages"
```

The system will:
1. Generate a plan (`docs/task-queue.json`) — **you review and approve it**
2. Build each task in a git worktree (isolated per attempt)
3. Run static validation, sandbox, and LLM review on each task
4. Cherry-pick passing commits to your main branch
5. Run your critical paths after all tasks complete

---

### Monorepo setup

A repo where the backend and frontend (or multiple services) live as separate packages — e.g. `apps/api` (Express) and `apps/mobile` (Expo), or `packages/server` and `packages/web`.

#### 1. Scaffold

```bash
cd my-monorepo
npx agent-system@latest init
# Select "monorepo" when prompted, or pass --monorepo
```

Or auto-detect existing workspace structure:

```bash
npx agent-system@latest init --scan-existing
```

#### 2. Configure workspaces

`.agent/config.json` — one entry per package that agents should work in:

```json
{
  "model": "claude-sonnet-4-6",
  "fastModel": "claude-haiku-4-5-20251001",
  "maxRetries": 2,
  "requireApproval": true,
  "monthlyBudgetUsd": 20.00,
  "docsDir": "docs",
  "tracesDir": ".agent/traces",
  "skillsDir": ".agent/skills",
  "mockupsDir": ".agent/mockups",

  "workspaces": {
    "api": {
      "root": "apps/api",
      "framework": "express",
      "language": "ts",
      "srcDir": "src",
      "testDir": "tests",
      "skillsDir": ".agent/skills/api",
      "agents": ["be"],
      "doNotModify": ["src/index.ts", "src/middleware/error.ts"]
    },
    "web": {
      "root": "apps/web",
      "framework": "next",
      "language": "ts",
      "srcDir": "src",
      "testDir": "tests/e2e",
      "skillsDir": ".agent/skills/web",
      "agents": ["fe"],
      "doNotModify": ["src/app/layout.tsx"]
    }
  }
}
```

**Key fields:**

| Field | Description |
|---|---|
| `root` | Path to the package, relative to the monorepo root |
| `framework` | Informs prompt context and default conventions |
| `agents` | `["be"]`, `["fe"]`, or `["both"]` — controls which agent roles work here |
| `skillsDir` | Per-workspace skill overrides (falls back to `.agent/skills/` shared files) |
| `doNotModify` | Files agents must never touch, in addition to the global list |

#### 3. Per-workspace skills

Shared skills apply to all workspaces. Workspace-specific skills go in their own directory:

```
.agent/skills/
  shared/             ← loaded for every agent in every workspace
    json-output.md
    registry-awareness.md
  api/                ← loaded only for tasks in the "api" workspace
    db-patterns.md    ← your migration approach, query conventions
    auth-middleware.md
  web/                ← loaded only for tasks in the "web" workspace
    design-system.md  ← ⭐ your actual design tokens
    component-rules.md
```

#### 4. Directory structure

After init, the monorepo looks like:

```
my-monorepo/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   └── tests/           ← BE integration tests
│   └── web/
│       ├── src/
│       └── tests/e2e/
│           ├── critical-paths/  ← fill these in
│           └── features/        ← agents write here
├── .agent/
│   ├── config.json
│   └── skills/
│       ├── shared/
│       ├── api/
│       └── web/
├── docs/                    ← generated per run (shared across workspaces)
└── .env
```

#### 5. Task routing

The planner assigns each task a `workspace` field that routes it to the correct package. BE tasks target the `api` workspace; FE tasks target the `web` workspace. File paths in each task are relative to the workspace root, not the monorepo root.

```json
{
  "id": "be-001",
  "agent": "be",
  "workspace": "api",
  "title": "POST /api/v1/auth/register",
  "scope": {
    "files_to_create": ["src/routes/auth.ts"],
    "files_to_read": ["src/db/client.ts"]
  }
}
```

```json
{
  "id": "fe-001",
  "agent": "fe",
  "workspace": "web",
  "title": "RegisterForm component",
  "scope": {
    "files_to_create": ["src/components/auth/RegisterForm.tsx"]
  },
  "depends_on": ["be-001"]
}
```

#### 6. Playwright config (FE workspace)

Place `playwright.config.ts` in the FE workspace root (`apps/web/`):

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  use: {
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: '**/setup/*.setup.ts' },
    {
      name: 'features',
      testMatch: '**/features/**/*.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/fixtures/auth.json',
      },
      dependencies: ['setup'],
    },
  ],
})
```

#### 7. Run a feature

```bash
agent run "add user authentication with login and register"
```

The planner generates tasks tagged to the correct workspace. BE tasks build in `apps/api`, FE tasks build in `apps/web`. Each still runs in an isolated git worktree, and registry state (shared types, component inventory) is shared across workspaces within a run so the FE knows exactly what the BE produced.

#### 8. Sandbox per workspace (optional)

Add sandbox config at the top level — it applies to whichever workspace is being executed:

```json
{
  "sandbox": {
    "docker": false,
    "commands": {
      "install":    "npm install",
      "typecheck":  "npm run typecheck",
      "test":       "npm test",
      "playwright": "npx playwright test"
    },
    "timeoutMs": 120000
  }
}
```

For monorepos using npm/pnpm workspaces, you may want to override commands per workspace. This is not yet supported at the config level — use the `doNotModify` list and workspace-specific scripts as a workaround until per-workspace sandbox commands are added.

---

## Configuration

Generated at `.agent/config.json` by `agent init`. All fields optional — sensible defaults apply.

```json
{
  "model": "claude-sonnet-4-6",
  "fastModel": "claude-haiku-4-5-20251001",
  "maxRetries": 2,
  "requireApproval": true,
  "framework": "next",
  "language": "ts",
  "srcDir": "src",
  "docsDir": "docs",
  "tracesDir": ".agent/traces",
  "skillsDir": ".agent/skills",
  "mockupsDir": ".agent/mockups",
  "testDir": "tests/e2e"
}
```

### Sandbox (optional)

Enable runtime sandbox execution inside Docker or directly on the host:

```json
{
  "sandbox": {
    "docker": false,
    "image": "mcr.microsoft.com/playwright/node:lts-jammy",
    "commands": {
      "install":    "npm install",
      "typecheck":  "npm run typecheck",
      "test":       "npm test",
      "playwright": "npx playwright test"
    },
    "timeoutMs": 120000
  }
}
```

`docker: false` runs phases directly in the isolated worktree on your machine. `docker: true` mounts the worktree into the specified container image — useful for reproducible CI-like execution. Omit the `sandbox` block entirely to skip sandbox execution and use the existing static validation + LLM review path.

### Environment variables

- `ANTHROPIC_API_KEY` — required, never goes in config.json
- `AGENT_MODEL` — overrides model
- `FAST_MODEL` — overrides fastModel
- `MAX_RETRIES` — overrides maxRetries
- `REQUIRE_PRD_APPROVAL=false` — skip human approval

---

## Skills system

Skills are markdown files injected into agent prompts. They live in `.agent/skills/` and override package defaults of the same name.

```
.agent/skills/
  shared/
    project.md          ← auto-generated by agent init (your stack + conventions)
    json-output.md
    registry-awareness.md
    journal-decisions.md
  be/
    api-conventions.md  ← response format, status codes, error shapes
  fe/
    design-system.md    ← ⭐ edit this with your tokens
    component-rules.md
  designer/
    designer-rules.md
  planner/
    prd-format.md
  testing/
    e2e-conventions.md
    critical-paths.md
```

To add a custom skill, create any `.md` file in the right subdirectory. It loads automatically.

---

## Mockup support

Drop a PNG/JPG/WebP at `.agent/mockups/[task-id].png` before running. The Designer agent will use it as visual reference for that task's component spec.

```bash
cp my-design.png .agent/mockups/fe-001.png
agent run "add register page"
```

---

## CLI commands

```bash
agent init                    # scaffold .agent/, skills, tests, config
agent init --scan-existing    # also pre-populate registry from existing code
agent run "task description"  # full loop: plan → design → build → test
agent status                  # task queue + ownership summary
agent journal                 # recent decisions and corrections
agent journal --task fe-001   # filter by task
agent ownership               # file ownership graph
agent ownership --stale       # show only stale files
agent validate src/comp.tsx   # run static AST checks on a file
```

---

## Task states

| State | Meaning |
|---|---|
| `pending` | Not yet started |
| `in_progress` | Currently building |
| `pass` | Reviewer passed, committed to main |
| `blocked` | Exhausted retries — manual intervention needed |
| `manually_completed` | Marked done by the developer |
| `retrying` | Pi classified failure as retryable; retry in progress |
| `escalated` | Pi classified failure as requiring human escalation |
| `awaiting_approval` | Confidence gate denied auto-commit; pending sign-off |
| `runtime_failed` | Sandbox execution failed outside the retry budget |

---

## Observability

Every sandbox run produces a `SandboxArtifact` persisted at:

```
.agent/traces/<run-id>/<task-id>-attempt-<n>.json
```

The artifact includes full stdout/stderr, complete test results (pass + fail + skip + timeout with full stack traces), Playwright screenshots and trace file paths, and execution timing. `AttemptTrace` records in the main run log reference their artifact file so every LLM review is linked to the sandbox run that preceded it.

---

## Cost

Two model tiers keep costs low:

| Operation | Model | Why |
|-----------|-------|-----|
| Planning, building | Sonnet (smart) | Needs judgment |
| Reviewing, contracts, design specs | Haiku (fast) | Checklist operations |

Typical cost for a 10-task feature: **$0.15–0.30**.  
Override in `.agent/config.json` with `"model"` and `"fastModel"`.

---

## What gets committed vs gitignored

**Committed** (valuable history):
- `docs/` — PRDs, contracts, task queue, journal
- `.agent/skills/` — your customised skills
- `tests/e2e/` — test files

**Gitignored** (runtime state):
- `.agent/traces/` — sandbox artifacts and run logs
- `.agent/mockups/` — design references
- `docs/registry/` — rebuilt each run
- `tests/e2e/fixtures/auth.json` — Playwright auth state

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a full reference covering the registry kernel, ownership graph, scoped context engine, static validation pipeline, runtime sandbox, hook system, observability layer, and regression attribution engine.
