import { hookRegistry } from "./registry.js"
import { hookPolicies } from "./hookPolicies.js"
import type { HookName, MutationHook, GateHook, NotificationHook } from "./types.js"

function withTimeout<T>(promise: Promise<T>, ms?: number): Promise<T> {
  if (!ms) return promise
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Hook timed out after ${ms}ms`)), ms)
    ),
  ])
}

// Mutation hooks: pipeline composition — outputₙ becomes inputₙ₊₁.
// On error: passthrough policy returns input unchanged and continues.
export async function dispatchMutation<T>(name: HookName, payload: T): Promise<T> {
  const hooks = hookRegistry.get<T>(name)
  let current = payload
  for (const { meta, handler } of hooks) {
    try {
      current = await withTimeout((handler as MutationHook<T>)(current), meta.timeoutMs)
    } catch {
      // passthrough: leave current unchanged, continue pipeline
    }
  }
  return current
}

// Gate hooks: short-circuit on first deny.
// fail-closed policy blocks on hook error; fail-open continues.
export async function dispatchGate<T>(
  name: HookName,
  payload: T
): Promise<{ proceed: boolean; reason?: string }> {
  const hooks = hookRegistry.get<T>(name)
  for (const { meta, handler } of hooks) {
    try {
      const result = await withTimeout(
        (handler as GateHook<T>)(payload),
        meta.timeoutMs
      )
      if (!result.proceed) return result
    } catch (err) {
      if (hookPolicies[name] === "fail-closed") {
        return { proceed: false, reason: `Hook error: ${err}` }
      }
      // fail-open: continue to next hook
    }
  }
  return { proceed: true }
}

// Notification hooks: fan-out parallel fire-and-forget.
// All hooks fire regardless of individual errors (ignore policy).
export async function dispatchNotification<T>(name: HookName, payload: T): Promise<void> {
  const hooks = hookRegistry.get<T>(name)
  await Promise.allSettled(
    hooks.map(({ meta, handler }) =>
      withTimeout((handler as NotificationHook<T>)(payload), meta.timeoutMs)
    )
  )
}
