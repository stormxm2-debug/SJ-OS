import { useState } from 'react'
import { Check, X, ShieldCheck } from 'lucide-react'
import type { ApprovalRequest, ApprovalRisk, ApprovalStatus } from '@shared/types'
import Chip, { type ChipTone } from '@renderer/components/ui/Chip'
import { ROLE_LABEL, ROLE_META } from '@renderer/lib/companyMeta'
import { approvals as seedApprovals } from '@renderer/data/mockManagement'

const RISK_TONE: Record<ApprovalRisk, ChipTone> = {
  low: 'emerald',
  medium: 'amber',
  high: 'rose'
}

type Filter = 'pending' | 'resolved'

export default function ApprovalCenterPage(): JSX.Element {
  const [items, setItems] = useState<ApprovalRequest[]>(seedApprovals)
  const [filter, setFilter] = useState<Filter>('pending')

  function resolve(id: string, status: ApprovalStatus): void {
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)))
  }

  const pendingCount = items.filter((a) => a.status === 'pending').length
  const visible = items.filter((a) =>
    filter === 'pending' ? a.status === 'pending' : a.status !== 'pending'
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <FilterTab
          active={filter === 'pending'}
          onClick={() => setFilter('pending')}
          label={`Pending (${pendingCount})`}
        />
        <FilterTab
          active={filter === 'resolved'}
          onClick={() => setFilter('resolved')}
          label="Resolved"
        />
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/30 py-16 text-center">
          <ShieldCheck className="h-8 w-8 text-slate-700" />
          <p className="mt-3 text-sm text-slate-400">
            {filter === 'pending'
              ? 'No approvals waiting. The company is clear to proceed.'
              : 'Nothing resolved yet.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((a) => {
            const RoleIcon = ROLE_META[a.requestedBy].icon
            return (
              <li
                key={a.id}
                className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-100">
                        {a.title}
                      </span>
                      <Chip tone="slate" className="capitalize">
                        {a.kind}
                      </Chip>
                      <Chip tone={RISK_TONE[a.risk]}>{a.risk} risk</Chip>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{a.description}</p>
                    <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                      <RoleIcon className="h-3.5 w-3.5" />
                      Requested by {ROLE_LABEL[a.requestedBy]} · {a.createdAt}
                    </div>
                  </div>

                  {a.status === 'pending' ? (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => resolve(a.id, 'approved')}
                        className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500"
                      >
                        <Check className="h-3.5 w-3.5" /> Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => resolve(a.id, 'rejected')}
                        className="flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
                      >
                        <X className="h-3.5 w-3.5" /> Reject
                      </button>
                    </div>
                  ) : (
                    <Chip tone={a.status === 'approved' ? 'emerald' : 'rose'}>
                      {a.status === 'approved' ? 'Approved' : 'Rejected'}
                    </Chip>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function FilterTab({
  active,
  onClick,
  label
}: {
  active: boolean
  onClick: () => void
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-lg px-3 py-1.5 text-sm transition',
        active
          ? 'bg-indigo-600/15 text-indigo-300'
          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
      ].join(' ')}
    >
      {label}
    </button>
  )
}
