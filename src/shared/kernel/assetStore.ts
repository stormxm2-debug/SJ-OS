import type { AssetManifest, AssetRecord } from './asset'

/**
 * The Company Asset Store — the AI Company's permanent memory.
 *
 * It is company-wide and RESET-SURVIVING (it is not part of per-project Kernel
 * state), so assets registered by one project remain available to future
 * projects. Assets are deduped by type + name — there are never duplicate
 * assets; re-producing an asset just records another consuming project and
 * refreshes its metadata.
 */
export class AssetStore {
  private readonly byKey = new Map<string, AssetRecord>()

  private static key(type: string, name: string): string {
    return `${type}:${name}`
  }

  /** Register (or re-record use of) an asset. Deduped by type + name. */
  register(manifest: AssetManifest, projectName: string, id: string, at: number): void {
    const key = AssetStore.key(manifest.type, manifest.name)
    const existing = this.byKey.get(key)
    if (existing) {
      if (!existing.projectsUsing.includes(projectName)) {
        existing.projectsUsing.push(projectName)
      }
      existing.version = manifest.version
      existing.files = [...manifest.files]
      existing.dependencies = [...manifest.dependencies]
      existing.supportedProjects = [...manifest.supportedProjects]
      return
    }
    this.byKey.set(key, {
      ...manifest,
      dependencies: [...manifest.dependencies],
      supportedProjects: [...manifest.supportedProjects],
      files: [...manifest.files],
      id,
      projectsUsing: [projectName],
      status: 'in_development',
      registeredAt: at,
      completedAt: null
    })
  }

  /** A project finished: any of its still-in-development assets are now registered. */
  markProjectCompleted(projectName: string, at: number): void {
    for (const asset of this.byKey.values()) {
      if (asset.projectsUsing.includes(projectName) && asset.completedAt === null) {
        asset.completedAt = at
        asset.status = 'registered'
      }
    }
  }

  all(): AssetRecord[] {
    return [...this.byKey.values()].map((a) => ({
      ...a,
      dependencies: [...a.dependencies],
      supportedProjects: [...a.supportedProjects],
      projectsUsing: [...a.projectsUsing],
      files: [...a.files]
    }))
  }
}
