import { useEffect, useState } from 'react'
import { PackageOpen, FileSearch, ClipboardCheck, ShieldCheck, Play, Square, Loader2, AlertTriangle, Lock, FolderOpen } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { ElectronPackageRun, PackageReadiness } from '@shared/electronPackage'

/**
 * 설치파일 패키지 센터 — build desktop installer packages by running an EXISTING
 * package script (dist/package/make/electron:build) after 패키지 빌드 승인 → 설치파일
 * 빌드 실행. Electron main only; the renderer sends a fixed run id, never a command.
 * No publish, no upload, no dependency install. Inline cards only.
 */

const RUN_ID = 'sj-installer-package'

function api(): Window['sj']['electronPackage'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.electronPackage : undefined
}

export default function ElectronPackagePanel(): JSX.Element {
  const available = !!api()
  const [readiness, setReadiness] = useState<PackageReadiness | null>(null)
  const [run, setRun] = useState<ElectronPackageRun | null>(null)
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false)

  const inspect = async (): Promise<void> => {
    setBusy(true)
    setReadiness((await api()?.inspectReadiness()) ?? null)
    setBusy(false)
  }
  useEffect(() => {
    void inspect()
    const off = api()?.onRunUpdate(({ run: r }) => {
      if (r.id === RUN_ID) setRun(r)
    })
    void api()?.get(RUN_ID).then((r) => r && setRun(r))
    return off
  }, [])

  const hasScript = readiness ? readiness.detectedPackageScript !== 'none' : false
  const status = run?.status ?? 'not-ready'
  const packaging = status === 'packaging' || status === 'preflight-running'
  const preflight = async (): Promise<void> => { setBusy(true); setRun((await api()?.preflight(RUN_ID)) ?? null); setBusy(false) }
  const runBuild = async (): Promise<void> => { setApproved(false); setBusy(true); setRun((await api()?.runApproved(RUN_ID)) ?? null); setBusy(false) }
  const cancel = async (): Promise<void> => { await api()?.cancel(RUN_ID) }

  return (
    <Card
      title="설치파일 패키지 센터"
      icon={<PackageOpen className="h-4 w-4 text-indigo-300" />}
      action={
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          설치파일 패키지 안전 빌드
        </span>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        직원 PC용 데스크톱 설치파일을 준비합니다. package.json의 기존 패키징 스크립트만 실행하며, 승인 후에만
        빌드합니다. 외부 업로드/자동 배포는 하지 않습니다.
      </p>
      {!available ? <p className="mb-2 text-[11px] text-amber-300">데스크톱 앱에서만 사용할 수 있습니다.</p> : null}

      <div className="mb-3 flex flex-wrap gap-2">
        <MiniBtn tone="slate" icon={busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSearch className="h-3 w-3" />} label="패키지 환경 확인" onClick={() => void inspect()} disabled={busy} />
        <MiniBtn tone="slate" icon={status === 'preflight-running' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ClipboardCheck className="h-3 w-3" />} label="배포 전 검사" onClick={() => void preflight()} disabled={packaging || !hasScript} />
      </div>

      {readiness ? (
        <div className="mb-3 space-y-1 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[11px]">
          <div className="text-slate-400">앱 이름: <span className="font-mono">{readiness.appName}</span> · 현재 버전: <span className="font-mono">{readiness.version}</span></div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <ScriptChip ok={readiness.hasDist} label="dist" />
            <ScriptChip ok={readiness.hasPackage} label="package" />
            <ScriptChip ok={readiness.hasMake} label="make" />
            <ScriptChip ok={readiness.hasElectronBuild} label="electron:build" />
            <ScriptChip ok={readiness.hasTypecheck} label="typecheck" />
            <ScriptChip ok={readiness.hasBuild} label="build" />
          </div>
          <div className="pt-1 text-slate-500">
            감지된 패키징 스크립트: <span className="font-mono text-slate-300">{readiness.detectedPackageScript}</span>
            {readiness.packageScriptCommand ? ` (${readiness.packageScriptCommand})` : ''}
          </div>
          <div className="text-slate-500">
            electron-builder: {readiness.usesElectronBuilder ? '있음' : '없음'} · electron-forge: {readiness.usesElectronForge ? '있음' : '없음'} · build 설정: {readiness.buildConfigPresent ? '있음' : '없음'}
          </div>
          {hasScript ? (
            <div className="text-emerald-300">패키지 빌드 가능 · 예상 결과물: dist / release / out 폴더</div>
          ) : (
            <div className="text-amber-300">package.json에 설치파일 빌드 스크립트가 없습니다. 패키징 설정이 필요합니다.</div>
          )}
        </div>
      ) : null}

      {/* Preflight status + errors */}
      {run?.preflight ? (
        <div className="mb-2 flex flex-wrap gap-1.5 text-[10px]">
          <StatusChip ok={run.preflight.typecheckStatus === 'passed'}>typecheck {run.preflight.typecheckStatus}</StatusChip>
          <StatusChip ok={run.preflight.buildStatus === 'passed'}>build {run.preflight.buildStatus}</StatusChip>
          <StatusChip ok={run.preflight.packageScriptExists}>패키지 스크립트 {run.preflight.packageScriptExists ? '있음' : '없음'}</StatusChip>
          <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-semibold text-indigo-300">{status}</span>
        </div>
      ) : null}
      {run?.errorMessage ? (
        <div className="mb-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
          <AlertTriangle className="mr-1 inline h-3 w-3" />{run.errorMessage}
        </div>
      ) : null}

      {/* Approve → run (two-step) */}
      <div className="flex flex-wrap gap-2">
        {!approved ? (
          <MiniBtn tone="emerald" icon={<ShieldCheck className="h-3 w-3" />} label="패키지 빌드 승인" onClick={() => setApproved(true)} disabled={!hasScript || packaging} />
        ) : null}
        {packaging ? (
          <MiniBtn tone="rose" icon={<Square className="h-3 w-3" />} label="빌드 중지" onClick={() => void cancel()} />
        ) : null}
      </div>
      {approved && !packaging ? (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
          <p className="text-[11px] font-semibold text-amber-200">설치파일을 빌드합니다. 계속하시겠습니까?</p>
          <div className="mt-2 flex gap-2">
            <MiniBtn tone="emerald" icon={<Play className="h-3 w-3" />} label="설치파일 빌드 실행" onClick={() => void runBuild()} disabled={!hasScript || busy} />
            <MiniBtn tone="slate" icon={<span />} label="취소" onClick={() => setApproved(false)} />
          </div>
        </div>
      ) : null}

      {/* Output hints */}
      {run?.outputHints && run.outputHints.length > 0 ? (
        <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200">
          <FolderOpen className="mr-1 inline h-3 w-3" />
          설치파일이 생성된 폴더를 확인하세요: {run.outputHints.map((d) => `${d}/`).join(', ')}
        </div>
      ) : null}

      {run?.logLines && run.logLines.length > 0 ? (
        <pre className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] leading-5 text-slate-400">
          {run.logLines.slice(-300).join('\n')}
        </pre>
      ) : null}
      {typeof run?.exitCode === 'number' ? <div className="mt-1 text-[10px] text-slate-500">exit {run.exitCode}</div> : null}

      {/* No publishing */}
      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-500">
        이번 단계는 설치파일 생성까지만 진행합니다. 외부 업로드/자동 업데이트/직원 PC 배포는 다음 단계에서 진행됩니다.
      </div>
      {/* Future (disabled) */}
      <div className="mt-2 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-500">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <div className="font-semibold text-slate-400">다음 단계 (비활성)</div>
          자동 업데이트 · 직원 PC 배포 · 버전 관리 · 롤백 · 설치파일 다운로드 링크는 다음 안정화 단계에서 활성화됩니다.
        </div>
      </div>
    </Card>
  )
}

function ScriptChip({ ok, label }: { ok: boolean; label: string }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[10px] font-semibold', ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800/60 text-slate-500'].join(' ')}>
      {label} {ok ? '있음' : '없음'}
    </span>
  )
}
function StatusChip({ ok, children }: { ok: boolean; children: React.ReactNode }): JSX.Element {
  return <span className={['rounded-full border px-2 py-0.5 font-semibold', ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'].join(' ')}>{children}</span>
}
function MiniBtn({ tone, icon, label, onClick, disabled }: { tone: 'slate' | 'emerald' | 'rose'; icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  const tones = { slate: 'border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-700/60', emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20', rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20' }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={['inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition', disabled ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600' : tones[tone]].join(' ')}>
      {icon}
      {label}
    </button>
  )
}
