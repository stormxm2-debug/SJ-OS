import { useState } from 'react'
import { ClipboardList, ChevronRight, Target, CheckCircle2, CircleDashed, Ban } from 'lucide-react'
import {
  ROADMAP,
  PRODUCT_VISION,
  type BacklogItem,
  type BacklogPriority,
  type BacklogStatus
} from '@renderer/data/productBacklog'
import { useBacklog } from '@renderer/backlog/useBacklog'
import { backlogStore } from '@renderer/backlog/backlogStore'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'
import type { ChipTone } from '@renderer/components/ui/Chip'

const PRIORITY_TONE: Record<BacklogPriority, ChipTone> = {
  P0: 'rose',
  P1: 'amber',
  P2: 'slate'
}

const STATUS_META: Record<BacklogStatus, { label: string; tone: ChipTone }> = {
  completed: { label: 'Completed', tone: 'emerald' },
  in_progress: { label: 'In progress', tone: 'sky' },
  planned: { label: 'Planned', tone: 'slate' },
  blocked: { label: 'Blocked', tone: 'rose' }
}

const PRIORITIES: BacklogPriority[] = ['P0', 'P1', 'P2']

export default function ProductBacklogPage(): JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null)
  const backlog = useBacklog()
  const release1 = backlog.filter((b) => b.releaseId === 'R1')
  const completed = release1.filter((b) => b.status === 'completed')
  const blocked = release1.filter((b) => b.status === 'blocked')
  const nextUp = release1.find((b) => b.priority === 'P0' && b.status !== 'completed')

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Product Backlog</h1>
        <p className="mt-1 text-sm text-slate-400">{PRODUCT_VISION}</p>
      </div>

      <Card title="Product roadmap" icon={<Target className="h-4 w-4 text-indigo-300" />}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ROADMAP.map((r, i) => (
            <div
              key={r.id}
              className={[
                'rounded-lg border p-3',
                i === 0 ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/40'
              ].join(' ')}
            >
              <div className="text-sm font-semibold text-slate-100">{r.name}</div>
              <div className="text-xs text-slate-500">{r.theme}</div>
              {i === 0 && <div className="mt-1 text-[10px] uppercase tracking-wide text-indigo-300">Current</div>}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Overview icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />} label="Completed" value={`${completed.length} / ${release1.length}`} />
        <Overview icon={<CircleDashed className="h-4 w-4 text-sky-400" />} label="Current sprint (next up)" value={nextUp ? nextUp.title : '—'} />
        <Overview icon={<Ban className="h-4 w-4 text-rose-400" />} label="Blocked" value={`${blocked.length}`} />
      </div>

      <Card
        title="Release 1 — Minimum Usable Product"
        icon={<ClipboardList className="h-4 w-4 text-indigo-300" />}
        action={<span className="text-xs text-slate-500">{release1.length} items</span>}
      >
        <div className="space-y-5">
          {PRIORITIES.map((priority) => {
            const items = release1.filter((b) => b.priority === priority)
            if (items.length === 0) return null
            return (
              <div key={priority}>
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                  <Chip tone={PRIORITY_TONE[priority]}>{priority}</Chip>
                  {priority === 'P0' ? 'Critical' : priority === 'P1' ? 'Important' : 'Later'}
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <BacklogRow
                      key={item.id}
                      item={item}
                      open={expanded === item.id}
                      onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

function Overview({
  icon,
  label,
  value
}: {
  icon: JSX.Element
  label: string
  value: string
}): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">{icon}{label}</div>
      <div className="mt-1 truncate text-lg font-semibold text-slate-100">{value}</div>
    </div>
  )
}

function BacklogRow({
  item,
  open,
  onToggle
}: {
  item: BacklogItem
  open: boolean
  onToggle: () => void
}): JSX.Element {
  const status = STATUS_META[item.status]
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <ChevronRight
          className={['h-3.5 w-3.5 shrink-0 text-slate-500 transition', open ? 'rotate-90' : ''].join(' ')}
        />
        <span className="font-mono text-[11px] text-slate-600">{item.id}</span>
        <span className="truncate text-sm font-medium text-slate-100">{item.title}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <Chip tone="slate">{item.complexity}</Chip>
          <Chip tone={status.tone}>{status.label}</Chip>
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-800 px-3 py-3 text-xs text-slate-400">
          <Field label="Business value" value={item.businessValue} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Owner department" value={item.ownerDepartment} />
            <Field label="Dependencies" value={item.dependencies.length ? item.dependencies.join(', ') : 'none'} />
          </div>
          <Field label="Workflow" value={item.workflow} />
          <List label="Acceptance criteria" items={item.acceptanceCriteria} />
          <List label="Definition of Done" items={item.definitionOfDone} />
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-600">Reprioritize</div>
            <div className="mt-1 flex gap-1.5">
              {(['P0', 'P1', 'P2'] as BacklogPriority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => backlogStore.reprioritize(item.id, p)}
                  className={[
                    'rounded-full border px-2.5 py-0.5 text-[11px] transition',
                    item.priority === p
                      ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-200'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                  ].join(' ')}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-600">{label}</div>
      <div className="text-slate-300">{value}</div>
    </div>
  )
}

function List({ label, items }: { label: string; items: string[] }): JSX.Element {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-600">{label}</div>
      <ul className="mt-0.5 list-inside list-disc space-y-0.5 text-slate-300">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  )
}
