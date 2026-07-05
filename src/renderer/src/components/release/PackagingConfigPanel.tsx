import { useEffect, useState } from 'react'
import { Wrench, FileSearch, ShieldCheck, Check, Copy, AlertTriangle, ArrowRight } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { ElectronPackagingConfig } from '@shared/electronPackage'
import { copyPromptToClipboard } from '@renderer/services/claude-code/claudeCodeBridge'

/**
 * 설치파일 설정 센터 — detect the packaging tool and propose safe package
 * scripts/metadata. Applies to package.json ONLY for an already-installed tool,
 * after approval. It never installs dependencies, never runs a build, never
 * publishes. The renderer never writes files or runs shell. Inline cards only.
 */

function api(): Window['sj']['electronPackage'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.electronPackage : undefined
}

export default function PackagingConfigPanel(): JSX.Element {
  const available = !!api()
  const [config, setConfig] = useState<ElectronPackagingConfig | null>(null)
  const [showProposal, setShowProposal] = useState(false)
  const [approved, setApproved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const inspect = async (): Promise<void> => {
    setBusy(true)
    setConfig((await api()?.inspectConfig()) ?? null)
    setApproved(false)
    setBusy(false)
  }
  useEffect(() => {
    void inspect()
  }, [])

  const apply = async (): Promise<void> => {
    setBusy(true)
    const res = await api()?.applyConfig()
    setBusy(false)
    if (!res) return
    setConfig(res)
    setApproved(false)
    setMsg(res.status === 'applied' ? '설치파일 빌드 스크립트가 준비되었습니다. 설치파일 패키지 센터에서 패키지 환경 확인 후 실행하세요.' : res.errorMessage ?? '적용에 실패했습니다.')
  }
  const copyInstall = async (): Promise<void> => {
    if (await copyPromptToClipboard('npm install -D electron-builder')) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  const missingTool = config?.detectedTool === 'none' || config?.status === 'missing-tool'
  const hasProposal = !!config && (Object.keys(config.proposedScripts).length > 0 || Object.keys(config.proposedMetadata).length > 0)

  return (
    <Card
      title="설치파일 설정 센터"
      icon={<Wrench className="h-4 w-4 text-indigo-300" />}
      action={
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          설치파일 설정 안전 빌드
        </span>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        패키징 도구(electron-builder / electron-forge)를 감지하고, 이미 설치된 경우에만 안전한 패키징 스크립트를
        제안·적용합니다. 자동 설치/빌드/업로드는 하지 않습니다.
      </p>
      {!available ? <p className="mb-2 text-[11px] text-amber-300">데스크톱 앱에서만 사용할 수 있습니다.</p> : null}

      <div className="mb-3">
        <button type="button" onClick={() => void inspect()} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60">
          <FileSearch className="h-3 w-3" /> 패키징 설정 확인
        </button>
      </div>

      {config ? (
        <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[11px]">
          <div className="text-slate-400">앱 이름: <span className="font-mono">{config.appName}</span> · 버전: <span className="font-mono">{config.version}</span></div>
          <div className="text-slate-500">감지된 패키징 도구: <span className={config.detectedTool === 'none' ? 'text-amber-300' : 'text-emerald-300'}>{config.detectedTool}</span></div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Chip ok={config.hasDistScript} label="dist" />
            <Chip ok={config.hasPackageScript} label="package" />
            <Chip ok={config.hasMakeScript} label="make" />
            <Chip ok={config.hasElectronBuildScript} label="electron:build" />
          </div>
        </div>
      ) : null}

      {/* Missing tool card */}
      {missingTool ? (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
          <div className="mb-1 text-[11px] font-semibold text-amber-200">패키징 도구 필요</div>
          <p className="text-[11px] text-amber-100/90">
            현재 package.json에서 electron-builder/electron-forge를 찾지 못했습니다. 자동 설치는 안전상 진행하지
            않습니다.
          </p>
          <pre className="mt-2 rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] text-slate-300">npm install -D electron-builder</pre>
          <div className="mt-2">
            <MiniBtn tone="slate" icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} label={copied ? '복사됨' : '설치 명령 복사'} onClick={() => void copyInstall()} />
          </div>
        </div>
      ) : null}

      {/* Proposal (tool exists) */}
      {config && !missingTool && hasProposal ? (
        <div className="mt-3">
          <MiniBtn tone="slate" icon={<ArrowRight className="h-3 w-3" />} label={showProposal ? '제안 숨기기' : '설정 제안 보기'} onClick={() => setShowProposal((s) => !s)} />
          {showProposal ? (
            <div className="mt-2 rounded-xl border border-slate-800 bg-white p-3 text-[11px] shadow-sm">
              <div className="font-semibold text-slate-100">제안 스크립트</div>
              <pre className="mt-1 rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] text-slate-300">
                {Object.entries(config.proposedScripts).map(([k, v]) => `"${k === 'electronBuild' ? 'electron:build' : k}": "${v}"`).join('\n') || '(없음)'}
              </pre>
              {Object.keys(config.proposedMetadata).length > 0 ? (
                <>
                  <div className="mt-2 font-semibold text-slate-100">제안 메타데이터</div>
                  <pre className="mt-1 rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] text-slate-300">{JSON.stringify(config.proposedMetadata, null, 2)}</pre>
                </>
              ) : null}
              {config.riskNotes.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-amber-300">{config.riskNotes.map((r) => <li key={r}>• {r}</li>)}</ul>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {!approved ? (
                  <MiniBtn tone="emerald" icon={<ShieldCheck className="h-3 w-3" />} label="적용 승인" onClick={() => setApproved(true)} />
                ) : (
                  <MiniBtn tone="emerald" icon={<Check className="h-3 w-3" />} label="package.json에 적용" onClick={() => void apply()} disabled={busy} />
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {config && !missingTool && !hasProposal ? (
        <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200">
          이미 패키징 스크립트가 준비되어 있습니다. 설치파일 패키지 센터에서 실행하세요.
        </div>
      ) : null}

      {msg ? <div className="mt-3 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-indigo-200">{msg}</div> : null}

      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500">
        <ArrowRight className="h-3 w-3" /> 적용 후 “설치파일 패키지 센터”에서 패키지 환경 확인 후 실행하세요. (이 화면은 빌드/설치를 실행하지 않습니다.)
      </div>
    </Card>
  )
}

function Chip({ ok, label }: { ok: boolean; label: string }): JSX.Element {
  return (
    <span className={['rounded-full border px-2 py-0.5 text-[10px] font-semibold', ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-800/60 text-slate-500'].join(' ')}>
      {label} {ok ? '있음' : '없음'}
    </span>
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
