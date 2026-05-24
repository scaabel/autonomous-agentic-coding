import type {
  HookName,
  HookMetadata,
  NotificationHook,
  GateHook,
  MutationHook,
  RegisteredHook,
} from "./types.js"

class HookRegistryImpl {
  private readonly hooks = new Map<HookName, RegisteredHook<unknown>[]>()

  register<T>(
    name: HookName,
    handler: NotificationHook<T> | GateHook<T> | MutationHook<T>,
    meta: Omit<HookMetadata, "name">
  ): void {
    const existing = this.hooks.get(name) ?? []
    const entry: RegisteredHook<T> = { meta: { name, ...meta }, handler }
    existing.push(entry as RegisteredHook<unknown>)
    existing.sort((a, b) => a.meta.priority - b.meta.priority)
    this.hooks.set(name, existing)
  }

  get<T>(name: HookName): RegisteredHook<T>[] {
    return (this.hooks.get(name) ?? []) as RegisteredHook<T>[]
  }

  clear(name?: HookName): void {
    if (name) this.hooks.delete(name)
    else this.hooks.clear()
  }
}

export const hookRegistry = new HookRegistryImpl()
