import { useState, type ReactNode } from 'react'
import { ClipboardCheck, GitBranch, FileDiff, Check, Copy, AlertTriangle, Loader2, GitMerge } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type {
  ParallelBuildJob,
  ReviewDecision,
  WorktreeReview,
  WorktreeMergeResult,
  ChangedFileStatus
} from '@shared/claudeParallel'
import { useClaudeParallel } from '@renderer/services/claude-auto-build/useClaudeParallel'
import { copyPromptToClipboard } from '@renderer/services/claude-code/claudeCodeBridge'

/**
 * 병렬 작업 결과 검토 — read-only review of a worktree job's changes before any
 * merge. Loads fixed git inspection (status/diff) from Electron main and lets the
 * user mark a decision. **Nothing merges here.** Inline cards only.
 */
export default function WorktreeReviewPanel(): JSX.Element {
  const { parallelJobs, available, loadWorktreeReview, markReviewDecision, mergeApprovedWorktree } =
    useClaudeParallel()
  const [reviews, setReviews] = useState<Record<string, WorktreeReview>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<string | null>(null)

  const reviewable = parallelJobs.filter((p) => !!p.worktreePath)

  const load = async (id: string): Promise<void> => {
    setLoadingId(id)
    const r = await loadWorktreeReview(id)
    if (r) setReviews((prev) => ({ ...prev, [id]: r }))
    setLoadingId(null)
  }

  const decide = async (id: string, decision: ReviewDecision): Promise<void> => {
    await markReviewDecision(id, decision)
  }

  return (
    <Card
      title="병렬 작업 결과 검토"
      icon={<ClipboardCheck className="h-4 w-4 text-indigo-300" />}
      action={
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          병렬 결과 검토 · 승인 병합 안전 빌드
        </span>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        worktree 작업이 변경한 내용을 병합 전에 확인합니다. 이 화면은 검토 전용이며, 병합/삭제/푸시를 하지
        않습니다. (git status / diff 조회만 수행)
      </p>

      {!available ? (
        <p className="text-[11px] text-amber-300">검토는 데스크톱 앱에서만 가능합니다.</p>
      ) : reviewable.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500">검토할 worktree 작업이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {reviewable.map((job) => (
            <ReviewCard
              key={job.id}
              job={job}
              review={reviews[job.sourceJobId] ?? null}
              loading={loadingId === job.sourceJobId}
              showDiff={!!showDiff[job.sourceJobId]}
              copied={copied === job.sourceJobId}
              onLoad={() => void load(job.sourceJobId)}
              onDecide={(d) => void decide(job.sourceJobId, d)}
              onToggleDiff={() => setShowDiff((p) => ({ ...p, [job.sourceJobId]: !p[job.sourceJobId] }))}
              onCopyFollowUp={(text) =>
                void copyPromptToClipboard(text).then((ok) => {
                  if (ok) {
                    setCopied(job.sourceJobId)
                    window.setTimeout(() => setCopied((c) => (c === job.sourceJobId ? null : c)), 2000)
                  }
                })
              }
              onMerge={() => mergeApprovedWorktree(job.sourceJobId)}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function ReviewCard({
  job,
  review,
  loading,
  showDiff,
  copied,
  onLoad,
  onDecide,
  onToggleDiff,
  onCopyFollowUp,
  onMerge
}: {
  job: ParallelBuildJob
  review: WorktreeReview | null
  loading: boolean
  showDiff: boolean
  copied: boolean
  onLoad: () => void
  onDecide: (d: ReviewDecision) => void
  onToggleDiff: () => void
  onCopyFollowUp: (text: string) => void
  onMerge: () => Promise<WorktreeMergeResult | null>
}): JSX.Element {
  const decision = review?.reviewDecision ?? job.reviewDecision ?? 'not-reviewed'
  const v = review?.verificationSummary ?? job.verificationResult
  const verifyFailed = v && (v.typecheckStatus === 'failed' || v.buildStatus === 'failed')

  // Merge state (double-confirm: first click expands, second click merges).
  const [confirming, setConfirming] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mergeResult, setMergeResult] = useState<WorktreeMergeResult | null>(null)

  const doMerge = async (): Promise<void> => {
    setMerging(true)
    setConfirming(false)
    const r = await onMerge()
    setMergeResult(r)
    setMerging(false)
  }

  const followUp =
    `이 worktree 결과에서 다음 부분을 수정해줘.\n\n` +
    `작업: ${job.title}\n브랜치: ${job.branchName ?? ''}\n\n` +
    `기존 요청: ${job.originalUserCommand}\n\n` +
    `수정 요청: (여기에 수정할 부분을 적어주세요)\n\n` +
    `안전 규칙:\n- 작고 안전한 변경만 할 것.\n- 파괴적 명령 금지.\n- 커밋/푸시/병합은 하지 말 것.`

  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{job.title}</div>
          {job.branchName ? (
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
              <GitBranch className="h-3 w-3" /> <span className="font-mono">{job.branchName}</span>
            </div>
          ) : null}
          {job.worktreePath ? (
            <div className="truncate text-[10px] text-slate-500">worktree: <span className="font-mono">{job.worktreePath}</span></div>
          ) : null}
        </div>
        <DecisionBadge decision={decision} />
      </div>

      {/* Verification summary */}
      {v ? (
        <div className="mt-2 text-[11px] text-slate-500">
          검증: typecheck={v.typecheckStatus} · build={v.buildStatus}
          {verifyFailed ? (
            <span className="ml-2 text-amber-300">검증 실패 상태에서는 병합하지 않는 것을 권장합니다.</span>
          ) : null}
        </div>
      ) : null}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap gap-2">
        <MiniBtn tone="indigo" icon={loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDiff className="h-3 w-3" />}
          label="변경사항 불러오기" onClick={onLoad} disabled={loading} />
        <MiniBtn tone="emerald" icon={<Check className="h-3 w-3" />} label="병합 승인 표시" onClick={() => onDecide('approved-for-merge')} />
        <MiniBtn tone="amber" icon={<AlertTriangle className="h-3 w-3" />} label="수정 필요" onClick={() => onDecide('needs-fix')} />
        <MiniBtn tone="rose" icon={<AlertTriangle className="h-3 w-3" />} label="반려" onClick={() => onDecide('rejected')} />
      </div>

      {/* Decision messages */}
      {decision === 'approved-for-merge' ? (
        <Msg tone="emerald">병합 승인 상태로 표시했습니다. 실제 병합은 다음 단계에서 진행됩니다.</Msg>
      ) : decision === 'needs-fix' ? (
        <Msg tone="amber">수정 필요로 표시했습니다. Claude에게 추가 수정 요청을 생성할 수 있습니다.</Msg>
      ) : decision === 'rejected' ? (
        <Msg tone="rose">작업을 반려 상태로 표시했습니다. worktree는 삭제하지 않습니다.</Msg>
      ) : null}

      {/* Follow-up prompt draft for needs-fix */}
      {decision === 'needs-fix' ? (
        <div className="mt-2">
          <MiniBtn tone="indigo" icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            label={copied ? '복사됨' : '수정 요청 프롬프트 복사'} onClick={() => onCopyFollowUp(followUp)} />
          <pre className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] leading-5 text-slate-400">
            {followUp}
          </pre>
        </div>
      ) : null}

      {/* 병합 준비 — only after approved-for-merge (explicit, double-confirm) */}
      {decision === 'approved-for-merge' ? (
        <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
            <GitMerge className="h-3.5 w-3.5" /> 병합 준비
          </div>
          <div className="text-[11px] text-slate-500">
            메인 SJ OS 작업 폴더로 병합합니다. push는 하지 않습니다. 메인 폴더가 깨끗해야 병합됩니다.
          </div>
          {verifyFailed ? (
            <p className="mt-1 text-[11px] text-amber-300">검증 실패 상태입니다. 병합을 권장하지 않습니다.</p>
          ) : null}

          {!confirming && !merging && !mergeResult ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
            >
              <GitMerge className="h-3 w-3" /> 승인된 작업 병합
            </button>
          ) : null}

          {confirming ? (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
              <p className="text-[11px] font-semibold text-amber-200">이 작업을 메인 SJ OS에 병합합니다. 계속하시겠습니까?</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => void doMerge()}
                  className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-500/25">
                  병합 실행
                </button>
                <button type="button" onClick={() => setConfirming(false)}
                  className="rounded-md border border-slate-700 bg-slate-800/50 px-3 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60">
                  취소
                </button>
              </div>
            </div>
          ) : null}

          {merging ? (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-indigo-300">
              <Loader2 className="h-3 w-3 animate-spin" /> 병합 중 · 검증 중…
            </div>
          ) : null}

          {mergeResult ? <MergeResultView result={mergeResult} /> : null}
        </div>
      ) : null}

      {/* Review data */}
      {review?.error ? (
        <Msg tone="rose">{review.error}</Msg>
      ) : review?.status === 'ready' ? (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] font-semibold text-slate-400">변경 파일 ({review.changedFiles.length})</div>
          {review.changedFiles.length === 0 ? (
            <p className="text-[11px] text-slate-500">변경된 파일이 없습니다.</p>
          ) : (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 p-2">
              {review.changedFiles.map((f) => (
                <div key={f.path} className="flex items-center gap-2 text-[10px]">
                  <FileTag status={f.status} />
                  <span className="truncate font-mono text-slate-400">{f.path}</span>
                </div>
              ))}
            </div>
          )}
          {review.diffStat ? (
            <div>
              <div className="mb-1 text-[11px] font-semibold text-slate-400">diff 요약</div>
              <pre className="max-h-32 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] text-slate-400">
                {review.diffStat}
              </pre>
            </div>
          ) : null}
          <button type="button" onClick={onToggleDiff} className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200">
            {showDiff ? 'diff 미리보기 숨기기' : 'diff 미리보기 보기'}
          </button>
          {showDiff ? (
            <>
              {review.diffTruncated ? <p className="text-[10px] text-amber-300">diff가 커서 일부만 표시됩니다.</p> : null}
              <pre className="max-h-64 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] leading-5 text-slate-400">
                {review.diffPreview || '(diff 없음 · 새 파일은 위 변경 파일 목록에서 확인)'}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// --- helpers ---------------------------------------------------------------

type Tone = 'indigo' | 'emerald' | 'amber' | 'rose' | 'slate'
const TONES: Record<Tone, string> = {
  indigo: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  slate: 'border-slate-700 bg-slate-800/60 text-slate-400'
}

function MiniBtn({ tone, icon, label, onClick, disabled }: { tone: Tone; icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={['inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition',
        disabled ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600' : `${TONES[tone]} hover:opacity-80`].join(' ')}>
      {icon}
      {label}
    </button>
  )
}

function Msg({ tone, children }: { tone: Tone; children: ReactNode }): JSX.Element {
  return <div className={['mt-2 rounded-lg border px-2.5 py-1.5 text-[11px]', TONES[tone]].join(' ')}>{children}</div>
}

const DECISION_LABEL: Record<ReviewDecision, { text: string; tone: Tone }> = {
  'not-reviewed': { text: '미검토', tone: 'slate' },
  'approved-for-merge': { text: '병합 승인 표시', tone: 'emerald' },
  'needs-fix': { text: '수정 필요', tone: 'amber' },
  rejected: { text: '반려', tone: 'rose' }
}
function DecisionBadge({ decision }: { decision: ReviewDecision }): JSX.Element {
  const d = DECISION_LABEL[decision]
  return <span className={['shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', TONES[d.tone]].join(' ')}>{d.text}</span>
}

const FILE_TAG: Record<ChangedFileStatus, { text: string; tone: Tone }> = {
  added: { text: 'A', tone: 'emerald' },
  modified: { text: 'M', tone: 'amber' },
  deleted: { text: 'D', tone: 'rose' },
  renamed: { text: 'R', tone: 'indigo' },
  unknown: { text: '?', tone: 'slate' }
}
function FileTag({ status }: { status: ChangedFileStatus }): JSX.Element {
  const t = FILE_TAG[status]
  return <span className={['inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold', TONES[t.tone]].join(' ')}>{t.text}</span>
}

function MergeResultView({ result }: { result: WorktreeMergeResult }): JSX.Element {
  const tone: Tone =
    result.status === 'succeeded' ? 'emerald'
    : result.status === 'conflict' ? 'rose'
    : result.status === 'needs-review' ? 'amber'
    : result.status === 'blocked' || result.status === 'failed' ? 'rose'
    : 'slate'
  const label: Record<string, string> = {
    succeeded: '병합 완료 · 검증 통과',
    'needs-review': '병합 완료 · 검토 필요',
    conflict: '병합 충돌',
    blocked: '병합 차단됨',
    failed: '병합 실패',
    merged: '병합 완료'
  }
  return (
    <div className="mt-2">
      <div className={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', TONES[tone]].join(' ')}>
        {label[result.status] ?? result.status}
      </div>
      {result.errorMessage ? <div className="mt-1 text-[11px] text-rose-300">{result.errorMessage}</div> : null}
      {result.status === 'conflict' ? (
        <div className="mt-1 text-[11px] text-rose-300">
          병합 충돌이 발생했습니다. 자동 해결하지 않습니다. 수동 확인이 필요합니다.
          {result.conflictFiles.length > 0 ? (
            <pre className="mt-1 max-h-24 overflow-y-auto rounded border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] text-slate-400">
              {result.conflictFiles.join('\n')}
            </pre>
          ) : null}
        </div>
      ) : null}
      {result.verification ? (
        <div className="mt-1 text-[11px] text-slate-500">
          메인 검증: typecheck={result.verification.typecheckStatus} · build={result.verification.buildStatus}
        </div>
      ) : null}
      {result.mergeLogLines.length > 0 ? (
        <pre className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] leading-5 text-slate-400">
          {result.mergeLogLines.join('\n')}
        </pre>
      ) : null}
      {result.status === 'succeeded' || result.status === 'needs-review' ? (
        <p className="mt-1 text-[10px] text-slate-500">병합은 완료되었지만 push는 자동으로 하지 않았습니다.</p>
      ) : null}
    </div>
  )
}
