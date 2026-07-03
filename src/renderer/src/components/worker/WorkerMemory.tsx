import type { Worker, MemoryKind } from '@shared/types'
import Card from '@renderer/components/ui/Card'
import Chip, { type ChipTone } from '@renderer/components/ui/Chip'
import { getMemory } from '@renderer/data/mockManagement'

interface WorkerMemoryProps {
  worker: Worker
}

const KIND_TONE: Record<MemoryKind, ChipTone> = {
  fact: 'sky',
  task: 'violet',
  learning: 'emerald',
  preference: 'amber'
}

export default function WorkerMemory({ worker }: WorkerMemoryProps): JSX.Element {
  const entries = getMemory(worker.id)

  return (
    <Card
      title="메모리"
      action={<span className="text-xs text-slate-500">{entries.length}개 항목</span>}
    >
      {entries.length === 0 ? (
        <p className="text-sm text-slate-600">아직 메모리가 없습니다.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3"
            >
              <Chip tone={KIND_TONE[entry.kind]} className="capitalize">
                {entry.kind}
              </Chip>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-300">{entry.content}</p>
                <p className="mt-1 text-xs text-slate-600">{entry.createdAt}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-slate-600">
        이 미리보기에서 메모리는 읽기 전용입니다 — 편집 기능은 실시간 상태와 함께 제공됩니다.
      </p>
    </Card>
  )
}
