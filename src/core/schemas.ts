import { z } from "zod"

// ─── Task Schemas ─────────────────────────────────────────────────────────────

export const TaskScopeSchema = z.object({
  files_to_create: z.array(z.string()),
  files_to_modify: z.array(z.string()),
  files_to_read: z.array(z.string()),
  do_not_touch: z.array(z.string()),
})

export const TaskContractSchema = z.object({
  endpoint: z.string().optional(),
  request: z.record(z.unknown()).optional(),
  response_success: z.object({
    status: z.number(),
    body: z.record(z.unknown()),
  }).optional(),
  response_errors: z.array(z.object({
    status: z.number(),
    code: z.string(),
  })).optional(),
})

export const TaskSchema = z.object({
  id: z.string(),
  agent: z.enum(["be", "fe"]),
  workspace: z.string().optional(),
  title: z.string(),
  description: z.string(),
  scope: TaskScopeSchema,
  contracts: TaskContractSchema.optional(),
  acceptance_criteria: z.array(z.string()).min(1),
  depends_on: z.array(z.string()),
  status: z.enum(["pending", "in_progress", "pass", "blocked", "manually_completed"]),
  attempts: z.number(),
})

export const TaskQueueSchema = z.object({
  run_id: z.string(),
  feature: z.string(),
  created_at: z.string(),
  tasks: z.array(TaskSchema),
})

// ─── Planner Output Schema ────────────────────────────────────────────────────

const PlannerTaskSchema = TaskSchema.omit({ status: true, attempts: true })

export const PlannerOutputSchema = z.object({
  summary: z.string(),
  be_steps: z.array(PlannerTaskSchema),
  fe_steps: z.array(PlannerTaskSchema),
})

// ─── Registry Schemas ─────────────────────────────────────────────────────────

export const RegistryFileEntrySchema = z.object({
  path: z.string(),
  status: z.enum(["created", "modified"]),
  exports: z.array(z.string()),
  task_id: z.string(),
  summary: z.string(),
})

export const SharedTypeEntrySchema = z.object({
  name: z.string(),
  defined_in: z.string(),
  export: z.string(),
  shape: z.record(z.unknown()),
  defined_by: z.enum(["be", "fe"]),
  task_id: z.string(),
})

export const ComponentEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  props: z.record(z.string()),
  consumes: z.array(z.string()),
  task_id: z.string(),
})

export const HookEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  returns: z.record(z.string()),
  task_id: z.string(),
})

export const BeRegistrySchema = z.object({ files: z.array(RegistryFileEntrySchema) })
export const FeRegistrySchema = z.object({ files: z.array(RegistryFileEntrySchema) })
export const SharedTypesRegistrySchema = z.object({ types: z.array(SharedTypeEntrySchema) })
export const ComponentsRegistrySchema = z.object({ components: z.array(ComponentEntrySchema) })
export const HooksRegistrySchema = z.object({ hooks: z.array(HookEntrySchema) })

// ─── Journal Schema ───────────────────────────────────────────────────────────

export const JournalEntrySchema = z.object({
  task_id: z.string(),
  attempt: z.number(),
  type: z.enum(["decision", "correction", "validator_pass", "validator_fail"]),
  content: z.string(),
  files_affected: z.array(z.string()).optional(),
  timestamp: z.string(),
})

export const RunJournalSchema = z.object({
  run_id: z.string(),
  feature: z.string(),
  entries: z.array(JournalEntrySchema),
})

// ─── Builder Output Schema ────────────────────────────────────────────────────

export const ChangeSchema = z.object({
  file: z.string(),
  action: z.enum(["create", "update", "delete"]),
  content: z.string(),
})

const RegistryFileEntryNoTaskSchema = RegistryFileEntrySchema.omit({ task_id: true })
const SharedTypeEntryNoTaskSchema = SharedTypeEntrySchema.omit({ task_id: true })
const ComponentEntryNoTaskSchema = ComponentEntrySchema.omit({ task_id: true })
const HookEntryNoTaskSchema = HookEntrySchema.omit({ task_id: true })

export const RegistryUpdatesSchema = z.object({
  shared_types: z.array(SharedTypeEntryNoTaskSchema).optional(),
  components: z.array(ComponentEntryNoTaskSchema).optional(),
  hooks: z.array(HookEntryNoTaskSchema).optional(),
  be_files: z.array(RegistryFileEntryNoTaskSchema).optional(),
  fe_files: z.array(RegistryFileEntryNoTaskSchema).optional(),
})

export const BuilderOutputSchema = z.object({
  changes: z.array(ChangeSchema),
  summary: z.string(),
  registry_updates: RegistryUpdatesSchema,
  decisions: z.array(z.string()),
})

// ─── Reviewer Output Schema ───────────────────────────────────────────────────

export const ReviewerOutputSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  feedback: z.array(z.string()),
  criteria_results: z.array(z.object({
    criterion: z.string(),
    passed: z.boolean(),
    notes: z.string().optional(),
  })),
})

// ─── Contract Schemas ─────────────────────────────────────────────────────────

export const ApiEndpointSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  description: z.string(),
  request_body: z.record(z.unknown()).optional(),
  response: z.record(z.unknown()),
  errors: z.array(z.object({ status: z.number(), message: z.string() })),
})

export const ApiContractSchema = z.object({
  version: z.string(),
  base_path: z.string(),
  endpoints: z.array(ApiEndpointSchema),
})

export const UiContractSchema = z.object({
  components: z.array(z.object({
    name: z.string(),
    description: z.string(),
    props: z.record(z.string()),
    consumes_endpoints: z.array(z.string()),
  })),
  pages: z.array(z.object({
    path: z.string(),
    name: z.string(),
    components: z.array(z.string()),
  })),
})

export const ContractExtractorOutputSchema = z.object({
  api_contract: ApiContractSchema,
  ui_contract: UiContractSchema,
})

// ─── Test Scope Schema ────────────────────────────────────────────────────────

export const TestScopeSchema = z.object({
  test_file: z.string(),
  test_type: z.enum(["e2e", "integration", "smoke"]),
  critical_paths: z.array(z.string()).min(1),
  requires_auth: z.boolean(),
})

// ─── Updated Task Schema with optional test_scope ─────────────────────────────

export const TaskWithTestSchema = TaskSchema.extend({
  test_scope: TestScopeSchema.optional(),
})

// ─── Design Spec Schema (low-fidelity) ───────────────────────────────────────

export const DesignComponentSchema = z.object({
  name: z.string(),
  role: z.string(),
  variant: z.string().optional(),
  notes: z.string().optional(),
})

export const DesignSpecSchema = z.object({
  task_id: z.string(),
  component: z.string(),
  layout_structure: z.string(),
  component_inventory: z.array(DesignComponentSchema),
  states: z.object({
    loading: z.string().optional(),
    error: z.string().optional(),
    empty: z.string().optional(),
    success: z.string().optional(),
  }),
  reused_components: z.array(z.string()),
  new_components: z.array(z.string()),
  testids: z.record(z.string()),
})

export const DesignOutputSchema = z.object({
  spec: DesignSpecSchema,
  rationale: z.string(),
})
