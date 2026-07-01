import { useState } from 'react'
import { Plus } from 'lucide-react'
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

const ROLES: WorkerRole[] = [
  'cto',
  'developer',
  'qa',
  'git',
  'documentation',
  'release'
]

const AUTONOMY: { value: AutonomyLevel; label: string; desc: string }[] = [
  { value: 'supervised', label: 'Supervised', desc: 'Every sensitive action needs CEO approval.' },
  { value: 'balanced', label: 'Balanced', desc: 'Low-risk actions auto-run; the rest are gated.' },
  { value: 'autonomous', label: 'Autonomous', desc: 'Workers act freely; approvals are opt-in.' }
]

const POLICIES: { key: keyof ApprovalPolicy; label: string }[] = [
  { key: 'architecture', label: 'Architecture sign-off' },
  { key: 'merge', label: 'Merge to main' },
  { key: 'release', label: 'Publish release' },
  { key: 'command', label: 'Destructive commands' }
]

export default function CompanySettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<CompanySettings>(companySettings)

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
      <Card title="Company">
        <label className="block text-xs text-slate-500">Company name</label>
        <input
          value={settings.companyName}
          onChange={(e) => update({ companyName: e.target.value })}
          className="mt-1 w-full max-w-sm rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
        />
      </Card>

      <Card title="Autonomy">
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
        title="AI Providers"
        action={
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-slate-400 transition hover:text-slate-200"
          >
            <Plus className="h-3.5 w-3.5" /> Add provider
          </button>
        }
      >
        <p className="mb-3 text-xs text-slate-600">
          Providers are pluggable — no vendor is wired into the system.
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
                  {p.configured ? 'Configured' : 'Not configured'}
                </span>
                <Toggle
                  checked={p.configured}
                  onChange={() => toggleProvider(p.id)}
                  label={`Toggle ${p.label}`}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Role → Provider">
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

      <Card title="Approval Policy">
        <ul className="space-y-2">
          {POLICIES.map(({ key, label }) => (
            <li
              key={key}
              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5"
            >
              <span className="text-sm text-slate-300">{label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  {settings.policy[key] ? 'Requires approval' : 'Auto-allow'}
                </span>
                <Toggle
                  checked={settings.policy[key]}
                  onChange={() => togglePolicy(key)}
                  label={`Toggle ${label}`}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-slate-600">
        Settings are local to this preview — nothing is persisted yet.
      </p>
    </div>
  )
}
