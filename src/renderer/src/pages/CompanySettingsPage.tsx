import { useEffect, useState } from 'react'
import { Plus, ShieldCheck, Cpu, RefreshCw, LoaderCircle } from 'lucide-react'
import type {
  CompanySettings,
  AutonomyLevel,
  WorkerRole,
  ApprovalPolicy
} from '@shared/types'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'
import Toggle from '@renderer/components/ui/Toggle'
import { ROLE_LABEL } from '@renderer/lib/companyMeta'
import { companySettings } from '@renderer/data/mockManagement'
import { jarvisGptBrainService } from '@renderer/services/jarvis/JarvisGptBrainService'
import type { ProxyStatusResult, ProxyStatusLabel } from '@renderer/services/jarvis/JarvisGptBrainService'

/** Chip tone for each derived proxy status label. */
const STATUS_TONE: Record<ProxyStatusLabel, 'emerald' | 'slate' | 'amber' | 'rose'> = {
  'GPT Ready': 'emerald',
  'GPT Disabled': 'slate',
  'Key Missing': 'amber',
  'Proxy Offline': 'rose'
}

const ROLES: WorkerRole[] = [
  'cto',
  'developer',
  'qa',
  'git',
  'documentation',
  'release'
]

const AUTONOMY: { value: AutonomyLevel; label: string; desc: string }[] = [
  { value: 'supervised', label: '감독 모드', desc: '모든 민감한 작업에 CEO 승인이 필요합니다.' },
  { value: 'balanced', label: '균형 모드', desc: '저위험 작업은 자동 실행되고 나머지는 승인이 필요합니다.' },
  { value: 'autonomous', label: '자율 모드', desc: '워커가 자유롭게 작업하며 승인은 선택 사항입니다.' }
]

const POLICIES: { key: keyof ApprovalPolicy; label: string }[] = [
  { key: 'architecture', label: '아키텍처 승인' },
  { key: 'merge', label: 'main 병합' },
  { key: 'release', label: '릴리스 배포' },
  { key: 'command', label: '파괴적 명령' }
]

export default function CompanySettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<CompanySettings>(companySettings)
  const gptConfig = jarvisGptBrainService.getConfig()
  const [proxyStatus, setProxyStatus] = useState<ProxyStatusResult | null>(null)
  const [checking, setChecking] = useState(false)

  async function refreshProxyStatus(): Promise<void> {
    setChecking(true)
    const result = await jarvisGptBrainService.checkStatus()
    setProxyStatus(result)
    setChecking(false)
  }

  // Probe proxy status once on mount so the CEO sees live reachability.
  useEffect(() => {
    void refreshProxyStatus()
  }, [])

  function update(patch: Partial<CompanySettings>): void {
    setSettings((prev) => ({ ...prev, ...patch }))
  }

  function setRoleProvider(role: WorkerRole, providerId: string): void {
    setSettings((prev) => ({
      ...prev,
      roleProviders: { ...prev.roleProviders, [role]: providerId }
    }))
  }

  function toggleProvider(id: string): void {
    setSettings((prev) => ({
      ...prev,
      providers: prev.providers.map((p) =>
        p.id === id ? { ...p, configured: !p.configured } : p
      )
    }))
  }

  function togglePolicy(key: keyof ApprovalPolicy): void {
    setSettings((prev) => ({
      ...prev,
      policy: { ...prev.policy, [key]: !prev.policy[key] }
    }))
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card title="회사">
        <label className="block text-xs text-slate-500">회사 이름</label>
        <input
          value={settings.companyName}
          onChange={(e) => update({ companyName: e.target.value })}
          className="mt-1 w-full max-w-sm rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
        />
      </Card>

      <Card title="자율성">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {AUTONOMY.map((opt) => {
            const active = settings.autonomyLevel === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => update({ autonomyLevel: opt.value })}
                className={[
                  'rounded-lg border p-3 text-left transition',
                  active
                    ? 'border-indigo-500/50 bg-indigo-500/10'
                    : 'border-slate-800 hover:border-slate-700'
                ].join(' ')}
              >
                <div className="text-sm font-medium text-slate-200">{opt.label}</div>
                <div className="mt-1 text-xs text-slate-500">{opt.desc}</div>
              </button>
            )
          })}
        </div>
      </Card>

      <Card
        title="AI 프로바이더"
        action={
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-slate-400 transition hover:text-slate-200"
          >
            <Plus className="h-3.5 w-3.5" /> 프로바이더 추가
          </button>
        }
      >
        <p className="mb-3 text-xs text-slate-600">
          프로바이더는 플러그형입니다 — 시스템에 고정된 벤더가 없습니다.
        </p>
        <ul className="space-y-2">
          {settings.providers.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-200">{p.label}</span>
                <Chip tone="slate" className="capitalize">
                  {p.kind}
                </Chip>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  {p.configured ? '설정됨' : '설정 안 됨'}
                </span>
                <Toggle
                  checked={p.configured}
                  onChange={() => toggleProvider(p.id)}
                  label={`${p.label} 전환`}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="역할 → 프로바이더">
        <ul className="space-y-2">
          {ROLES.map((role) => (
            <li key={role} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-300">{ROLE_LABEL[role]}</span>
              <select
                value={settings.roleProviders[role]}
                onChange={(e) => setRoleProvider(role, e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-indigo-500"
              >
                {settings.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="AI · GPT 브레인 (Jarvis)">
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-fuchsia-300" />
              <span className="text-sm text-slate-200">OpenAI 프록시</span>
            </div>
            <Chip tone={gptConfig.enabled ? 'emerald' : 'slate'}>
              {gptConfig.enabled ? '활성화됨' : '비활성화됨'}
            </Chip>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
              <div className="text-[11px] text-slate-500">프록시 URL</div>
              <div className="mt-0.5 truncate text-sm text-slate-200" title={gptConfig.proxyUrl}>
                {gptConfig.proxyUrl}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
              <div className="text-[11px] text-slate-500">모델</div>
              <div className="mt-0.5 truncate text-sm text-slate-200">{gptConfig.modelLabel}</div>
            </div>
          </div>

          {/* Live proxy status (GET /ai/status) with a refresh action. */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">프록시 상태</span>
                {proxyStatus ? (
                  <Chip tone={STATUS_TONE[proxyStatus.label]}>{proxyStatus.label}</Chip>
                ) : (
                  <Chip tone="slate">확인 중…</Chip>
                )}
              </div>
              <button
                type="button"
                onClick={() => void refreshProxyStatus()}
                disabled={checking}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500 disabled:opacity-60"
              >
                {checking ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                새로고침
              </button>
            </div>
            {proxyStatus ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <StatusRow label="프록시 연결" ok={proxyStatus.reachable} okText="정상" failText="오프라인" />
                <StatusRow label="OpenAI 활성화" ok={proxyStatus.enabled} okText="ON" failText="OFF" />
                <StatusRow label="API 키 설정" ok={proxyStatus.apiKeyConfigured} okText="설정됨" failText="없음" />
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">서버 모델 · 확인 시각</div>
                  <div className="mt-0.5 truncate text-sm text-slate-200">
                    {proxyStatus.model ?? '—'} · {new Date(proxyStatus.checkedAt).toLocaleTimeString('ko-KR')}
                  </div>
                </div>
                {proxyStatus.message ? (
                  <div className="sm:col-span-2 text-xs text-slate-500">{proxyStatus.message}</div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              OpenAI API 키는 <strong>백엔드 프록시에만</strong> 저장됩니다. SJ OS 프론트엔드에는 API 키를
              절대 입력하지 마세요. 이 화면에서는 키를 입력할 수 없습니다 — 설정 안내만 제공합니다.
              활성화는 프록시의 환경변수(OPENAI_ENABLED, OPENAI_API_KEY)와 렌더러의 VITE_AI_PROXY_ENABLED /
              VITE_AI_PROXY_URL 로 제어합니다. 자세한 내용은 docs/OPENAI_PROXY_SETUP.md 를 참고하세요.
            </div>
          </div>
        </div>
      </Card>

      <Card title="승인 정책">
        <ul className="space-y-2">
          {POLICIES.map(({ key, label }) => (
            <li
              key={key}
              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
            >
              <span className="text-sm text-slate-300">{label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  {settings.policy[key] ? '승인 필요' : '자동 허용'}
                </span>
                <Toggle
                  checked={settings.policy[key]}
                  onChange={() => togglePolicy(key)}
                  label={`${label} 전환`}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-slate-600">
        설정은 이 미리보기에만 적용됩니다 — 아직 저장되지 않습니다.
      </p>
    </div>
  )
}

/** A compact ok/fail row for the proxy status grid. */
function StatusRow({
  label,
  ok,
  okText,
  failText
}: {
  label: string
  ok: boolean
  okText: string
  failText: string
}): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={ok ? 'text-xs font-medium text-emerald-300' : 'text-xs font-medium text-slate-500'}>
        {ok ? okText : failText}
      </span>
    </div>
  )
}
