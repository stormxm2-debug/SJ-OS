import { Boxes, CheckCircle2, Loader2 } from 'lucide-react'
import type { AssetRecord, AssetType, KernelStateSnapshot } from '@shared/kernel'
import { ASSET_TYPE_LABEL } from '@shared/kernel'
import { useKernel } from '@renderer/chief-of-staff/useKernel'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'

/**
 * The Company Asset Store — the AI Company's permanent memory. Every reusable
 * asset the company has produced, grouped by category, with the metadata the
 * CEO manages: version, owner department, projects using it, dependencies,
 * completion date and status. Read straight from the Kernel; it survives across
 * projects, so future projects can consume prior assets.
 */
export default function AssetStore(): JSX.Element | null {
  const kernel = useKernel()
  if (kernel.assets.length === 0) return null

  const byType = new Map<AssetType, AssetRecord[]>()
  for (const asset of kernel.assets) {
    const list = byType.get(asset.type) ?? []
    list.push(asset)
    byType.set(asset.type, list)
  }

  return (
    <Card
      title="Company Asset Store"
      icon={<Boxes className="h-4 w-4 text-indigo-300" />}
      action={<span className="text-xs text-slate-500">{kernel.assets.length} asset(s)</span>}
    >
      <div className="space-y-4">
        {[...byType.entries()].map(([type, assets]) => (
          <div key={type}>
            <div className="mb-1.5 text-xs uppercase tracking-wide text-slate-500">
              {ASSET_TYPE_LABEL[type]} · {assets.length}
            </div>
            <div className="space-y-2">
              {assets.map((asset) => (
                <AssetRow key={asset.id} asset={asset} snapshot={kernel} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function AssetRow({
  asset,
  snapshot
}: {
  asset: AssetRecord
  snapshot: KernelStateSnapshot
}): JSX.Element {
  const registered = asset.status === 'registered'
  const owner =
    snapshot.departments.find((d) => d.capability === asset.ownerDepartment)?.name ??
    `${asset.ownerDepartment} Department`
  const completedOn =
    asset.completedAt !== null ? new Date(asset.completedAt).toLocaleDateString() : null

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-100">{asset.name}</span>
        <Chip tone="slate">v{asset.version}</Chip>
        <span className="ml-auto flex items-center gap-1 text-xs">
          {registered ? (
            <span className="flex items-center gap-1 text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Registered
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> In development
            </span>
          )}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>Owner: {owner}</span>
        <span>{asset.files.length} file(s)</span>
        <span>Deps: {asset.dependencies.length === 0 ? 'none' : asset.dependencies.join(', ')}</span>
        {completedOn && <span>Completed {completedOn}</span>}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-600">Projects using:</span>
        {asset.projectsUsing.map((p) => (
          <Chip key={p} tone="emerald">{p}</Chip>
        ))}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-600">Reusable in:</span>
        {asset.supportedProjects.map((p) => (
          <Chip key={p} tone="indigo">{p}</Chip>
        ))}
      </div>
    </div>
  )
}
