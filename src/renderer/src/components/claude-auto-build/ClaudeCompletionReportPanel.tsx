import { useState } from 'react'
import { FileCheck2, Copy, Check, ClipboardList, Archive, Loader2 } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { ClaudeAutoBuildJob, ClaudeBuildCompletionReport } from '@shared/claudeAutoBuild'
import { useClaudeAutoBuild } from '@renderer/services/claude-auto-build/useClaudeAutoBuild'
import { copyPromptToClipboard } from '@renderer/services/claude-code/claudeCodeBridge'
import { formatReportText, recordCompletionReport } from '@renderer/services/claude-auto-build/completionReports'

/**
 * 작업 완료 보고서 — after a job succeeds/commits/pushes, generate a readable report
 * (request, changed files, verification, commit, push, manual test checklist) so
 * the user never has to read raw logs. Read-only git inspection in main; the
 * renderer runs no shell. No deployment. Inline cards only.
 */
export default function ClaudeCompletionReportPanel(): JSX.Element | null {
  const { jobs, generateCompletionReport } = useClaudeAutoBuild()
  const finished = jobs
    .filter((j) => j.status === 'succeeded')
    .sort((a, b) => b.queueIndex - a.queueIndex)
    .slice(0, 6)

  if (finished.length === 0) return null

  return (
    <Card
      title="작업 완료 보고서"
      icon={<FileCheck2 className="h-4 w-4 text-indigo-300" />}
      action={
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          작업 완료 보고서 안전 빌드
        </span>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        완료된 작업의 요청/변경/검증/커밋/테스트 체크리스트를 한눈에 정리합니다. 로그를 직접 열지 않아도 됩니다.
        (배포는 이 단계에서 수행하지 않습니다.)
      </p>
      <div className="space-y-3">
        {finished.map((job) => (
          <ReportCard key={job.id} job={job} onGenerate={() => generateCompletionReport(job.id)} />
        ))}
      </div>
    </Card>
  )
}

function ReportCard({ job, onGenerate }: { job: ClaudeAutoBuildJob; onGenerate: () => Promise<ClaudeBuildCompletionReport | null> }): JSX.Element {
  const [report, setReport] = useState<ClaudeBuildCompletionReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [recorded, setRecorded] = useState(false)
  const [showChecklist, setShowChecklist] = useState(true)

  const generate = async (): Promise<void> => {
    setBusy(true)
    setReport(await onGenerate())
    setBusy(false)
  }
  const copy = async (): Promise<void> => {
    if (!report) return
    const ok = await copyPromptToClipboard(formatReportText(report))
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }
  const record = (): void => {
    if (!report) return
    recordCompletionReport(report)
    setRecorded(true)
    window.setTimeout(() => setRecorded(false), 2500)
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{job.title}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            검증: typecheck={job.verification.typecheckStatus} · build={job.verification.buildStatus}
            {job.commitHash ? ` · 커밋 ${job.commitHash}` : ''} · {job.pushed ? 'pushed' : 'not-pushed'}
          </div>
        </div>
        {!report ? (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy}
            className={['inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition', busy ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600' : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'].join(' ')}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileCheck2 className="h-3 w-3" />}
            보고서 생성
          </button>
        ) : null}
      </div>

      {report ? (
        <div className="mt-3 space-y-3 text-[11px]">
          <Section title="요청 내용"><p className="text-slate-400">{report.originalUserCommand}</p></Section>
          <Section title="변경 요약"><p className="text-slate-400">{report.releaseNote}</p></Section>
          <Section title={`변경 파일 (${report.changedFiles.length})`}>
            {report.changedFiles.length === 0 ? (
              <p className="text-slate-500">변경 파일이 없습니다.</p>
            ) : (
              <pre className="max-h-32 overflow-y-auto rounded border border-slate-800 bg-slate-950/40 p-2 font-mono text-[10px] text-slate-400">{report.changedFiles.slice(0, 80).join('\n')}</pre>
            )}
          </Section>
          <Section title="검증 결과">
            <p className="text-slate-400">typecheck: {report.verification.typecheckStatus} · build: {report.verification.buildStatus}</p>
          </Section>
          <Section title="커밋 / push">
            <p className="text-slate-400">커밋 해시: <span className="font-mono">{report.commitHash ?? '(미커밋)'}</span> · push 상태: {report.pushStatus}</p>
          </Section>
          {showChecklist ? (
            <Section title="수동 테스트 체크리스트">
              <ul className="space-y-0.5 text-slate-400">
                {report.manualTestChecklist.map((c) => <li key={c}>☐ {c}</li>)}
              </ul>
            </Section>
          ) : null}
          <Section title="다음 권장 작업">
            <ul className="space-y-0.5 text-slate-400">
              {report.nextRecommendedActions.map((a) => <li key={a}>• {a}</li>)}
            </ul>
          </Section>
          {report.riskNotes.length > 0 ? (
            <Section title="리스크 메모">
              <ul className="space-y-0.5 text-amber-300">{report.riskNotes.map((r) => <li key={r}>• {r}</li>)}</ul>
            </Section>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <MiniBtn icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} label={copied ? '복사됨' : '보고서 복사'} onClick={() => void copy()} />
            <MiniBtn icon={recorded ? <Check className="h-3 w-3" /> : <Archive className="h-3 w-3" />} label={recorded ? '기록됨' : '릴리즈 센터에 기록'} onClick={record} />
            <MiniBtn icon={<ClipboardList className="h-3 w-3" />} label={showChecklist ? '체크리스트 숨기기' : '테스트 체크리스트 보기'} onClick={() => setShowChecklist((s) => !s)} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-0.5 font-semibold text-slate-300">{title}</div>
      {children}
    </div>
  )
}

function MiniBtn({ icon, label, onClick }: { icon: JSX.Element; label: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60">
      {icon}
      {label}
    </button>
  )
}
