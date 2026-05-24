import type { Task } from "../types.js"
import type { NormalizedFailure } from "../failures/types.js"

// ─── Diagnosis evolution ──────────────────────────────────────────────────────
// Stored per attempt so Pi can detect repeated-failure patterns and
// model confidence decay across retry cycles.

export type DiagnosisRecord = {
  attempt: number
  classification: string
  confidence: number
}

// ─── Retry history ────────────────────────────────────────────────────────────
// Injected into the beforeBuild mutation hook on every retry.
// Allows Pi context-compressor and the builder to reason over prior hypotheses.

export type RetryHistory = {
  attempts: number
  failures: NormalizedFailure[]
  diagnoses: DiagnosisRecord[]
  lastFeedback: string[]
}

// ─── Builder retry input ──────────────────────────────────────────────────────
// Payload passed to the builder on retry attempts.
// Mutated by the beforeRetry hook before reaching the builder.

export type BuilderRetryInput = {
  task: Task
  feedback: string[]
  attempt: number
}
