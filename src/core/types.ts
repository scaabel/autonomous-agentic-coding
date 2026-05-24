// ─── Agent Role ───────────────────────────────────────────────────────────────

export type AgentRole = "be" | "fe" | "planner" | "reviewer" | "shared" | "testing" | "designer"
export type StepAgent = "be" | "fe"
export type ModelTier = "fast" | "smart"

// ─── Task (unit of work in the queue) ────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "pass" | "blocked" | "manually_completed"

export type TaskScope = {
  files_to_create: string[]
  files_to_modify: string[]
  files_to_read: string[]
  do_not_touch: string[]
}

export type TaskContract = {
  endpoint?: string
  request?: Record<string, unknown>
  response_success?: { status: number; body: Record<string, unknown> }
  response_errors?: { status: number; code: string }[]
}

export type Task = {
  id: string
  agent: StepAgent
  workspace?: string             // monorepo workspace name e.g. "api" | "mobile"
  title: string
  description: string
  scope: TaskScope
  contracts?: TaskContract
  acceptance_criteria: string[]
  depends_on: string[]
  test_scope?: TestScope
  status: TaskStatus
  attempts: number
}

// ─── Task Queue ───────────────────────────────────────────────────────────────

export type TaskQueue = {
  run_id: string
  feature: string
  created_at: string
  tasks: Task[]
}

// ─── Registry Types ───────────────────────────────────────────────────────────

export type RegistryFileEntry = {
  path: string
  status: "created" | "modified"
  exports: string[]
  task_id: string
  workspace?: string
  summary: string
}

export type SharedTypeEntry = {
  name: string
  defined_in: string
  export: string
  shape: Record<string, unknown>
  defined_by: StepAgent
  task_id: string
}

export type ComponentEntry = {
  name: string
  path: string
  props: Record<string, string>
  consumes: string[]
  task_id: string
}

export type HookEntry = {
  name: string
  path: string
  returns: Record<string, string>
  task_id: string
}

export type BeRegistry = { files: RegistryFileEntry[] }
export type FeRegistry = { files: RegistryFileEntry[] }
export type SharedTypesRegistry = { types: SharedTypeEntry[] }
export type ComponentsRegistry = { components: ComponentEntry[] }
export type HooksRegistry = { hooks: HookEntry[] }

// ─── Run Journal ──────────────────────────────────────────────────────────────

export type JournalEntryType = "decision" | "correction" | "validator_pass" | "validator_fail"

export type JournalEntry = {
  task_id: string
  attempt: number
  type: JournalEntryType
  content: string
  files_affected?: string[]
  timestamp: string
}

export type RunJournal = {
  run_id: string
  feature: string
  entries: JournalEntry[]
}

// ─── Builder Output ───────────────────────────────────────────────────────────

export type FileAction = "create" | "update" | "delete"

export type Change = {
  file: string
  action: FileAction
  content: string
}

export type RegistryUpdates = {
  shared_types?: Omit<SharedTypeEntry, "task_id">[]
  components?: Omit<ComponentEntry, "task_id">[]
  hooks?: Omit<HookEntry, "task_id">[]
  be_files?: Omit<RegistryFileEntry, "task_id">[]
  fe_files?: Omit<RegistryFileEntry, "task_id">[]
}

export type BuilderOutput = {
  changes: Change[]
  summary: string
  registry_updates: RegistryUpdates
  decisions: string[]
}

// ─── Reviewer Output ──────────────────────────────────────────────────────────

export type CriterionResult = {
  criterion: string
  passed: boolean
  notes?: string
}

export type ReviewerOutput = {
  verdict: "pass" | "fail"
  feedback: string[]
  criteria_results: CriterionResult[]
}

// ─── PRD / Contract types ─────────────────────────────────────────────────────

export type ApiEndpoint = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: string
  description: string
  request_body?: Record<string, unknown>
  response: Record<string, unknown>
  errors: { status: number; message: string }[]
}

export type ApiContract = {
  version: string
  base_path: string
  endpoints: ApiEndpoint[]
}

export type UiComponent = {
  name: string
  description: string
  props: Record<string, string>
  consumes_endpoints: string[]
}

export type UiContract = {
  components: UiComponent[]
  pages: { path: string; name: string; components: string[] }[]
}

export type PlannerOutput = {
  summary: string
  be_steps: Omit<Task, "status" | "attempts">[]
  fe_steps: Omit<Task, "status" | "attempts">[]
}

// ─── Run Trace (observability) ────────────────────────────────────────────────

export type AttemptTrace = {
  attempt: number
  build: BuilderOutput
  review: ReviewerOutput
  diff: string
  input_tokens: number
  output_tokens: number
  timestamp: string
}

export type StepTrace = {
  task: Task
  attempts: AttemptTrace[]
  status: "pass" | "fail" | "blocked"
}

export type RunTrace = {
  id: string
  task: string
  started_at: string
  finished_at?: string
  status: "running" | "complete" | "blocked" | "failed"
  steps: StepTrace[]
  cost_summary?: CostSummary
}

export type CostSummary = {
  total_tasks: number
  first_pass_count: number
  retry_count: number
  total_input_tokens: number
  total_output_tokens: number
  estimated_cost_usd: number
}

// ─── Model Response (from router) ────────────────────────────────────────────

export type ModelResponse = {
  text: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

// ─── Test Scope (per task) ────────────────────────────────────────────────────

export type TestType = "e2e" | "integration" | "smoke"

export type TestScope = {
  test_file: string            // e.g. tests/e2e/features/auth/login-form.e2e.ts
  test_type: TestType
  critical_paths: string[]     // user flows this test must cover
  requires_auth: boolean       // whether to use storageState fixture
}

// ─── Test Run Result ──────────────────────────────────────────────────────────

export type TestStatus = "pass" | "fail" | "regression" | "skipped"

export type FailedTest = {
  title: string
  file: string
  error: string
  duration_ms: number
}

export type TestRunResult = {
  status: TestStatus
  total: number
  passed: number
  failed: number
  skipped: number
  duration_ms: number
  failed_tests: FailedTest[]
  culprit_task_id?: string     // set when regression is detected
}

// ─── Design Spec (low-fidelity) ───────────────────────────────────────────────

export type DesignComponent = {
  name: string           // design system component name e.g. "Button", "Input", "Card"
  role: string           // what it does in this UI e.g. "submit action", "email field"
  variant?: string       // e.g. "default", "outline", "destructive"
  notes?: string         // anything the Builder needs to know (not styling)
}

export type DesignSpec = {
  task_id: string
  component: string                    // top-level component being built
  layout_structure: string             // plain English: "auth-card", "list-page", or description
  component_inventory: DesignComponent[] // ordered list of design system components to use
  states: {
    loading?: string                   // describe with Skeleton — e.g. "two Skeleton rows"
    error?: string                     // describe placement + testid
    empty?: string                     // only for list/data components
    success?: string                   // redirect, toast, or inline
  }
  reused_components: string[]          // from registry — import, don't recreate
  new_components: string[]             // net-new components introduced by this task
  testids: Record<string, string>      // element description → testid value (source of truth)
}

export type DesignOutput = {
  spec: DesignSpec
  rationale: string                    // key decisions and why
}
