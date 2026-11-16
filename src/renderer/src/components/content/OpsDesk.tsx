import { useMemo } from 'react'
import { BarChart3, CalendarDays, FileText, Image as ImageIcon, PenLine, Search, Send } from 'lucide-react'
import type { ContentItem } from '@renderer/services/content/contentModel'
import { buildDeskStages, pipelineCounts, type DeskStage } from '@renderer/services/content/opsDesk'

/**
 * 운영 데스크 — 콘텐츠 팀 7명이 책상에 앉아 일하는 모습을 보여 준다.
 * 할 일이 있는 역할은 깜빡이고, 콘텐츠는 왼쪽에서 오른쪽으로 흘러간다(CSS 애니메이션).
 * 사용자가 '동작 줄이기'를 켜면 애니메이션을 멈춘다. 데이터는 콘텐츠 상태에서만 계산한다.
 */

const NAVY = '#0e1e3a'
const MUTED = '#64748b'
const LINE = '#cbd5e1'
const ICONS: Record<string, typeof Search> = {
  researcher: Search,
  hook: PenLine,
  script: FileText,
  designer: ImageIcon,
  analyst: BarChart3,
  manager: CalendarDays,
  publisher: Send
}

const CSS = `
@keyframes opsdesk-blink { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
@keyframes opsdesk-flow { 0% { left: 0% } 100% { left: calc(100% - 14px) } }
@keyframes opsdesk-ring { 0% { box-shadow: 0 0 0 0 rgba(14,30,58,.35) } 100% { box-shadow: 0 0 0 10px rgba(14,30,58,0) } }
.opsdesk-live { animation: opsdesk-blink 1.4s ease-in-out infinite; }
.opsdesk-badge-on { animation: opsdesk-ring 1.6s ease-out infinite; }
.opsdesk-dot { animation: opsdesk-flow 3.2s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .opsdesk-live, .opsdesk-badge-on, .opsdesk-dot { animation: none; }
}
`

function DeskCard({ stage }: { stage: DeskStage }): JSX.Element {
  const Icon = ICONS[stage.key] ?? Search
  return (
    <div
      className="flex flex-col gap-1.5 rounded-xl border bg-white p-2.5"
      style={{ borderColor: stage.active ? NAVY : LINE, backgroundColor: stage.active ? '#f8fafc' : '#ffffff' }}
      aria-label={`${stage.label}: ${stage.count}건, ${stage.active ? '작업 중' : '대기'}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: stage.active ? NAVY : '#e2e8f0', color: stage.active ? '#ffffff' : MUTED }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span
          className={`min-w-[1.5rem] rounded-full px-1.5 text-center text-[12px] font-bold tabular-nums ${stage.active ? 'opsdesk-badge-on' : ''}`}
          style={{ backgroundColor: stage.active ? NAVY : '#e2e8f0', color: stage.active ? '#ffffff' : MUTED }}
        >
          {stage.count}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-bold" style={{ color: NAVY }}>
          {stage.label}
        </span>
        {stage.active ? <span className="opsdesk-live h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#16a34a' }} /> : null}
      </div>
      <p className="text-[11px] leading-snug" style={{ color: MUTED }}>
        {stage.hint}
      </p>
    </div>
  )
}

export default function OpsDesk({ items }: { items: ContentItem[] }): JSX.Element {
  const stages = useMemo(() => buildDeskStages(items), [items])
  const flow = useMemo(() => pipelineCounts(items), [items])
  const busy = items.length > 0
  const steps: { key: keyof typeof flow; label: string }[] = [
    { key: 'idea', label: '아이디어' },
    { key: 'drafting', label: '제작' },
    { key: 'scheduled', label: '예약' },
    { key: 'published', label: '게시' }
  ]

  return (
    <section className="rounded-2xl border bg-white p-3" style={{ borderColor: LINE }} aria-label="운영 데스크">
      <style>{CSS}</style>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[14px] font-bold" style={{ color: NAVY }}>
          <span className={`opsdesk-live h-2 w-2 rounded-full ${busy ? '' : 'opacity-30'}`} style={{ backgroundColor: busy ? '#16a34a' : MUTED }} />
          운영 데스크
        </h2>
        <span className="text-[11px]" style={{ color: MUTED }}>
          {busy ? '팀이 움직이는 중' : '대기 중 — 콘텐츠를 추가하면 팀이 움직입니다'}
        </span>
      </div>

      {/* 파이프라인 흐름 */}
      <div className="mb-3">
        <div className="relative flex items-center justify-between gap-1">
          {steps.map((s, i) => (
            <div key={s.key} className="flex flex-1 flex-col items-center gap-1">
              <span
                className="rounded-full px-2.5 py-1 text-[12px] font-bold tabular-nums"
                style={{ backgroundColor: flow[s.key] > 0 ? NAVY : '#e2e8f0', color: flow[s.key] > 0 ? '#ffffff' : MUTED }}
              >
                {flow[s.key]}
              </span>
              <span className="text-[11px]" style={{ color: MUTED }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
        {/* 흐르는 점 */}
        <div className="relative mt-1 h-2.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: '#f1f5f9' }} aria-hidden>
          {busy ? <span className="opsdesk-dot absolute top-0 h-2.5 w-3.5 rounded-full" style={{ backgroundColor: NAVY }} /> : null}
        </div>
      </div>

      {/* 책상 7개 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stages.map((st) => (
          <DeskCard key={st.key} stage={st} />
        ))}
      </div>
    </section>
  )
}
