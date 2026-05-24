import type { HookPolicies } from "./types.js"

// Canonical failure policy per hook.
// Gate hooks: fail-open (proceed) or fail-closed (block).
// Mutation hooks: passthrough (return input unchanged on error).
// Notification hooks: ignore (swallow error silently).
export const hookPolicies: HookPolicies = {
  beforeBuild:   "passthrough",
  afterBuild:    "ignore",
  beforeRuntime: "fail-open",
  afterRuntime:  "ignore",
  onFailure:     "ignore",
  beforeRetry:   "passthrough",
  afterRetry:    "ignore",
  beforeCommit:  "fail-closed",
}
