import { useMemo, useState, type ReactNode } from 'react'
import {
  Play,
  ShieldCheck,
  ShieldAlert,
  Check,
  Copy,
  FolderOpen,
  Terminal,
  FileCode,
  Lock,
  ScrollText,
  AlertTriangle
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useDeveloperPrompt } from '@renderer/services/developer-prompt/useDeveloperPrompt'
import {
  ALLOWED_WORKSPACE,
  buildRunnerCommand,
  computeSafetyChecks,
  copyPromptToClipboard,
  exportClaudePrompt,
  isClaudeBridgeAvailable,
  openPromptsFolder,
  runApprovedJob
} from '@renderer/services/claude-code/claudeCodeBridge'

/**
 * Claude Code Runner — approval → command generation → optional (currently
 * disabled) launch + logs. The renderer NEVER executes shell commands; the
 * "Claude Code 실행" button asks the validated main-process runner, which refuses
 * to execute for now and returns a disabled result. Inline cards only — no
 * overlays, no modals, no global listeners.
 */
export default function ClaudeCodeRunnerPanel(): JSX.Element {
  const snapshot = useDeveloperPrompt()
  const bridgeAvailable = isClaudeBridgeAvailable()
  const packets = snapshot.packets.filter((p) => p.promptText.trim().length > 0)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [promptFilePath, setPromptFilePath] = useState<string | null>(null)
  const [command, setCommand] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<'대기 중' | '실행 중' | '완료' | '실패' | '차단됨' | '비활성'>('대기 중')
  const [logs, setLogs] = useState<string[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selected = packets.find((p) => p.id === selectedId) ?? null
  const safety = useMemo(
    () => (selected ? computeSafetyChecks(selected.promptText, ALLOWED_WORKSPACE) : null),
    [selected]
  )
  const canApprove = !!selected && !!safety && !safety.containsDangerousCommand

  const appendLog = (line: string): void => setLogs((prev) => [...prev, line].slice(-100))

  const reset = (): void => {
    setApproved(false)
    setPromptFilePath(null)
    setCommand(null)
    setRunStatus('대기 중')
    setLogs([])
  }

  const select = (id: string): void => {
    setSelectedId(id)
    reset()
  }

  const markCopied = (key: string): void => {
    setCopied(key)
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
  }

  const approve = async (): Promise<void> => {
    if (!selected || !safety) return
    if (safety.containsDangerousCommand) {
      setRunStatus('차단됨')
      appendLog('차단됨: 위험 명령 또는 민감 정보가 포함되어 실행이 차단되었습니다.')
      return
    }
    setBusy(true)
    setApproved(true)
    appendLog(`승인됨 · ${new Date().toLocaleTimeString()}`)
    // Export the prompt to a safe .md file so we can build a real command.
    const result = await exportClaudePrompt({
      title: selected.title,
      promptText: selected.promptText,
      workspacePath: ALLOWED_WORKSPACE
    })
    if (result.success && result.filePath) {
      setPromptFilePath(result.filePath)
      const cmd = buildRunnerCommand(result.filePath)
      setCommand(cmd)
      appendLog(`프롬프트 파일 저장: ${result.filePath}`)
      appendLog('실행 명령 생성됨')
    } else {
      appendLog(`파일 저장 실패: ${result.errorMessage ?? result.errorCode ?? '알 수 없는 오류'} (명령 생성 불가)`)
      if (!bridgeAvailable) appendLog('브라우저 환경에서는 파일 저장이 불가합니다. 데스크톱 앱을 사용하세요.')
    }
    setBusy(false)
  }

  const run = async (): Promise<void> => {
    if (!selected || !approved || !promptFilePath) return
    setBusy(true)
    setRunStatus('실행 중')
    appendLog('Claude Code 실행 요청…')
    const result = await runApprovedJob({
      workspacePath: ALLOWED_WORKSPACE,
      promptFilePath,
      promptText: selected.promptText,
      approved: true
    })
    if (result.blocked) {
      setRunStatus('차단됨')
      appendLog(`차단됨: ${result.message}`)
      result.blockReasons.forEach((r) => appendLog(` · ${r}`))
    } else if (result.disabled) {
      setRunStatus('비활성')
      appendLog(result.message)
    } else if (result.started) {
      setRunStatus('실행 중')
      appendLog('실행이 시작되었습니다.')
    }
    setBusy(false)
  }

  return (
    <div className="space-y-5">
      <Card
        title="Claude Code 실행 승인"
        icon={<ShieldCheck className="h-4 w-4 text-indigo-300" />}
        action={
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
            Claude Code 승인 실행 안전 빌드
          </span>
        }
      >
        <p className="mb-3 text-xs text-slate-500">
          작업을 선택하고 안전 검사를 확인한 뒤 승인하면 실행 명령이 생성됩니다. 렌더러는 셸을 실행하지
          않으며, 실제 실행은 Electron Main에서 검증 후에만 수행됩니다(현재는 비활성).
        </p>

        {/* Job selection */}
        {packets.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">승인 대기 중인 작업이 없습니다.</p>
        ) : (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {packets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => select(p.id)}
                className={[
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition',
                  selectedId === p.id
                    ? 'border-blue-500/40 bg-blue-600 text-white'
                    : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200'
                ].join(' ')}
              >
                {p.title.length > 26 ? p.title.slice(0, 26) + '…' : p.title}
              </button>
            ))}
          </div>
        )}

        {/* Approval card */}
        {selected && safety ? (
          <div className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
            <Row label="작업명" value={selected.title} />
            <Row label="작업 폴더" value={<span className="font-mono text-[11px]">{ALLOWED_WORKSPACE}</span>} />
            <Row label="프롬프트 파일" value={<span className="font-mono text-[11px]">{promptFilePath ?? '승인 시 생성'}</span>} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SafetyChip ok={safety.workspaceAllowed} okLabel="작업 폴더 허용" badLabel="작업 폴더 불가" />
              {safety.containsDangerousCommand ? (
                <Chip tone="rose" icon={<ShieldAlert className="h-3 w-3" />}>위험 명령 감지</Chip>
              ) : (
                <Chip tone="emerald" icon={<Check className="h-3 w-3" />}>위험 명령 없음</Chip>
              )}
              {safety.containsEnvWarning ? <Chip tone="amber" icon={<AlertTriangle className="h-3 w-3" />}>.env / 키 언급</Chip> : null}
            </div>

            {!canApprove ? (
              <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                위험 명령 또는 민감 정보가 포함되어 실행이 차단되었습니다. 승인할 수 없습니다.
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void approve()}
                disabled={!canApprove || approved || busy}
                className={[
                  'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition',
                  !canApprove || approved
                    ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                ].join(' ')}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {approved ? '승인됨' : '승인 후 실행 명령 생성'}
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700/60"
              >
                취소
              </button>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Generated command */}
      {command ? (
        <Card title="실행 명령" icon={<Terminal className="h-4 w-4 text-indigo-300" />}>
          <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[11px] leading-5 text-slate-300">
            {command}
          </pre>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Windows에서 <span className="font-mono">{'<'}</span> 리디렉션이 불안정하면, 프롬프트를 복사해 Claude
            Code에 직접 붙여넣어 실행하세요.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <MiniBtn tone="indigo" icon={copied === 'cmd' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              label={copied === 'cmd' ? '복사됨' : '명령 복사'}
              onClick={() => void copyPromptToClipboard(command).then((ok) => ok && markCopied('cmd'))} />
            <MiniBtn tone="indigo" icon={copied === 'prompt' ? <Check className="h-3 w-3" /> : <FileCode className="h-3 w-3" />}
              label={copied === 'prompt' ? '복사됨' : '프롬프트 복사'}
              onClick={() => void copyPromptToClipboard(selected?.promptText ?? '').then((ok) => ok && markCopied('prompt'))} />
            <MiniBtn tone="slate" icon={<FolderOpen className="h-3 w-3" />} label="폴더 열기"
              disabled={!bridgeAvailable}
              onClick={() => void openPromptsFolder()} />
            <MiniBtn tone="emerald" icon={<Play className="h-3 w-3" />} label={busy ? '요청 중…' : 'Claude Code 실행'}
              disabled={!bridgeAvailable || busy || !approved}
              onClick={() => void run()} />
          </div>
          <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 text-[11px] text-slate-500">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            자동 실행은 다음 안정화 단계에서 활성화됩니다. 지금 “Claude Code 실행”은 검증만 수행하고 비활성 상태를 반환합니다.
          </div>
        </Card>
      ) : null}

      {/* Run logs */}
      <Card
        title="실행 로그"
        icon={<ScrollText className="h-4 w-4 text-indigo-300" />}
        action={<span className={['rounded-full border px-2 py-0.5 text-[10px] font-semibold', RUN_TONE[runStatus]].join(' ')}>{runStatus}</span>}
      >
        {logs.length === 0 ? (
          <p className="py-3 text-center text-xs text-slate-500">아직 로그가 없습니다. 작업을 승인하면 여기에 표시됩니다.</p>
        ) : (
          <pre className="max-h-52 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-3 font-mono text-[10px] leading-5 text-slate-400">
            {logs.join('\n')}
          </pre>
        )}
      </Card>
    </div>
  )
}

// --- helpers ---------------------------------------------------------------

const RUN_TONE: Record<string, string> = {
  '대기 중': 'border-slate-700 bg-slate-800/60 text-slate-400',
  '실행 중': 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  완료: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  실패: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  차단됨: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  비활성: 'border-amber-500/30 bg-amber-500/10 text-amber-300'
}

type Tone = 'indigo' | 'emerald' | 'slate' | 'amber' | 'rose'
const TONES: Record<Tone, string> = {
  indigo: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  slate: 'border-slate-700 bg-slate-800/50 text-slate-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

function Chip({ tone, icon, children }: { tone: Tone; icon: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', TONES[tone]].join(' ')}>
      {icon}
      {children}
    </span>
  )
}

function SafetyChip({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }): JSX.Element {
  return (
    <Chip tone={ok ? 'emerald' : 'rose'} icon={ok ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}>
      {ok ? okLabel : badLabel}
    </Chip>
  )
}

function MiniBtn({ tone, icon, label, onClick, disabled }: { tone: Tone; icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition',
        disabled ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600' : `${TONES[tone]} hover:opacity-80`
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5 text-sm">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 break-all text-right font-medium text-slate-200">{value}</span>
    </div>
  )
}
