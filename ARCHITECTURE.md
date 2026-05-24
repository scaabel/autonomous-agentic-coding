# Agent System — Architecture & Design Reference

> A multi-agent AI development system for solo developers.  
> Build, review, and ship features with full visibility and no manual coding per step.

---

## Table of Contents

1. [The Problem Being Solved](#1-the-problem-being-solved)
2. [Execution Flow](#2-execution-flow)
3. [File Layout](#3-file-layout)
4. [The Registry System](#4-the-registry-system)
5. [The Run Journal](#5-the-run-journal)
6. [Context Assembly](#6-context-assembly)
7. [Agent Roles](#7-agent-roles)
8. [Skills System](#8-skills-system)
9. [Model Routing & Cost](#9-model-routing--cost)
10. [Task Schema](#10-task-schema)
11. [Builder Output Contract](#11-builder-output-contract)
12. [Design Principles](#12-design-principles)
13. [Getting Started](#13-getting-started)
14. [Extending the System](#14-extending-the-system)

---

## 1. The Problem Being Solved

A naive multi-agent system fails in predictable ways:

| Problem | What Happens |
|---------|-------------|
| **Agent amnesia** | Each task starts with no memory of prior decisions — agents guess and conflict |
| **Duplicate code** | FE builds `useAuth`, then another FE task builds `useAuth` again |
| **Type mismatches** | BE defines `User` one way, FE redefines it differently |
| **File collisions** | BE and FE both create `src/types/user.ts` with incompatible content |
| **Design drift** | FE uses arbitrary hex values instead of design tokens |
| **Brittle retries** | Reviewer fails a step but feedback is never passed back — retry produces the same output |

This system solves all of them through three mechanisms: a **registry** (what exists), a **journal** (what was decided), and **sliced context** (only what's relevant per task).

---

## 2. Execution Flow

```
User Input
    │
    ▼
┌─────────────┐
│  PRD Agent  │  reads: skills/planner/
│             │  writes: docs/prd.json
│             │          docs/api-contract.json
│             │          docs/ui-contract.json
│             │          docs/task-queue.json
└──────┬──────┘
       │
       ▼
  ⏸ HUMAN CHECKPOINT
  Review docs/ — edit task-queue.json if needed — approve
       │
       ▼
┌──────────────────┐
│  Registry Init   │  creates empty registry files in docs/registry/
└──────┬───────────┘
       │
       ▼  (for each task in task-queue.json, BE first then FE)
┌───────────────────────────────────────────────────────────────────┐
│                       Orchestrator Loop                           │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  Context Builder  (no LLM — deterministic)               │     │
│  │  reads: registry + journal (sliced) + files_to_read      │     │
│  │  returns: ScopedContext { text, tokenCount, sections }   │     │
│  └─────────────────────────┬────────────────────────────────┘     │
│                            │                                      │
│                   → beforeBuild hook (mutation)                   │
│                     Pi context-compressor runs here               │
│                            │                                      │
│  ┌─────────────────────────▼────────────────────────────────┐     │
│  │  Builder Agent (BE or FE)                                │     │
│  │  reads: context + skills/{role}/ + api slice + feedback  │     │
│  │  returns: changes + registry_updates + decisions         │     │
│  └─────────────────────────┬────────────────────────────────┘     │
│                            │                                      │
│                   → afterBuild hook (notification)                │
│                            │                                      │
│  ┌─────────────────────────▼────────────────────────────────┐     │
│  │  Static Validators  (no LLM)                             │     │
│  │  ownership · schema · contracts · AST · test coverage    │     │
│  │  errors → NormalizedFailure → onFailure hook             │     │
│  └─────────────────────────┬────────────────────────────────┘     │
│                            │                                      │
│                   → beforeRuntime hook (gate)                     │
│                            │                                      │
│  ┌─────────────────────────▼────────────────────────────────┐     │
│  │  Git Worktree  (isolated per attempt)                    │     │
│  │  apply file changes → commit in worktree                 │     │
│  └─────────────────────────┬────────────────────────────────┘     │
│                            │                                      │
│  ┌─────────────────────────▼────────────────────────────────┐     │
│  │  Sandbox  (optional — see config)                        │     │
│  │  install → typecheck → test → playwright                 │     │
│  │  returns: SandboxArtifact → persisted to traces/         │     │
│  └─────────────────────────┬────────────────────────────────┘     │
│                            │                                      │
│                   → afterRuntime hook (notification)              │
│                   → onFailure hook if exitCode ≠ 0               │
│                   → beforeRetry hook (mutation, Pi triage)        │
│                            │                                      │
│  ┌─────────────────────────▼────────────────────────────────┐     │
│  │  Reviewer Agent                                          │     │
│  │  reads: worktree diff + skills + api slice               │     │
│  │  returns: pass/fail + feedback + criteria                │     │
│  └─────────────────────────┬────────────────────────────────┘     │
│                            │                                      │
│                   → beforeCommit hook (gate — confidence gate)    │
│                            │                                      │
│              pass ─────────┤──── fail                            │
│                │           │         │                            │
│  cherry-pick to main       │    beforeRetry hook (mutation)       │
│  apply registry            │    append journal                    │
│  append journal            │    retry (max 2×)                    │
│  next task                 │    block if exhausted                │
│                            │                                      │
└────────────────────────────┴──────────────────────────────────────┘
       │
       ▼
  traces/<run-id>/<task-id>-attempt-<n>.json  +  cost summary
```

Each attempt runs in a throwaway git worktree. The working tree is never dirtied by a failing attempt. On reviewer pass the worktree commit is cherry-picked into the main branch; on failure the worktree is deleted.

---

## 3. File Layout

```
agent-system/
│
├── src/
│   ├── cli/
│   │   └── index.ts              # agent run / agent status / agent journal
│   │
│   ├── agents/
│   │   ├── planner.ts            # PRD agent + contract extractor
│   │   ├── builder.ts            # BE/FE builder — dispatches beforeBuild hook
│   │   ├── reviewer.ts           # Validator (Haiku — checklist operation)
│   │   ├── designer.ts           # FE design spec agent
│   │   └── test-runner.ts        # Playwright runner — returns TestResult[]
│   │
│   ├── orchestrator/
│   │   ├── run.ts                # top-level run loop, phases, cost summary
│   │   └── step-runner.ts        # per-task: worktree → sandbox → hooks → review → cherry-pick
│   │
│   ├── sandbox/
│   │   └── executor.ts           # Docker/host sandbox — returns SandboxArtifact
│   │
│   ├── core/
│   │   ├── types.ts              # all TypeScript types
│   │   ├── schemas.ts            # Zod schemas (runtime validation)
│   │   ├── registry.ts           # registry reads/writes
│   │   ├── router.ts             # Anthropic SDK + model tier routing + token tracking
│   │   ├── git.ts                # git ops including worktree create/remove/cherry-pick
│   │   ├── skills.ts             # skill file loader
│   │   ├── config.ts             # AgentConfig loader (env + file merge)
│   │   ├── budget.ts             # monthly spend tracking and enforcement
│   │   ├── logger.ts             # RunTrace writer
│   │   ├── workspace.ts          # monorepo workspace resolution
│   │   │
│   │   ├── context/
│   │   │   ├── scoped-context.ts # deterministic context assembly → ScopedContext
│   │   │   └── types.ts          # ScopedContext { text, tokenCount, sections }
│   │   │
│   │   ├── failures/
│   │   │   ├── types.ts          # NormalizedFailure, SandboxArtifact, TestResult, BrowserLog
│   │   │   └── normalize.ts      # ValidationError → NormalizedFailure adapters
│   │   │
│   │   ├── hooks/
│   │   │   ├── types.ts          # HookName, NotificationHook, GateHook, MutationHook
│   │   │   ├── contracts.ts      # 8 hook payload types (BeforeBuildHook … BeforeCommitHook)
│   │   │   ├── hookPolicies.ts   # per-hook failure policy (fail-open/closed/passthrough/ignore)
│   │   │   ├── registry.ts       # hookRegistry singleton — register / get / clear
│   │   │   └── dispatcher.ts     # dispatchMutation / dispatchGate / dispatchNotification
│   │   │
│   │   ├── confidence/
│   │   │   └── types.ts          # ConfidenceResult { score, tier, signals, explanation }
│   │   │
│   │   ├── retry/
│   │   │   └── types.ts          # RetryHistory, DiagnosisRecord, BuilderRetryInput
│   │   │
│   │   ├── observability/
│   │   │   ├── playwright-parser.ts  # Playwright JSON → TestResult[] + attachments
│   │   │   └── artifact-store.ts     # save/load SandboxArtifact to traces/
│   │   │
│   │   ├── kernel/
│   │   │   └── ownership.ts      # file → task ownership index + staleness tracking
│   │   │
│   │   ├── validation/
│   │   │   └── static-validators.ts  # ownership · schema · contracts · AST · test coverage
│   │   │
│   │   └── attribution/
│   │       └── regression.ts     # failing test → culprit task attribution
│   │
│   ├── integrations/
│   │   └── pi/
│   │       └── index.ts          # PiSkillInvoker interface + null PiClient (swap when ready)
│   │
│   ├── prompts/
│   │   ├── planner.ts
│   │   ├── builder.ts
│   │   └── reviewer.ts
│   │
│   └── utils/
│       ├── parse.ts              # safe JSON parser with Zod validation
│       ├── file.ts               # apply file changes (worktreeRoot-aware)
│       └── input.ts              # readline helpers
│
├── skills/
│   ├── shared/
│   ├── be/
│   ├── fe/
│   ├── designer/
│   ├── testing/
│   └── planner/
│
├── docs/                         # generated per run (git-tracked)
│   ├── prd.json
│   ├── api-contract.json
│   ├── ui-contract.json
│   ├── task-queue.json
│   ├── run-journal.json
│   └── registry/
│       ├── be-registry.json
│       ├── fe-registry.json
│       ├── shared-types.json
│       ├── components-registry.json
│       └── hooks-registry.json
│
└── .agent/traces/                # run logs + sandbox artifacts (gitignored)
    └── <run-id>/
        ├── run-<run-id>.json     # RunTrace (LLM cost, AttemptTrace[], artifactRefs)
        └── <task-id>-attempt-<n>.json  # SandboxArtifact
```

---

## 4. The Registry System

The registry is the solution to agent duplication and file collisions. It's a set of files in `docs/registry/` that represent the **live state of what exists in the codebase** at any point during the run.

| File | Owned by | Read by | Prevents |
|------|----------|---------|---------|
| `be-registry.json` | BE builder | BE builder, FE builder | BE duplicating its own work; FE touching BE files |
| `fe-registry.json` | FE builder | FE builder | FE duplicating its own work |
| `shared-types.json` | BE builder | Both builders | Type redefinition, type mismatches |
| `components-registry.json` | FE builder | FE builder | Duplicate components |
| `hooks-registry.json` | FE builder | FE builder | Duplicate hooks |

### How registry updates work

The Builder **proposes** registry updates in its JSON output under `registry_updates`. The Orchestrator **applies** them only after the Reviewer passes. This means:

- Failed attempts don't corrupt the registry
- Registry always reflects passing, committed code
- Updates are atomic per task

### What FE agents see

FE agents receive BE-owned file paths as a hard **do-not-touch** list. They receive components and hooks as **name → path** inventory only (not full definitions) to keep context small. If they need the actual content of a component, it must appear in `scope.files_to_read`.

---

## 5. The Run Journal

`docs/run-journal.json` is the **shared working memory** of the entire run. Every agent reads it before acting and appends to it after acting.

### Entry types

| Type | When written | Contains |
|------|-------------|---------|
| `decision` | After builder succeeds | Library choices, response shapes, conventions, gotchas |
| `validator_pass` | After reviewer passes | Which criteria passed, summary |
| `validator_fail` | After reviewer fails | What failed and why |
| `correction` | After a retry succeeds | What was changed to fix the failure |

### What makes a good decision entry

```json
{
  "task_id": "be-002",
  "type": "decision",
  "content": "Used jsonwebtoken@9. Token shape: { token: string, expiresAt: number (unix ms) }. Stored in Authorization header as 'Bearer <token>'.",
  "files_affected": ["src/routes/auth.ts", "src/lib/jwt.ts"]
}
```

This is what the FE agent reads when building the login form — it knows exactly what token shape to expect without guessing.

### Context slicing rules

The journal is **not** injected in full. `buildTaskContext()` injects:
- Last 5 entries (sliding window)
- Any entry whose `files_affected` overlaps with the current task's file scope

This keeps token costs flat regardless of run length.

---

## 6. Context Assembly

`buildTaskContext()` in `src/core/registry.ts` assembles the prompt context for each task deterministically — no LLM involved. The output depends on the agent role:

**BE agent receives:**
```
## Shared Types (import these)
- User → src/types/user.ts

## BE Files Already Created
- src/routes/auth.ts — exports: registerHandler

## Prior Decisions & Corrections
[be-001 / decision] Used bcrypt@5 for hashing. Cost factor: 12.

## Existing File: src/db/client.ts
```(file contents)```
```

**FE agent receives:**
```
## Shared Types (import these)
- User → src/types/user.ts
- AuthResponse → src/types/auth.ts

## BE-Owned Files (DO NOT touch)
- src/routes/auth.ts
- src/lib/jwt.ts

## FE Files Already Created
- src/components/auth/LoginForm.tsx

## Existing Components (reuse before creating)
- LoginForm → src/components/auth/LoginForm.tsx
- Button → src/components/ui/button.tsx

## Existing Hooks (reuse before creating)
- useAuth → src/hooks/useAuth.ts

## Prior Decisions & Corrections
[be-002 / decision] Token shape: { token: string, expiresAt: number }

## Existing File: src/lib/api.ts
```(file contents)```
```

The FE agent cannot accidentally redefine `User`, recreate `LoginForm`, or create a file at `src/routes/auth.ts` — all of this is encoded in the context before a single token of the builder prompt is generated.

---

## 7. Agent Roles

### PRD Agent
- **Model:** Sonnet (needs judgment for decomposition)
- **Input:** natural language task + planner skill
- **Output:** `docs/prd.json`, `docs/api-contract.json`, `docs/ui-contract.json`, `docs/task-queue.json`

### Contract Extractor
- **Model:** Haiku (structured extraction — no judgment needed)
- **Input:** PRD summary + step lists
- **Output:** machine-readable API and UI contracts

### Builder (BE/FE)
- **Model:** Sonnet
- **Input:** task + sliced context + role skills + API contract slice + prior feedback
- **Output:** file changes + registry_updates + decisions
- The same agent function handles both BE and FE — role is determined by `task.agent`

### Reviewer
- **Model:** Haiku (checklist operation)
- **Input:** git diff + task acceptance criteria + role skills + API contract slice
- **Output:** pass/fail + per-criterion results + feedback for retry

---

## 8. Skills System

Skills are markdown files injected verbatim into agent system prompts. They encode your project's conventions so agents don't have to guess.

### Loading order
1. `skills/shared/*.md` — loaded for every agent
2. `skills/{role}/*.md` — loaded for that role only

### The most important skill to customise

**`skills/fe/design-system.md`** — edit this before your first run. It contains:
- Color tokens (CSS variables + Tailwind)
- Typography scale
- Spacing rules
- Component library mapping (which component to use for what)
- Hard prohibitions (no raw hex, no inline styles, etc.)

If this file reflects your actual project, the FE agent will produce design-consistent output on the first attempt.

### Adding skills

Create any `.md` file in the appropriate `skills/` subdirectory. It's included automatically on the next run. Examples:

```
skills/be/db-patterns.md      # how you do migrations, queries, transactions
skills/be/auth-middleware.md  # your specific JWT middleware interface
skills/fe/tailwind-config.md  # your exact Tailwind theme values
skills/fe/error-handling.md   # your toast/error display patterns
```

---

## 9. Model Routing & Cost

Two model tiers. Use the right one for the right job:

| Tier | Default Model | Used for |
|------|--------------|---------|
| `smart` | `claude-sonnet-4-6` | PRD generation, building (BE + FE) |
| `fast` | `claude-haiku-4-5-20251001` | Contract extraction, reviewing |

Override in `.env`:
```bash
AGENT_MODEL=claude-sonnet-4-6       # smart tier
FAST_MODEL=claude-haiku-4-5-20251001 # fast tier
```

For maximum savings, set `AGENT_MODEL=claude-haiku-4-5-20251001`. Quality will be lower but a 10-task feature costs ~$0.05 instead of ~$0.25.

### Estimated cost per 10-task feature

| Setup | Est. cost |
|-------|----------|
| Sonnet (smart) + Haiku (fast), 80% first-pass | ~$0.20–0.30 |
| All Haiku | ~$0.03–0.06 |
| All Sonnet | ~$0.50–0.80 |

Cost is tracked per run and printed on completion. The trace JSON includes full token counts per attempt.

### The real cost driver

**Retry rate.** A task that retries twice costs 3× a first-pass task. The fix is task quality — specific acceptance criteria, explicit `files_to_touch`, and well-tuned skills. Track `first_pass_count / total_tasks` in your traces. Below 70% means your tasks or skills need work.

---

## 10. Task Schema

Each task in `docs/task-queue.json` is fully self-describing:

```json
{
  "id": "fe-001",
  "agent": "fe",
  "title": "RegisterForm component",
  "description": "Implement the registration form. Call POST /api/v1/auth/register.",
  "scope": {
    "files_to_create": ["src/components/auth/RegisterForm.tsx"],
    "files_to_modify": [],
    "files_to_read": ["src/lib/api.ts", "src/types/auth.ts"],
    "do_not_touch": ["src/components/ui/"]
  },
  "contracts": {
    "endpoint": "POST /api/v1/auth/register",
    "request": { "email": "string", "password": "string" },
    "response_success": { "status": 201, "body": { "data": { "id": "string" } } },
    "response_errors": [
      { "status": 400, "code": "VALIDATION_ERROR" },
      { "status": 409, "code": "CONFLICT" }
    ]
  },
  "acceptance_criteria": [
    "Form renders email, password, confirm-password inputs and a submit button",
    "Validates password === confirmPassword client-side before submitting",
    "Calls POST /api/v1/auth/register on submit",
    "Shows loading state while request is in-flight",
    "Displays field-level errors from API response",
    "All colors use design system tokens — no raw hex values"
  ],
  "depends_on": ["be-001"],
  "status": "pending",
  "attempts": 0
}
```

### Rules for good tasks
- **Max 3 files** in `files_to_create + files_to_modify` — split if more
- **Specific criteria** — "Returns 201 with `{ data: { id } }`" not "works correctly"
- **Explicit `files_to_read`** — if the builder needs to see a file to do its job, list it
- **Tight `do_not_touch`** — prevents accidental wide changes

---

## 11. Builder Output Contract

The builder returns this exact shape:

```json
{
  "changes": [
    {
      "file": "src/components/auth/RegisterForm.tsx",
      "action": "create",
      "content": "// full file content as string"
    }
  ],
  "summary": "Created RegisterForm with validation and API call",
  "registry_updates": {
    "fe_files": [
      {
        "path": "src/components/auth/RegisterForm.tsx",
        "status": "created",
        "exports": ["RegisterForm"],
        "summary": "Registration form component"
      }
    ],
    "components": [
      {
        "name": "RegisterForm",
        "path": "src/components/auth/RegisterForm.tsx",
        "props": { "onSuccess": "() => void" },
        "consumes": ["/api/v1/auth/register"]
      }
    ],
    "hooks": [],
    "shared_types": [],
    "be_files": []
  },
  "decisions": [
    "Used react-hook-form + zod for form validation, consistent with LoginForm pattern"
  ]
}
```

The Orchestrator applies `registry_updates` only after the Reviewer passes. The Builder never writes directly to registry files.

---

## 12. Design Principles

**1. Files as memory, not conversation**  
Every agent reads from files on disk. Same files = same context. Reproducible, inspectable, version-controllable.

**2. Registries prevent duplication**  
No agent creates anything without first checking what already exists. The registry is the authoritative list of what exists.

**3. Journal captures decisions, not just outcomes**  
The journal records *why* things were built a certain way — library choices, shape decisions, gotchas. Future agents read this before acting.

**4. Context is sliced, not dumped**  
Each agent receives only the registry entries relevant to its task. Token cost stays flat regardless of run length.

**5. Registry writes are gated by passing review**  
Orchestrator applies registry updates only after the Reviewer passes. Failed attempts don't pollute the registry.

**6. Human in the loop at the right point**  
One checkpoint after planning, before any code is written. The plan is cheap to generate and easy to review. The code is expensive — you want to review the plan, not debug the code.

**7. Small tasks, strict scope**  
Tasks with clear scope and explicit file lists produce focused, reviewable diffs. The tighter the task, the higher the first-pass rate.

**8. Retry with feedback, not repetition**  
Reviewer feedback is passed back into the builder prompt on every retry. The same mistake is never made twice.

---

## 13. Getting Started

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# → add ANTHROPIC_API_KEY

# 3. Customise your design system
# Edit skills/fe/design-system.md with your actual tokens

# 4. Run
npm run dev -- run "add user authentication with login and register pages"

# 5. Review the plan (docs/ will be created)
# Edit docs/task-queue.json if needed, then press Enter

# 6. Watch agents build, commit, and review each step

# 7. Check status anytime
npm run dev -- status

# 8. Review decisions
npm run dev -- journal
```

---

## 14. Extending the System

### Add a new skill
Create `skills/{role}/your-skill.md`. It's loaded automatically.

### Add a new agent role
1. Add the role to `AgentRole` in `types.ts`
2. Create `skills/{role}/` directory with skill files
3. Add the role's prompt to `prompts/`
4. Add the agent function to `agents/`
5. Add the role's tasks to the task queue with the new `agent` value

### Add resume support
When a run is blocked, the task queue has the last known state. A `agent resume` command would:
1. Read `docs/task-queue.json`
2. Find the first `blocked` task
3. Prompt the user to fix it manually + commit
4. Continue the loop from that task

### Parallel execution
Tasks with no shared `files_to_touch` and no `depends_on` overlap can run in parallel. The task queue dependency graph already encodes this — a parallel executor would just process independent tasks concurrently rather than sequentially.

---

## 15. Task State Machine

Tasks transition through an extended state set. States added in the Pi/sandbox integration are marked *.

| State | Meaning |
|---|---|
| `pending` | Not yet started |
| `in_progress` | Build attempt in progress |
| `pass` | Reviewer passed; commit cherry-picked to main |
| `blocked` | Exhausted retry budget — manual intervention needed |
| `manually_completed` | Developer marked done outside the agent loop |
| `retrying` * | Pi classified failure as retryable; retry underway |
| `escalated` * | Pi classified failure as requiring human escalation |
| `awaiting_approval` * | Confidence gate denied auto-commit; pending sign-off |
| `runtime_failed` * | Sandbox failed outside the retry budget |

---

## 16. Hook System

Hooks are the primary extension point for middleware (Pi, observability, CI gates). The dispatcher handles three semantically distinct hook classes with different composition rules and failure policies.

### Hook classes

| Class | Composition | On error |
|---|---|---|
| `NotificationHook<T>` | Fan-out parallel | `ignore` — swallow silently |
| `GateHook<T>` | Short-circuit on first deny | `fail-open` or `fail-closed` per hook |
| `MutationHook<T>` | Pipeline — outputₙ → inputₙ₊₁ | `passthrough` — return input unchanged |

### Canonical hook sequence

| Hook | Type | Blocks | Purpose |
|---|---|---|---|
| `beforeBuild` | Mutation | Yes | Pi context-compressor; retry-focused context shaping |
| `afterBuild` | Notification | No | Telemetry |
| `beforeRuntime` | Gate | Yes | Abort unsafe sandbox launch |
| `afterRuntime` | Notification | No | Artifact emission to observability systems |
| `onFailure` | Notification | No | Send `NormalizedFailure` + `SandboxArtifact` to Pi |
| `beforeRetry` | Mutation | Yes | Pi injects structured repair feedback into builder prompt |
| `afterRetry` | Notification | No | Record retry outcome |
| `beforeCommit` | Gate | Yes | **Confidence gate** — deny blocks auto-commit |

### Registering a hook

```typescript
import { hookRegistry } from "./src/core/hooks/registry.js"

hookRegistry.register(
  "beforeRetry",
  async (payload) => {
    // call Pi, mutate payload.retryInput.feedback, return payload
    return payload
  },
  { priority: 10, timeoutMs: 5000 }
)
```

The `beforeCommit` gate uses a `fail-closed` policy — a Pi timeout blocks auto-commit rather than allowing an unreviewed commit through.

---

## 17. Runtime Sandbox

The sandbox runs build outputs in isolation before the LLM reviewer sees them. Each attempt gets a dedicated git worktree; the main working tree is never modified by a failing attempt.

### Worktree lifecycle

```
create worktree (temp dir, new branch)
    ↓
apply file changes into worktree
    ↓
commit in worktree
    ↓
sandbox phases run in worktree directory
    ↓
pass → cherry-pick commit to main → remove worktree
fail → discard worktree (no trace on main)
```

### Sandbox phases

| Phase | Default command | Stops on failure |
|---|---|---|
| install | `npm install` | Yes |
| typecheck | `npm run typecheck` | Yes |
| test | `npm test` | Yes |
| playwright | `npx playwright test` | Yes |

Configure via `sandbox.commands` in `.agent/config.json`. Set `sandbox.docker: true` to run phases inside `mcr.microsoft.com/playwright/node:lts-jammy` instead of on the host. Omit the `sandbox` block to skip sandbox execution and use the static validation + LLM review path only.

### `SandboxArtifact`

```typescript
type SandboxArtifact = {
  runId: string
  stdout: string
  stderr: string
  exitCode: number
  screenshots: string[]     // Playwright attachment paths
  traces: string[]          // Playwright .zip trace files
  testResults?: TestResult[]
  browserConsole?: BrowserLog[]
  metrics: { durationMs: number; memoryMb: number }
}
```

Persisted immediately after each run to `.agent/traces/<run-id>/<task-id>-attempt-<n>.json`. `AttemptTrace.artifactRef` links every LLM review to its sandbox run.

---

## 18. Observability Core

### `TestResult` — canonical test primitive

```typescript
type TestResult = {
  name: string
  status: "passed" | "failed" | "skipped" | "timed_out"
  durationMs: number
  error?: string      // full message + stack trace (not truncated)
  file?: string
}
```

`TestResult[]` replaces the legacy `FailedTest[]` (failures only). `FailedTest` is preserved for backward compatibility and is derived from `TestResult` at the normalization boundary.

### `NormalizedFailure` — canonical failure primitive

All failure sources — static validators, sandbox runtime, LLM reviewer — normalize into one type before entering the retry loop or being dispatched to hooks:

```typescript
type NormalizedFailure = {
  id: string
  source: "static" | "runtime" | "test" | "llm-review"
  phase: "install" | "typecheck" | "lint" | "test" | "playwright" | "review"
  code: string
  message: string
  file?: string
  stackTrace?: string
  severity: "hard" | "soft"
  artifactRefs?: { logs?: string[]; screenshots?: string[]; traces?: string[] }
  timestamp: number
}
```

### `ScopedContext` — structured context

`buildScopedContext()` returns a structured type rather than a raw string:

```typescript
type ScopedContext = {
  text: string           // assembled prompt text (what the builder receives)
  tokenCount: number     // estimated tokens used
  sections: {
    sharedTypes: string
    ownedFiles: string
    journalSlice: string
    fileContents: string // largest section — Pi compresses this first
  }
}
```

The `beforeBuild` mutation hook receives the full `ScopedContext`. When Pi's `context-compressor` skill is registered, it compresses sections exceeding the token threshold before the builder prompt is assembled.

### Playwright reporter

The Playwright JSON reporter requires the `PLAYWRIGHT_JSON_OUTPUT_NAME` environment variable to write its output to a file. The `--output` flag is the artifact directory (screenshots, traces), not the report file — using it for JSON output silently discards the report. Both the test runner and sandbox executor set the env var correctly and parse the resulting JSON into `TestResult[]` with full stack traces and attachment paths.

---

## 19. Pi Integration (planned — Phase 3)

Pi acts as cognitive middleware between the sandbox and the retry loop. It is invoked through the hook system, not as a primary builder or architectural decision-maker.

### Pi skill responsibilities

| Skill | Hook | Input | Output |
|---|---|---|---|
| `runtime-debugger` | `onFailure` | `SandboxArtifact` | `PiDiagnosis` |
| `context-compressor` | `beforeBuild` | `ScopedContext` | compressed context text |
| `retry-classifier` | `beforeRetry` | `NormalizedFailure` + history | `retry` / `escalate` / `abort` / `request_approval` |

### Invocation contract

All Pi skills are called through a single synchronous interface:

```typescript
interface PiSkillInvoker {
  invoke<TInput, TOutput>(skill: PiSkill, payload: TInput): Promise<TOutput>
}
```

The null `PiClient` in `src/integrations/pi/index.ts` throws on any call. Swap it for the real SDK when the Pi integration is configured. All hook call sites are already in place — no step-runner changes needed to activate Pi.
