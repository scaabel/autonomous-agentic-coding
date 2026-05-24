import { randomUUID } from "crypto"
import type { ValidationError, ValidationWarning } from "../validation/static-validators.js"
import type { NormalizedFailure } from "./types.js"

export function normalizeValidationError(
  error: ValidationError,
  phase: NormalizedFailure["phase"] = "typecheck"
): NormalizedFailure {
  return {
    id: randomUUID(),
    source: "static",
    phase,
    code: error.code,
    message: error.message,
    file: error.file,
    severity: "hard",
    timestamp: Date.now(),
  }
}

export function normalizeValidationWarning(
  warning: ValidationWarning,
  phase: NormalizedFailure["phase"] = "typecheck"
): NormalizedFailure {
  return {
    id: randomUUID(),
    source: "static",
    phase,
    code: warning.code,
    message: warning.message,
    file: warning.file,
    severity: "soft",
    timestamp: Date.now(),
  }
}

export function normalizeRuntimeError(
  message: string,
  phase: NormalizedFailure["phase"],
  opts: {
    code?: string
    file?: string
    stackTrace?: string
    severity?: NormalizedFailure["severity"]
  } = {}
): NormalizedFailure {
  return {
    id: randomUUID(),
    source: "runtime",
    phase,
    code: opts.code ?? "RUNTIME_ERROR",
    message,
    file: opts.file,
    stackTrace: opts.stackTrace,
    severity: opts.severity ?? "hard",
    timestamp: Date.now(),
  }
}
