import type { Worker } from '@shared/types'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'
import ProgressBar from '@renderer/components/ui/ProgressBar'
import { ROLE_LABEL } from '@renderer/lib/companyMeta'
import {
  CAPABILITIES_BY_ROLE,
  STATS_BY_ROLE,
  providerForRole
} from '@renderer/data/mockManagement'

interface WorkerProfileProps {
  worker: Worker
}

export default function WorkerProfile({ worker }: WorkerProfileProps): JSX.Element {
  const stats = STATS_BY_ROLE[worker.role]
  const capabilities = CAPABILITIES_BY_ROLE[worker.role]
  const provider = providerForRole(worker.role)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card title="현재 배정 업무" className="lg:col-span-2">
        <div className="text-sm text-slate-300">
          {worker.currentTask ?? (
            <span className="text-slate-600">진행 중인 작업 없음</span>
          )}
        </div>
        {worker.currentTask && (
          <div className="mt-3 flex items-center gap-3">
            <ProgressBar value={worker.progress} />
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-500">
              {worker.progress}%
            </span>
          </div>
        )}

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat label="완료한 작업" value={stats.completed} />
          <Stat label="성공률" value={`${stats.successRate}%`} />
          <Stat label="진행 중인 작업" value={stats.openTasks} />
        </div>
      </Card>

      <Card title="구성">
        <dl className="space-y-3 text-sm">
          <Row label="역할" value={ROLE_LABEL[worker.role]} />
          <div>
            <dt className="text-xs text-slate-500">제공자</dt>
            <dd className="mt-1">
              <Chip tone="indigo">{provider?.label ?? '미할당'}</Chip>
            </dd>
            <p className="mt-1 text-xs text-slate-600">
              회사 설정에서 교체 가능 — 벤더 종속 없음.
            </p>
          </div>
          <Row label="마지막 활동" value={`업데이트 ${worker.lastActivity}`} />
        </dl>
      </Card>

      <Card title="역량" className="lg:col-span-3">
        <div className="flex flex-wrap gap-2">
          {capabilities.map((c) => (
            <Chip key={c} tone="slate">
              {c}
            </Chip>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="text-lg font-semibold text-slate-100">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-200">{value}</dd>
    </div>
  )
}
