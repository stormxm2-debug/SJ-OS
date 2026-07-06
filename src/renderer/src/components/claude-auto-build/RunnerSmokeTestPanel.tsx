import { useState } from 'react'
import { Loader2, Play, Copy, Check, GitBranch, ListChecks, Hammer, Globe, Bot, FlaskConical, AlertTriangle } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { SafeCheckKind, SafeCheckResult } from '@shared/claudeAutoBuild'
import { copyPromptToClipboard } from '@renderer/services/claude-code/claudeCodeBridge'

/**
 * Claude 자동화 러너 스모크 테스트 (owner/admin, 데스크톱 전용). Runs FIXED, non-mutating
 * safe checks (git status/log, typecheck, build, build:web, claude --version) through
 * the Electron main process — the renderer only sends an enum kind, never a command.
 * Also provides the safe first-task template + a manual PowerShell fallback. Web/PWA
 * and non-Electron show a "PC앱 전용" message. No secrets are shown.
 */

const SAFE_PROMPT =
  '현재 프로젝트를 수정하지 말고 상태만 점검해줘. git status, package scripts, typecheck/build 가능 여부를 확인하고 결과만 보고해. 파일 수정, 커밋, 푸시, 삭제는 하지 마.'
const MANUAL_CMD = 'cd C:\\Users\\GalaxyBook5\\.vscode\\SJ-OS\nnpx @anthropic-ai/claude-code --permission-mode auto'
const WORKSPACE = 'C:\\Users\\GalaxyBook5\\.vscode\\SJ-OS'

function api(): Window['sj']['claudeBuild'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.claudeBuild : undefined
}

const CHECKS: { kind: SafeCheckKind; label: string; icon: JSX.Element }[] = [
  { kind: 'git-status', label: 'Git 상태 확인', icon: <GitBranch className="h-3.5 w-3.5" /> },
  { kind: 'git-log', label: '최근 커밋 확인', icon: <ListChecks className="h-3.5 w-3.5" /> },
  { kind: 'typecheck', label: 'Typecheck 실행', icon: <ListChecks className="h-3.5 w-3.5" /> },
  { kind: 'build', label: 'Build 실행', icon: <Hammer className="h-3.5 w-3.5" /> },
  { kind: 'build-web', label: 'Web Build 실행', icon: <Globe className="h-3.5 w-3.5" /> },
  { kind: 'claude-version', label: 'Claude Code CLI 확인', icon: <Bot className="h-3.5 w-3.5" /> }
]

export default function RunnerSmokeTestPanel(): JSX.Element {
  const available = !!api()
  const [busy, setBusy] = useState<SafeCheckKind | null>(null)
  const [result, setResult] = useState<SafeCheckResult | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [taskMsg, setTaskMsg] = useState<string | null>(null)

  const run = async (kind: SafeCheckKind): Promise<void> => {
    setBusy(kind)
    setResult((await api()?.safeCheck(kind)) ?? null)
    setBusy(null)
  }
  const copy = async (key: string, text: string): Promise<void> => {
    if (await copyPromptToClipboard(text)) {
      setCopied(key)
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
    }
  }
  const addFirstTask = async (): Promise<void> => {
    const job = await api()?.createJob({ title: '자동화 엔진 연결 테스트', source: 'developer-prompt-center', originalUserCommand: SAFE_PROMPT, generatedPrompt: SAFE_PROMPT, workspacePath: WORKSPACE })
    setTaskMsg(job ? '큐에 추가되었습니다. 개발 프롬프트 센터에서 승인 후 실행하세요.' : '작업 추가에 실패했습니다.')
  }

  return (
    <Card
      title="Claude 자동화 러너 스모크 테스트"
      icon={<FlaskConical className="h-4 w-4 text-indigo-300" />}
      action={<span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">러너 스모크 안전 빌드</span>}
    >
      {!available ? (
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          Claude 자동개발 실행은 PC앱 전용입니다. (데스크톱 앱 · 대표/관리자)
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">읽기 전용 · 검증 명령만 실행합니다. 렌더러는 명령 문자열을 보내지 않고, 메인 프로세스가 고정 명령을 실행합니다.</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {CHECKS.map((c) => (
              <button key={c.kind} type="button" onClick={() => void run(c.kind)} disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60 disabled:opacity-50">
                {busy === c.kind ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.icon}
                {c.label}
              </button>
            ))}
          </div>

          {result ? (
            <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[11px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-200">{result.label}</span>
                <span className={['rounded-full border px-2 py-0.5 text-[10px] font-bold', !result.available ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : result.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'].join(' ')}>
                  {!result.available ? '사용 불가/확인 필요' : result.ok ? '성공' : '실패'} · exit {result.exitCode} · {Math.round(result.durationMs)}ms
                </span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-slate-500">{result.command} · cwd: {result.cwd}</div>
              {result.message ? <div className="mt-1 text-amber-300"><AlertTriangle className="mr-1 inline h-3 w-3" />{result.message}</div> : null}
              {result.stdoutTail ? <pre className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] text-slate-400">{result.stdoutTail}</pre> : null}
              {result.stderrTail ? <pre className="mt-1 max-h-28 overflow-y-auto rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 font-mono text-[10px] text-rose-300">{result.stderrTail}</pre> : null}
            </div>
          ) : null}

          {/* First safe task */}
          <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="mb-1 text-[11px] font-semibold text-slate-300">첫 안전 테스트 작업</div>
            <pre className="mb-2 whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-[10px] text-slate-400">{SAFE_PROMPT}</pre>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void addFirstTask()} className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"><Play className="h-3 w-3" /> 큐에 테스트 작업 추가</button>
              <button type="button" onClick={() => void copy('prompt', SAFE_PROMPT)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700/60">{copied === 'prompt' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} 프롬프트 복사</button>
            </div>
            {taskMsg ? <p className="mt-2 text-[11px] text-indigo-300">{taskMsg}</p> : null}
          </div>

          {/* Manual fallback */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="mb-1 text-[11px] font-semibold text-slate-300">수동 실행 명령 (자동 입력 확인 필요 시)</div>
            <pre className="mb-2 whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] text-slate-400">{MANUAL_CMD}</pre>
            <button type="button" onClick={() => void copy('cmd', MANUAL_CMD)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700/60">{copied === 'cmd' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} 명령 복사</button>
          </div>
        </>
      )}
    </Card>
  )
}
