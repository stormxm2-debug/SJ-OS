import { useState, type ReactNode } from 'react'
import {
  Terminal,
  Copy,
  Check,
  Save,
  FolderCheck,
  ShieldAlert,
  AlertTriangle,
  FileCheck2,
  Lock,
  KeyRound
} from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useDeveloperPrompt } from '@renderer/services/developer-prompt/useDeveloperPrompt'
import type { DeveloperPromptPacket } from '@renderer/services/developer-prompt/types'
import type { ClaudeExportResult } from '@shared/claudeCode'
import {
  ALLOWED_WORKSPACE,
  computeSafetyChecks,
  copyPromptToClipboard,
  exportClaudePrompt,
  isClaudeBridgeAvailable
} from '@renderer/services/claude-code/claudeCodeBridge'

/**
 * Claude Code Bridge panel — prepares generated developer prompts for delivery to
 * Claude Code. The user can COPY a prompt or EXPORT it to a safe local .md file.
 * A safety scan flags dangerous commands / secrets. Actual Claude Code execution
 * is intentionally deferred (a disabled "자동 실행" placeholder). No shell runs
 * from the renderer, no overlays, no global listeners.
 */
export default function ClaudeCodeBridgePanel(): JSX.Element {
  const snapshot = useDeveloperPrompt()
  const bridgeAvailable = isClaudeBridgeAvailable()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [exports, setExports] = useState<Record<string, ClaudeExportResult>>({})

  const packets = snapshot.packets.filter((p) => p.promptText.trim().length > 0)

  const onCopy = async (packet: DeveloperPromptPacket): Promise<void> => {
    const ok = await copyPromptToClipboard(packet.promptText)
    if (ok) {
      setCopiedId(packet.id)
      window.setTimeout(() => setCopiedId((c) => (c === packet.id ? null : c)), 2000)
    }
  }

  const onExport = async (packet: DeveloperPromptPacket): Promise<void> => {
    const safety = computeSafetyChecks(packet.promptText, ALLOWED_WORKSPACE)
    if (safety.containsDangerousCommand) {
      const proceed =
        typeof window !== 'undefined' &&
        window.confirm('위험 명령 패턴이 감지되었습니다. 그래도 파일로 저장할까요?')
      if (!proceed) return
    }
    setBusyId(packet.id)
    const result = await exportClaudePrompt({
      title: packet.title,
      promptText: packet.promptText,
      workspacePath: ALLOWED_WORKSPACE
    })
    setExports((prev) => ({ ...prev, [packet.id]: result }))
    setBusyId(null)
  }

  return (
    <div className="space-y-5">
      <Card
        title="Claude Code 브릿지 · 전달 대기"
        icon={<Terminal className="h-4 w-4 text-indigo-300" />}
        action={
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
            Claude Code 브릿지 안전 빌드
          </span>
        }
      >
        <p className="mb-3 text-xs text-slate-500">
          생성된 개발 프롬프트를 복사하거나 안전한 .md 파일로 저장해 Claude Code에 붙여넣을 준비를 합니다.
          렌더러는 셸 명령을 실행하지 않습니다. 저장 위치:{' '}
          <span className="font-mono text-slate-400">{ALLOWED_WORKSPACE}\.sj-os\claude-prompts\</span>
        </p>

        {!bridgeAvailable ? (
          <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            파일 저장은 데스크톱 앱(npm run dev)에서만 가능합니다. 프롬프트 복사는 브라우저에서도 됩니다.
          </div>
        ) : null}

        {packets.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">전달 대기 중인 개발 프롬프트가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {packets.map((packet) => {
              const safety = computeSafetyChecks(packet.promptText, ALLOWED_WORKSPACE)
              const result = exports[packet.id]
              return (
                <div key={packet.id} className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-100">{packet.title}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {packet.targetWorkspace} · 상태 {packet.status}
                      </div>
                    </div>
                  </div>

                  {/* Safety scan chips */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <SafetyChip ok={safety.workspaceAllowed} icon={<FolderCheck className="h-3 w-3" />} okLabel="작업 폴더 허용" badLabel="작업 폴더 불가" />
                    {safety.containsDangerousCommand ? (
                      <Chip tone="rose" icon={<ShieldAlert className="h-3 w-3" />}>위험 명령 감지</Chip>
                    ) : null}
                    {safety.containsEnvWarning ? (
                      <Chip tone="amber" icon={<KeyRound className="h-3 w-3" />}>.env / 키 언급</Chip>
                    ) : null}
                    {safety.requiresApproval ? (
                      <Chip tone="amber" icon={<AlertTriangle className="h-3 w-3" />}>승인 필요</Chip>
                    ) : (
                      <Chip tone="emerald" icon={<Check className="h-3 w-3" />}>안전 검사 통과</Chip>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void onCopy(packet)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-300 transition hover:bg-indigo-500/20"
                    >
                      {copiedId === packet.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copiedId === packet.id ? '복사됨' : '프롬프트 복사'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onExport(packet)}
                      disabled={!bridgeAvailable || busyId === packet.id}
                      className={[
                        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition',
                        !bridgeAvailable
                          ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600'
                          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                      ].join(' ')}
                    >
                      <Save className="h-3 w-3" />
                      {busyId === packet.id ? '저장 중…' : 'Claude용 파일 저장'}
                    </button>
                  </div>

                  {/* Export result */}
                  {result ? (
                    result.success ? (
                      <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 text-[11px] text-emerald-200">
                        <FileCheck2 className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="break-all">
                          Claude Code에 붙여넣기 준비 완료 · 내보낸 파일: <span className="font-mono">{result.filePath}</span>
                        </span>
                      </div>
                    ) : (
                      <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
                        저장 실패: {result.errorMessage ?? result.errorCode}
                      </div>
                    )
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Future execution placeholder (disabled) */}
      <Card title="Claude Code 자동 실행" icon={<Lock className="h-4 w-4 text-slate-400" />}>
        <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5 text-xs text-slate-500">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold text-slate-400">자동 실행 준비 중</div>
            자동 실행은 다음 단계에서 대표님 승인, 작업 폴더 제한, 로그 기록, 위험 명령 차단을 붙인 후
            활성화합니다. 지금은 프롬프트 복사 / 파일 저장까지만 지원합니다.
          </div>
        </div>
      </Card>
    </div>
  )
}

// --- helpers ---------------------------------------------------------------

type ChipTone = 'emerald' | 'amber' | 'rose'
const CHIP_TONES: Record<ChipTone, string> = {
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

function Chip({ tone, icon, children }: { tone: ChipTone; icon: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <span className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', CHIP_TONES[tone]].join(' ')}>
      {icon}
      {children}
    </span>
  )
}

function SafetyChip({ ok, icon, okLabel, badLabel }: { ok: boolean; icon: ReactNode; okLabel: string; badLabel: string }): JSX.Element {
  return <Chip tone={ok ? 'emerald' : 'rose'} icon={icon}>{ok ? okLabel : badLabel}</Chip>
}
