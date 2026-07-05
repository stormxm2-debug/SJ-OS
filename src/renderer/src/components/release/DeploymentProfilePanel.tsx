import { useEffect, useState } from 'react'
import { Settings2, FileSearch, ShieldCheck, Check, AlertTriangle, Save, ArrowLeft } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { DeployTarget, PackageScriptsInfo } from '@shared/deployment'
import { validateDeployScript } from '@shared/deployment'

/**
 * 배포 프로필 설정 — safely detect / configure the deploy script used by the
 * deployment runner. Only the low-risk local-build profile ("npm run build") or a
 * validated custom script can be applied to package.json (via the Electron main
 * approved-write path). External providers are DRAFT-ONLY. The renderer never
 * writes files or runs shell; npm run deploy is NOT run here. Inline cards only.
 */

function api(): Window['sj']['deploy'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.deploy : undefined
}

interface ProfileOption {
  target: DeployTarget
  name: string
  proposal: string
  risk: 'low' | 'medium' | 'high'
  applicable: boolean
  custom?: boolean
  note: string
}

const PROFILES: ProfileOption[] = [
  { target: 'local-build', name: '로컬 빌드 확인용', proposal: 'npm run build', risk: 'low', applicable: true, note: '실제 외부 배포가 아니라 배포 전 빌드 확인용입니다.' },
  { target: 'custom-existing-script', name: '기존 외부 배포 스크립트 연결', proposal: '', risk: 'medium', applicable: true, custom: true, note: '스크립트를 직접 입력하면 검증 후 적용합니다. 시크릿/파괴적 명령은 차단됩니다.' },
  { target: 'netlify', name: 'Netlify', proposal: '', risk: 'high', applicable: false, note: 'CLI 설치와 로그인 상태가 필요할 수 있어 실제 명령은 대표님 확인 후 별도 단계에서 설정합니다.' },
  { target: 'render', name: 'Render', proposal: '', risk: 'high', applicable: false, note: 'CLI 설치와 로그인 상태가 필요할 수 있어 실제 명령은 대표님 확인 후 별도 단계에서 설정합니다.' },
  { target: 'vercel', name: 'Vercel', proposal: '', risk: 'high', applicable: false, note: 'CLI 설치와 로그인 상태가 필요할 수 있어 실제 명령은 대표님 확인 후 별도 단계에서 설정합니다.' },
  { target: 'cloudflare', name: 'Cloudflare', proposal: '', risk: 'high', applicable: false, note: 'CLI 설치와 로그인 상태가 필요할 수 있어 실제 명령은 대표님 확인 후 별도 단계에서 설정합니다.' }
]

export default function DeploymentProfilePanel(): JSX.Element {
  const available = !!api()
  const [scripts, setScripts] = useState<PackageScriptsInfo | null>(null)
  const [selected, setSelected] = useState<ProfileOption | null>(null)
  const [customText, setCustomText] = useState('')
  const [approved, setApproved] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const inspect = async (): Promise<void> => {
    setBusy(true)
    const s = (await api()?.inspectPackageScripts()) ?? null
    setScripts(s)
    setBusy(false)
  }
  useEffect(() => {
    void inspect()
  }, [])

  const proposal = selected?.custom ? customText : selected?.proposal ?? ''
  const validation = proposal ? validateDeployScript(proposal) : null

  const select = (p: ProfileOption): void => {
    setSelected(p)
    setApproved(false)
    setMsg(null)
    if (!p.custom) setCustomText('')
  }

  const saveDraft = (): void => {
    if (!selected) return
    try {
      localStorage.setItem('sj.deploy.profileDraft', JSON.stringify({ target: selected.target, note: selected.note, at: new Date().toISOString() }))
    } catch {
      /* best effort */
    }
    setMsg('드래프트로 저장했습니다. package.json은 수정하지 않았습니다.')
  }

  const apply = async (): Promise<void> => {
    if (!selected || !proposal) return
    setBusy(true)
    const res = await api()?.applyDeployScript(proposal)
    setBusy(false)
    if (!res) return
    if (res.applied) {
      setScripts(res.scripts)
      setApproved(false)
      setMsg('deploy 스크립트가 준비되었습니다. 배포 실행기에서 배포 전 검사를 진행하세요.')
    } else {
      setMsg(res.errorMessage ?? '적용에 실패했습니다.')
    }
  }

  return (
    <Card
      title="배포 프로필 설정"
      icon={<Settings2 className="h-4 w-4 text-indigo-300" />}
      action={
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
          배포 프로필 안전 빌드
        </span>
      }
    >
      {!available ? <p className="text-[11px] text-amber-300">데스크톱 앱에서만 사용할 수 있습니다.</p> : null}

      {/* Current scripts */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void inspect()} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60">
          <FileSearch className="h-3 w-3" /> package.json 스크립트 확인
        </button>
      </div>
      {scripts ? (
        <div className="mb-3 space-y-1 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[11px]">
          <Line label="deploy 스크립트" ok={scripts.hasDeploy} value={scripts.deployScript ?? '없음'} />
          <Line label="build 스크립트" ok={scripts.hasBuild} value={scripts.buildScript ?? '없음'} />
          <Line label="typecheck 스크립트" ok={scripts.hasTypecheck} value={scripts.typecheckScript ?? '없음'} />
          <div className="text-slate-500">감지된 배포 방식: {scripts.detectedTool}</div>
          {scripts.hasDeploy ? (
            <div className="text-emerald-300">현재 package.json에 deploy 스크립트가 있습니다.</div>
          ) : (
            <div className="text-amber-300">package.json에 deploy 스크립트가 없습니다. 배포 프로필을 선택해주세요.</div>
          )}
        </div>
      ) : null}

      {/* Profile selection (shown when no deploy script, or to change it) */}
      {scripts && !scripts.hasDeploy ? (
        <>
          <div className="mb-2 text-[11px] font-semibold text-slate-400">배포 프로필 선택</div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {PROFILES.map((p) => (
              <button key={p.target} type="button" onClick={() => select(p)}
                className={['rounded-full border px-2.5 py-1 text-[11px] font-medium transition', selected?.target === p.target ? 'border-blue-500/40 bg-blue-600 text-white' : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200'].join(' ')}>
                {p.name}{p.applicable ? '' : ' (드래프트)'}
              </button>
            ))}
          </div>

          {selected ? (
            <div className="rounded-xl border border-slate-800 bg-white p-3 text-[11px] shadow-sm">
              <div className="font-semibold text-slate-100">{selected.name}</div>
              <div className="mt-0.5 text-slate-500">{selected.note}</div>
              <div className="mt-1 text-slate-500">위험도: {selected.risk}</div>

              {selected.custom ? (
                <textarea
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="예: npm run build && your-existing-deploy-script"
                  className="mt-2 h-16 w-full rounded-lg border border-slate-700 bg-slate-900/50 p-2 font-mono text-[10px] text-slate-100 placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none"
                />
              ) : selected.proposal ? (
                <div className="mt-2">
                  <div className="mb-0.5 text-slate-500">deploy 스크립트 제안:</div>
                  <pre className="rounded-lg border border-slate-800 bg-slate-950/70 p-2 font-mono text-[10px] text-slate-300">{selected.proposal}</pre>
                </div>
              ) : null}

              {validation && !validation.safe ? (
                <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-rose-200">
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                  안전하지 않음: {validation.reasons.join(', ')}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {selected.applicable ? (
                  <>
                    {!approved ? (
                      <MiniBtn tone="emerald" icon={<ShieldCheck className="h-3 w-3" />} label="deploy 스크립트 적용 승인" onClick={() => setApproved(true)} disabled={!proposal || !!(validation && !validation.safe)} />
                    ) : (
                      <MiniBtn tone="emerald" icon={<Check className="h-3 w-3" />} label="package.json에 적용" onClick={() => void apply()} disabled={busy || !proposal || !!(validation && !validation.safe)} />
                    )}
                  </>
                ) : (
                  <MiniBtn tone="slate" icon={<Save className="h-3 w-3" />} label="드래프트로 저장" onClick={saveDraft} />
                )}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {msg ? <div className="mt-3 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-indigo-200">{msg}</div> : null}

      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500">
        <ArrowLeft className="h-3 w-3" /> 적용 후 상단 “배포 실행”에서 배포 전 검사를 진행하세요. (이 화면은 배포를 실행하지 않습니다.)
      </div>
    </Card>
  )
}

function Line({ label, ok, value }: { label: string; ok: boolean; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-[10px] text-slate-400">{value}</span>
        <span className={ok ? 'text-emerald-300' : 'text-rose-300'}>{ok ? '있음' : '없음'}</span>
      </span>
    </div>
  )
}

function MiniBtn({ tone, icon, label, onClick, disabled }: { tone: 'emerald' | 'slate'; icon: JSX.Element; label: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  const tones = { emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20', slate: 'border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-700/60' }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={['inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition', disabled ? 'cursor-not-allowed border-slate-800 bg-slate-900/40 text-slate-600' : tones[tone]].join(' ')}>
      {icon}
      {label}
    </button>
  )
}
