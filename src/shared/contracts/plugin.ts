import type { WorkerRole } from '../types/worker'

/**
 * Plugin architecture contract.
 *
 * Workers are plugins registered against fixed roles. Concrete plugins are
 * added later without modifying the core — this file defines only the shapes.
 */
export interface PluginManifest {
  readonly id: string
  readonly version: string
  readonly role: WorkerRole
}

export interface WorkerPlugin {
  readonly manifest: PluginManifest
}

export interface PluginRegistry {
  register(plugin: WorkerPlugin): void
  byRole(role: WorkerRole): readonly WorkerPlugin[]
  list(): readonly WorkerPlugin[]
}
