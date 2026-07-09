import { CheckCircle2, Circle, LoaderCircle, XCircle } from 'lucide-react'
import type { JarvisCommandSession, JarvisTimelineStepStatus } from '@renderer/services/jarvis/types'

/**
 * Jarvis command execution timeline — the fast-UX progress feedback. Renders the
 * command session's steps (명령 수신 → 의도 분석 → … → 다음 작업 대기) with per-step
 * status, plus the "명령 수신 완료" header and original command. Purely
 * presentational; the panel animates step statuses for a progressive reveal.
 *
 * 다크 홀로그램 오버레이 전용 — 이 앱의 Tailwind 토큰은 밝은 테마로 리매핑되어
 * 있으므로 색은 전부 명시적 hex/rgba로만 쓴다.
 */

const STATUS_ICON: Record<JarvisTimelineStepStatus, JSX.Element> = {
  pending: <Circle className="h-4 w-4" style={{ color: 'rgba(120,160,205,0.45)' }} />,
  running: <LoaderCircle className="h-4 w-4 animate-spin" style={{ color: '#7dd3fc' }} />,
  completed: <CheckCircle2 className="h-4 w-4" style={{ color: '#6ee7b7' }} />,
  failed: <XCircle className="h-4 w-4" style={{ color: '#fda4af' }} />
}

const STATUS_TEXT: Record<JarvisTimelineStepStatus, string> = {
  pending: '대기',
  running: '진행 중',
  completed: '완료',
  failed: '실패'
}

const STATUS_TEXT_COLOR: Record<JarvisTimelineStepStatus, string> = {
  pending: 'rgba(120,160,205,0.5)',
  running: '#7dd3fc',
  completed: '#6ee7b7',
  failed: '#fda4af'
}

const STEP_LABEL_COLOR: Record<JarvisTimelineStepStatus, string> = {
  pending: 'rgba(150,190,235,0.5)',
  running: '#eaf6ff',
  completed: 'rgba(214,233,255,0.85)',
  failed: '#fda4af'
}

const CATEGORY_LABEL: Record<string, string> = {
  'local-command': '로컬 명령',
  navigation: '화면 이동',
  'external-action': '외부 작업',
  'developer-command': '개발 명령',
  'universal-build-command': '앱 빌드 명령',
  'ai-needed': 'AI 코어 필요',
  unknown: '미분류'
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString()
}

export default function JarvisCommandTimeline({ session }: { session: JarvisCommandSession }): JSX.Element {
  const failed = session.status === 'failed'
  return (
    <div className="space-y-3">
      {/* Received banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: 'rgba(103,232,249,0.22)', background: 'rgba(56,189,248,0.06)' }}>
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4" style={{ color: '#6ee7b7' }} />
          <span className="font-medium" style={{ color: '#eaf6ff' }}>명령 수신 완료</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]" style={{ color: 'rgba(150,190,235,0.6)' }}>
          {session.category ? (
            <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'rgba(103,232,249,0.3)', color: '#9adcff' }}>
              {CATEGORY_LABEL[session.category] ?? session.category}
            </span>
          ) : (
            <span className="rounded-full border px-2 py-0.5" style={{ borderColor: 'rgba(103,232,249,0.2)', color: 'rgba(150,190,235,0.7)' }}>분석 중</span>
          )}
          <span>{formatTime(session.receivedAt)}</span>
        </div>
      </div>

      {/* Original command */}
      <div className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(103,232,249,0.15)', background: 'rgba(6,14,30,0.5)', color: 'rgba(214,233,255,0.9)' }}>
        <span style={{ color: 'rgba(150,190,235,0.6)' }}>명령: </span>
        {session.command}
      </div>

      {/* Steps */}
      <ol className="space-y-1.5">
        {session.steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-2.5 text-sm">
            <span className="shrink-0">{STATUS_ICON[step.status]}</span>
            <span className="flex-1" style={{ color: STEP_LABEL_COLOR[step.status] }}>
              <span className="mr-1.5 text-[11px]" style={{ color: 'rgba(120,160,205,0.5)' }}>{index + 1}.</span>
              {step.label}
            </span>
            <span className="shrink-0 text-[11px]" style={{ color: STATUS_TEXT_COLOR[step.status] }}>
              {STATUS_TEXT[step.status]}
            </span>
          </li>
        ))}
      </ol>

      {failed ? (
        <div className="rounded-xl border px-3 py-2 text-xs" style={{ borderColor: 'rgba(251,113,133,0.35)', background: 'rgba(244,63,94,0.08)', color: '#fecdd3' }}>
          명령 처리에 실패했습니다. 다시 시도해 주세요.
        </div>
      ) : null}
    </div>
  )
}
