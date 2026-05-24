// ─── Hook taxonomy ────────────────────────────────────────────────────────────

export type HookName =
  | "beforeBuild"
  | "afterBuild"
  | "beforeRuntime"
  | "afterRuntime"
  | "onFailure"
  | "beforeRetry"
  | "afterRetry"
  | "beforeCommit"

// ─── Failure policies ─────────────────────────────────────────────────────────
// Determines dispatcher behavior when a hook throws.
//
//   fail-open    gate hooks  → proceed as if hook passed
//   fail-closed  gate hooks  → block execution
//   passthrough  mutation hooks → return input unchanged
//   ignore       notification hooks → swallow error silently

export type HookFailurePolicy = "fail-open" | "fail-closed" | "passthrough" | "ignore"

// ─── Hook metadata ────────────────────────────────────────────────────────────
// Carried by every registered hook. Priority controls mutation pipeline order.
// timeoutMs applies to all hook classes (critical for network-bound Pi hooks).

export type HookMetadata = {
  name: string
  priority: number
  timeoutMs?: number
}

// ─── Hook function signatures ─────────────────────────────────────────────────

export type NotificationHook<T> = (input: T) => Promise<void>

export type GateHook<T> = (input: T) => Promise<{ proceed: boolean; reason?: string }>

export type MutationHook<T> = (input: T) => Promise<T>

// ─── Registered hook ─────────────────────────────────────────────────────────

export type RegisteredHook<T> = {
  meta: HookMetadata
  handler: NotificationHook<T> | GateHook<T> | MutationHook<T>
}

// ─── Registry and policy maps ─────────────────────────────────────────────────
// Mapped types over HookName give exhaustiveness checks at compile time.

export type HookRegistry = {
  [K in HookName]: RegisteredHook<unknown>[]
}

export type HookPolicies = {
  [K in HookName]: HookFailurePolicy
}
