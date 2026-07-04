import { useState, type ReactNode } from 'react'
import { Stethoscope, RefreshCw, CheckCircle2, XCircle, FlaskConical, Loader2 } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { ClaudeSmokeTestResult } from '@shared/claudeAutoBuild'
import { useClaudeAutoBuild } from '@renderer/services/claude-auto-build/useClaudeAutoBuild'

/**
 * Claude Code 실행 환경 diagnostics — confirms (from Electron Main only) whether
 * Claude Code can actually be launched before running auto-build jobs. The
 * renderer never runs shell commands; it only triggers the main-process fixed
 * checks. Inline card only — no overlay, no modal.
 */
export default function ClaudeRunnerDiagnosticsPanel(): JSX.Element {
  const { available, diagnostics, checking, checkEnvironment, smokeTest } = useClaudeAutoBuild()
  const [smoke, setSmoke] = useState<ClaudeSmokeTestResult | null>(null)
  const [smoking, setSmoking] = useState(false)

  const runSmoke = async (): Promise<void> => {
    setSmoking(true)
    setSmoke(await smokeTest())
    setSmoking(false)
  }

  const runnerLabel =
    diagnostics?.selectedRunner === 'claude'
      ? 'Claude CLI 사용 가능'
      : diagnostics?.selectedRunner === 'npx'
        ? 'npx Claude Code 사용 가능'
        : diagnostics
          ? 'Claude Code 실행 환경 없음'
          : '미확인'

  return (
    <Card
      title="Claude Code 실행 환경"
      icon={<Stethoscope className="h-4 w-4 text-indigo-300" />}
      action={
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          Claude 실행환경 진단 빌드
        </span>
      }
    >
      {!available ? (
        <p className="text-xs text-amber-300">진단은 데스크톱 앱(npm run dev)에서만 가능합니다.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void checkEnvironment()}
              disabled={checking}
              className={[
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition',
                checking
                  ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
                  : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
              ].join(' ')}
            >
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              실행 환경 확인
            </button>
            <button
              type="button"
              onClick={() => void runSmoke()}
              disabled={smoking || !diagnostics?.canRun}
              title={!diagnostics?.canRun ? '먼저 실행 환경을 확인하세요.' : '무해한 테스트 프롬프트를 실행합니다.'}
              className={[
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition',
                smoking || !diagnostics?.canRun
                  ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
              ].join(' ')}
            >
              {smoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              Claude Code 실행 테스트
            </button>
          </div>

          {diagnostics ? (
            <div className="space-y-1.5 rounded-xl border border-slate-800 bg-white p-3 text-sm shadow-sm">
              <Row label="작업 폴더">
                <span className="font-mono text-[11px]">{diagnostics.workspacePath}</span>
                <Flag ok={diagnostics.workspaceAllowed} okText="허용됨" badText="불일치" />
              </Row>
              <Row label="Node"><Flag ok={diagnostics.nodeAvailable} /></Row>
              <Row label="npm"><Flag ok={diagnostics.npmAvailable} /></Row>
              <Row label="npx"><Flag ok={diagnostics.npxAvailable} /></Row>
              <Row label="claude CLI"><Flag ok={diagnostics.claudeCommandAvailable} /></Row>
              <Row label="npx Claude Code"><Flag ok={diagnostics.npxClaudeCodeAvailable} /></Row>
              <Row label="선택된 실행 방식"><span className="font-medium text-slate-200">{runnerLabel}</span></Row>
              <Row label="실행 가능 여부">
                <Flag ok={diagnostics.canRun} okText="실행 가능" badText="실행 불가" />
              </Row>
              {diagnostics.errorMessages.map((m) => (
                <p key={m} className="text-[11px] text-rose-300">• {m}</p>
              ))}
              {diagnostics.warnings.map((m) => (
                <p key={m} className="text-[11px] text-amber-300">• {m}</p>
              ))}
              <p className="pt-1 text-[10px] text-slate-500">확인 시각: {new Date(diagnostics.checkedAt).toLocaleTimeString()}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">“실행 환경 확인”을 눌러 Claude Code 실행 가능 여부를 점검하세요.</p>
          )}

          {smoke ? (
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold">
                {smoke.ok ? (
                  <span className="text-emerald-300">실행 테스트 성공 (SJ_OS_CLAUDE_RUNNER_OK)</span>
                ) : (
                  <span className="text-rose-300">실행 테스트 실패 {smoke.error ? `· ${smoke.error}` : ''}</span>
                )}
              </div>
              <pre className="max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] leading-5 text-slate-400">
                {smoke.output || '(출력 없음)'}
              </pre>
            </div>
          ) : null}
        </>
      )}
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-right">{children}</span>
    </div>
  )
}

function Flag({ ok, okText = '사용 가능', badText = '없음' }: { ok: boolean; okText?: string; badText?: string }): JSX.Element {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300">
      <CheckCircle2 className="h-3 w-3" /> {okText}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-300">
      <XCircle className="h-3 w-3" /> {badText}
    </span>
  )
}
