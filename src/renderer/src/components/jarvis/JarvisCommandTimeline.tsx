import { CheckCircle2, Circle, LoaderCircle, XCircle } from 'lucide-react'
import type { JarvisCommandSession, JarvisTimelineStepStatus } from '@renderer/services/jarvis/types'

/**
 * Jarvis command execution timeline — the fast-UX progress feedback. Renders the
 * command session's steps (명령 수신 → 의도 분석 → … → 다음 작업 대기) with per-step
 * status, plus the "명령 수신 완료" header and original command. Purely
 * presentational; the panel animates step statuses for a progressive reveal.
 */

const STATUS_ICON: Record<JarvisTimelineStepStatus, JSX.Element> = {
  pending: <Circle className="h-4 w-4 text-slate-600" />,
  running: <LoaderCircle className="h-4 w-4 animate-spin text-indigo-300" />,
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  failed: <XCircle className="h-4 w-4 text-rose-400" />
}

const STATUS_TEXT: Record<JarvisTimelineStepStatus, string> = {
  pending: '대기',
  running: '진행 중',
  completed: '완료',
  failed: '실패'
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
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="font-medium text-slate-100">명령 수신 완료</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          {session.category ? (
            <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-slate-300">
              {CATEGORY_LABEL[session.category] ?? session.category}
            </span>
          ) : (
            <span className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-slate-400">분석 중</span>
          )}
          <span>{formatTime(session.receivedAt)}</span>
        </div>
      </div>

      {/* Original command */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-slate-300">
        <span className="text-slate-500">명령: </span>
        {session.command}
      </div>

      {/* Steps */}
      <ol className="space-y-1.5">
        {session.steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-2.5 text-sm">
            <span className="shrink-0">{STATUS_ICON[step.status]}</span>
            <span
              className={[
                'flex-1',
                step.status === 'completed'
                  ? 'text-slate-300'
                  : step.status === 'running'
                    ? 'text-slate-100'
                    : step.status === 'failed'
                      ? 'text-rose-300'
                      : 'text-slate-500'
              ].join(' ')}
            >
              <span className="mr-1.5 text-[11px] text-slate-600">{index + 1}.</span>
              {step.label}
            </span>
            <span
              className={[
                'shrink-0 text-[11px]',
                step.status === 'running'
                  ? 'text-indigo-300'
                  : step.status === 'completed'
                    ? 'text-emerald-400'
                    : step.status === 'failed'
                      ? 'text-rose-400'
                      : 'text-slate-600'
              ].join(' ')}
            >
              {STATUS_TEXT[step.status]}
            </span>
          </li>
        ))}
      </ol>

      {failed ? (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          명령 처리에 실패했습니다. 다시 시도해 주세요.
        </div>
      ) : null}
    </div>
  )
}
