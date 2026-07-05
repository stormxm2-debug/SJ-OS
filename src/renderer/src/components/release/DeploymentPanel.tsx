import { useState } from 'react'
import { Rocket, ClipboardCheck, ShieldCheck, Play, Square, Loader2, AlertTriangle } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { DeploymentRun } from '@shared/deployment'
import { useReleaseApprovals, type ReleaseApprovalItem } from '@renderer/services/release-approval/releaseApprovalStore'
import { useDeployment } from '@renderer/services/release-approval/useDeployment'

/**
 * 배포 실행 — the approved deployment runner. Only release-ready items can deploy,
 * and only after 배포 승인 → 배포 실행 (two clicks). Deployment (fixed `npm run
 * deploy`) runs in Electron main; the renderer sends only a release item id and
 * never runs shell. No platform/.env/secret changes. Inline cards only.
 */
export default function DeploymentPanel(): JSX.Element | null {
  const items = useReleaseApprovals()
  const { runs, scriptExists, available, preflight, runApproved, cancel } = useDeployment()
  const releaseReady = items.filter((i) => i.status === 'release-ready')

  if (releaseReady.length === 0) return null

  return (
    <Card
      title="배포 실행"
      icon={<Rocket className="h-4 w-4 text-indigo-300" />}
      action={
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          승인 배포 안전 빌드
        </span>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        릴리즈 준비 완료 항목만 배포할 수 있습니다. 배포는 package.json의 deploy 스크립트를 Electron Main에서
        실행하며, 두 번의 승인(배포 승인 → 배포 실행)이 필요합니다.
      </p>
      {scriptExists === false ? (
        <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          package.json에 deploy 스크립트가 없어 자동 배포를 실행할 수 없습니다. (배포 스크립트를 추가하면 활성화됩니다.)
        </div>
      ) : null}
      {!available ? <p className="mb-2 text-[11px] text-amber-300">배포는 데스크톱 앱에서만 가능합니다.</p> : null}
      <div className="space-y-3">
        {releaseReady.map((item) => (
          <DeployCard
            key={item.id}
            item={item}
            run={runs[item.id] ?? null}
            scriptExists={scriptExists}
            onPreflight={() => void preflight(item.id)}
            onRun={() => void runApproved(item.id)}
            onCancel={() => void cancel(item.id)}
          />
        ))}
      </div>
    </Card>
  )
}

function DeployCard({
  item,
  run,
  scriptExists,
  onPreflight,
  onRun,
  onCancel
}: {
  item: ReleaseApprovalItem
  run: DeploymentRun | null
  scriptExists: boolean | null
  onPreflight: () => void
  onRun: () => void
  onCancel: () => void
}): JSX.Element {
  const [approved, setApproved] = useState(false)
  const status = run?.status ?? 'not-ready'
  const deploying = status === 'deploying' || status === 'preflight-running'
  const preflightPassed = status === 'preflight-passed'
  const canDeploy = scriptExists === true && (preflightPassed || status === 'not-ready' || status === 'failed') && !deploying

  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{item.title}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            승인: {item.status} · 검증 typecheck={item.verification.typecheckStatus} · build={item.verification.buildStatus}
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-300">
          {status}
        </span>
      </div>

      {run?.preflight ? (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          <Chip ok={run.preflight.typecheckStatus === 'passed'}>typecheck {run.preflight.typecheckStatus}</Chip>
          <Chip ok={run.preflight.buildStatus === 'passed'}>build {run.preflight.buildStatus}</Chip>
          <Chip ok={run.preflight.packageDeployScriptExists}>deploy 스크립트 {run.preflight.packageDeployScriptExists ? '있음' : '없음'}</Chip>
        </div>
      ) : null}

      {run?.errorMessage ? (
        <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          {run.errorMessage}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <MiniBtn tone="slate" icon={deploying && status === 'preflight-running' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardCheck className="h-3 w-3" />} label="배포 전 검사" onClick={onPreflight} disabled={deploying} />
        {!approved ? (
          <MiniBtn tone="emerald" icon={<ShieldCheck className="h-3 w-3" />} label="배포 승인" onClick={() => setApproved(true)} disabled={scriptExists !== true} />
        ) : null}
        {deploying ? (
          <MiniBtn tone="rose" icon={<Square className="h-3 w-3" />} label="배포 중지" onClick={onCancel} />
        ) : null}
      </div>

      {approved && !deploying ? (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
          <p className="text-[11px] font-semibold text-amber-200">이 릴리즈를 실제 배포합니다. 계속하시겠습니까?</p>
          <div className="mt-2 flex gap-2">
            <MiniBtn tone="emerald" icon={<Play className="h-3 w-3" />} label="배포 실행" onClick={() => { setApproved(false); onRun() }} disabled={!canDeploy} />
            <MiniBtn tone="slate" icon={<span />} label="취소" onClick={() => setApproved(false)} />
          </div>
          {scriptExists !== true ? <p className="mt-1 text-[11px] text-amber-300">deploy 스크립트가 없어 실행할 수 없습니다.</p> : null}
        </div>
      ) : null}

      {run?.logLines && run.logLines.length > 0 ? (
        <pre className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] leading-5 text-slate-400">
          {run.logLines.slice(-200).join('\n')}
        </pre>
      ) : null}
      {typeof run?.exitCode === 'number' ? <div className="mt-1 text-[10px] text-slate-500">exit {run.exitCode}</div> : null}
    </div>
  )
}

function Chip({ ok, children }: { ok: boolean; children: React.ReactNode }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 font-semibold', ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'].join(' ')}>
      {children}
    </span>
  )
}

function MiniBtn({ tone, icon, label, onClick, disabled }: { tone: 'slate' | 'emerald' | 'rose'; icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  const tones = {
    slate: 'border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-700/60',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={['inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition', disabled ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600' : tones[tone]].join(' ')}>
      {icon}
      {label}
    </button>
  )
}
