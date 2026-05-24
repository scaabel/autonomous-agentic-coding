import type { Task, BuilderOutput, RegistryUpdates } from "../types.js"
import type { NormalizedFailure, SandboxArtifact } from "../failures/types.js"
import type { ScopedContext } from "../context/types.js"
import type { RetryHistory, BuilderRetryInput } from "../retry/types.js"
import type { ConfidenceResult } from "../confidence/types.js"
import type { MutationHook, NotificationHook, GateHook } from "./types.js"

// ─── beforeBuild ──────────────────────────────────────────────────────────────
// Mutation. Allows Pi/context systems to modify build input before the builder runs.
// Primary injection point for context compression and retry-focused context shaping.

export type BeforeBuildPayload = {
  task: Task
  scopedContext: ScopedContext
  retryHistory: RetryHistory
}
export type BeforeBuildHook = MutationHook<BeforeBuildPayload>

// ─── afterBuild ───────────────────────────────────────────────────────────────
// Notification. Telemetry and observability only — no payload mutation.

export type AfterBuildPayload = {
  task: Task
  output: BuilderOutput
  attempt: number
}
export type AfterBuildHook = NotificationHook<AfterBuildPayload>

// ─── beforeRuntime ────────────────────────────────────────────────────────────
// Gate. Can abort sandbox launch before any container resources are allocated.

export type BeforeRuntimePayload = {
  task: Task
  attempt: number
}
export type BeforeRuntimeHook = GateHook<BeforeRuntimePayload>

// ─── afterRuntime ─────────────────────────────────────────────────────────────
// Notification. Receives the full sandbox artifact for observability and storage.

export type AfterRuntimePayload = {
  task: Task
  artifact: SandboxArtifact
}
export type AfterRuntimeHook = NotificationHook<AfterRuntimePayload>

// ─── onFailure ────────────────────────────────────────────────────────────────
// Notification. Artifact emission to Pi and observability systems.
// Does not block — failure handling continues regardless.

export type OnFailurePayload = {
  task: Task
  failure: NormalizedFailure
  artifact?: SandboxArtifact
}
export type OnFailureHook = NotificationHook<OnFailurePayload>

// ─── beforeRetry ──────────────────────────────────────────────────────────────
// Mutation. Pi injects structured repair feedback here before the next build attempt.
// The mutated retryInput.feedback reaches the builder prompt.

export type BeforeRetryPayload = {
  failure: NormalizedFailure
  retryInput: BuilderRetryInput
}
export type BeforeRetryHook = MutationHook<BeforeRetryPayload>

// ─── afterRetry ───────────────────────────────────────────────────────────────
// Notification. Records retry outcome for observability and Pi diagnosis evolution.

export type AfterRetryPayload = {
  task: Task
  attempt: number
  succeeded: boolean
}
export type AfterRetryHook = NotificationHook<AfterRetryPayload>

// ─── beforeCommit ─────────────────────────────────────────────────────────────
// Gate. The confidence boundary. Must block — fail-closed policy enforced in dispatcher.
// A deny here routes to human approval or escalation per confidence tier.

export type BeforeCommitPayload = {
  task: Task
  build: BuilderOutput
  registryDelta: RegistryUpdates
  confidence: ConfidenceResult
}
export type BeforeCommitHook = GateHook<BeforeCommitPayload>
