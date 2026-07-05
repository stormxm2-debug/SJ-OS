import { useEffect, useState } from 'react'
import { Tag, FileSearch, ShieldCheck, Check, UploadCloud, Copy, AlertTriangle, GitCommitHorizontal } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { ReleaseSnapshot, SnapshotMeta } from '@shared/releaseSnapshot'
import { copyPromptToClipboard } from '@renderer/services/claude-code/claudeCodeBridge'
import { useReleaseApprovals } from '@renderer/services/release-approval/releaseApprovalStore'

/**
 * 릴리즈 스냅샷 / Git 태그 — create an annotated Git tag (vX.Y.Z) for a staff
 * release, after approval. Tag create + tag push are two separate explicit steps.
 * Electron main runs fixed git tag/push only; the renderer never runs git and the
 * tag name is derived from package.json version. No npm version, no build, no
 * publish. Inline cards only.
 */

function api(): Window['sj']['releaseSnapshot'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.releaseSnapshot : undefined
}

export default function ReleaseSnapshotPanel(): JSX.Element {
  const available = !!api()
  const approvals = useReleaseApprovals()
  const [snap, setSnap] = useState<ReleaseSnapshot | null>(null)
  const [tagApproved, setTagApproved] = useState(false)
  const [pushApproved, setPushApproved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const meta = (): SnapshotMeta | undefined => {
    const item = approvals.find((i) => i.status === 'release-ready') ?? approvals.find((i) => i.status === 'approved')
    if (!item) return undefined
    return {
      title: item.title,
      releaseNote: item.releaseNote,
      verification: item.verification,
      manualTestChecklist: item.manualTestChecklist,
      linkedReleaseApprovalItemId: item.id
    }
  }

  const inspect = async (): Promise<void> => {
    setBusy(true)
    setSnap((await api()?.inspectTagReadiness(meta())) ?? null)
    setTagApproved(false)
    setPushApproved(false)
    setBusy(false)
  }
  useEffect(() => {
    void inspect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createTag = async (): Promise<void> => {
    if (!snap) return
    setBusy(true); setTagApproved(false)
    setSnap((await api()?.createApprovedTag(snap.id)) ?? null)
    setBusy(false)
  }
  const pushTag = async (): Promise<void> => {
    if (!snap) return
    setBusy(true); setPushApproved(false)
    setSnap((await api()?.pushApprovedTag(snap.id)) ?? null)
    setBusy(false)
  }

  const tagged = snap?.tagExists && (snap.status === 'tag-push-ready' || snap.status === 'tagged' || snap.status === 'tag-pushed')
  const pushed = snap?.pushed === true
  const canCreate = !!snap && snap.status === 'tag-ready' && snap.validSemver && !snap.tagExists

  const copySnapshot = async (): Promise<void> => {
    if (!snap) return
    const text = [
      `SJ OS ${snap.tagName} Release Snapshot`,
      `- Tag: ${snap.tagName}`,
      `- Commit: ${snap.commitHash}`,
      `- Release note: ${snap.releaseNote}`,
      `- Verification: typecheck=${snap.verification?.typecheckStatus ?? 'n/a'}, build=${snap.verification?.buildStatus ?? 'n/a'}`,
      `- Manual tests:`,
      ...(snap.manualTestChecklist.length ? snap.manualTestChecklist.map((c) => `  - [ ] ${c}`) : ['  - (없음)']),
      `- Tag pushed: ${pushed ? 'yes' : 'no'}`
    ].join('\n')
    if (await copyPromptToClipboard(text)) { setCopied(true); window.setTimeout(() => setCopied(false), 2000) }
  }

  return (
    <Card
      title="릴리즈 스냅샷 / Git 태그"
      icon={<Tag className="h-4 w-4 text-indigo-300" />}
      action={<span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">릴리즈 스냅샷 안전 빌드</span>}
    >
      <p className="mb-3 text-xs text-slate-500">
        스태프 릴리즈 버전에 대한 Git 태그(vX.Y.Z)를 승인 후 생성합니다. 태그 생성과 태그 push는 각각 별도 승인이
        필요합니다. npm version / 설치파일 빌드 / 외부 배포는 하지 않습니다.
      </p>
      {!available ? <p className="mb-2 text-[11px] text-amber-300">데스크톱 앱에서만 사용할 수 있습니다.</p> : null}

      <div className="mb-3">
        <MiniBtn tone="slate" icon={<FileSearch className="h-3 w-3" />} label="스냅샷 준비 확인" onClick={() => void inspect()} disabled={busy} />
      </div>

      {snap ? (
        <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[11px]">
          <div className="text-slate-400">현재 앱 버전: <span className="font-mono">{snap.version}</span> · 생성할 태그명: <span className="font-mono text-indigo-300">{snap.tagName}</span></div>
          <div className="flex items-center gap-1 text-slate-500"><GitCommitHorizontal className="h-3 w-3" /> 커밋: <span className="font-mono">{snap.commitHash.slice(0, 12) || '(없음)'}</span></div>
          <div className="text-slate-500">릴리즈 노트: <span className="text-slate-400">{snap.releaseNote}</span></div>
          <div className="text-slate-500">검증: typecheck={snap.verification?.typecheckStatus ?? 'n/a'} · build={snap.verification?.buildStatus ?? 'n/a'}</div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className={['rounded-full border px-2 py-0.5 text-[10px] font-semibold', snap.tagExists ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-slate-700 bg-slate-800/60 text-slate-400'].join(' ')}>태그 {snap.tagExists ? '존재' : '없음'}</span>
            <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-300">{snap.status}</span>
            {pushed ? <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">pushed</span> : null}
          </div>
          {snap.manualTestChecklist.length > 0 ? (
            <div className="pt-1 text-slate-500">수동 테스트: {snap.manualTestChecklist.length}개 항목</div>
          ) : null}
          {snap.errorMessage ? <div className="pt-1 text-rose-300"><AlertTriangle className="mr-1 inline h-3 w-3" />{snap.errorMessage}</div> : null}
        </div>
      ) : null}

      {/* Create tag (two-step) */}
      {snap && !snap.tagExists ? (
        <div className="mt-3">
          {!tagApproved ? (
            <MiniBtn tone="emerald" icon={<ShieldCheck className="h-3 w-3" />} label="태그 생성 승인" onClick={() => setTagApproved(true)} disabled={!canCreate} />
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
              <p className="text-[11px] font-semibold text-amber-200">Git 태그 {snap.tagName}를 생성합니다. 계속하시겠습니까?</p>
              <div className="mt-2 flex gap-2">
                <MiniBtn tone="emerald" icon={<Tag className="h-3 w-3" />} label="Git 태그 생성" onClick={() => void createTag()} disabled={busy || !canCreate} />
                <MiniBtn tone="slate" icon={<span />} label="취소" onClick={() => setTagApproved(false)} />
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Push tag (two-step) — only after tagged */}
      {tagged && !pushed ? (
        <div className="mt-3">
          {!pushApproved ? (
            <MiniBtn tone="emerald" icon={<ShieldCheck className="h-3 w-3" />} label="태그 push 승인" onClick={() => setPushApproved(true)} />
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
              <p className="text-[11px] font-semibold text-amber-200">이 태그를 origin에 push합니다. 계속하시겠습니까?</p>
              <div className="mt-2 flex gap-2">
                <MiniBtn tone="emerald" icon={<UploadCloud className="h-3 w-3" />} label="Git 태그 push" onClick={() => void pushTag()} disabled={busy} />
                <MiniBtn tone="slate" icon={<span />} label="취소" onClick={() => setPushApproved(false)} />
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <MiniBtn tone="slate" icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} label={copied ? '복사됨' : '릴리즈 스냅샷 복사'} onClick={() => void copySnapshot()} />
      </div>

      {snap?.logLines && snap.logLines.length > 0 ? (
        <pre className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] leading-5 text-slate-400">{snap.logLines.slice(-100).join('\n')}</pre>
      ) : null}
    </Card>
  )
}

function MiniBtn({ tone, icon, label, onClick, disabled }: { tone: 'slate' | 'emerald'; icon: JSX.Element; label: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  const tones = { slate: 'border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-700/60', emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={['inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition', disabled ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600' : tones[tone]].join(' ')}>
      {icon}
      {label}
    </button>
  )
}
