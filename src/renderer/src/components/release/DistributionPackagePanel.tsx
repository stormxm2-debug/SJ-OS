import { useState } from 'react'
import { PackageCheck, FileSearch, HardDriveDownload, Check, Copy, Users, Lock, AlertTriangle, Loader2 } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { DetectedPackageFile, StaffDistributionPackage } from '@shared/distributionPackage'
import { copyPromptToClipboard } from '@renderer/services/claude-code/claudeCodeBridge'
import { useReleaseApprovals } from '@renderer/services/release-approval/releaseApprovalStore'
import {
  addStaffRecord,
  setDistributionStatus,
  setStaffRecordStatus,
  upsertDistributionPackage,
  useDistributionPackages
} from '@renderer/services/release-approval/distributionRegistry'

/**
 * 직원 배포 패키지 기록 — track desktop installer packages for staff releases.
 * Main inspects fixed output folders + computes SHA-256; staff distribution
 * records are local. NO upload, NO send, NO build, NO shell. Inline cards only.
 */

function api(): Window['sj']['distributionPackage'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.distributionPackage : undefined
}
function snapApi(): Window['sj']['releaseSnapshot'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.releaseSnapshot : undefined
}

export default function DistributionPackagePanel(): JSX.Element {
  const available = !!api()
  const approvals = useReleaseApprovals()
  const packages = useDistributionPackages()
  const [version, setVersion] = useState('0.0.0')
  const [detected, setDetected] = useState<DetectedPackageFile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const inspect = async (): Promise<void> => {
    setBusy(true)
    const res = await api()?.inspectPackageOutputs()
    setBusy(false)
    if (!res) return
    setVersion(res.version)
    setDetected(res.files)
    setMsg(res.errorMessage ?? (res.files.length === 0 ? '아직 감지된 설치파일이 없습니다. 설치파일 패키지 센터에서 빌드를 먼저 진행해주세요.' : null))
  }

  const register = async (file: DetectedPackageFile): Promise<void> => {
    setBusy(true)
    const info = await api()?.registerPackage(file.id)
    setBusy(false)
    if (!info) return
    if (info.errorMessage) { setMsg(info.errorMessage); return }
    // Enrich with tag/commit + release note from other centers.
    const snap = await snapApi()?.inspectTagReadiness().catch(() => null)
    const item = approvals.find((i) => i.status === 'release-ready') ?? approvals.find((i) => i.status === 'approved')
    const now = new Date().toISOString()
    const pkg: StaffDistributionPackage = {
      id: `pkg-${info.relativePath}`,
      version: info.version,
      title: `${info.fileName} (${info.version})`,
      packageFileName: info.fileName,
      packageRelativePath: info.relativePath,
      packageSizeBytes: info.sizeBytes,
      packageSizeLabel: info.sizeLabel,
      sha256: info.sha256,
      fileType: info.fileType,
      commitHash: snap?.commitHash,
      tagName: snap?.tagName,
      linkedReleaseApprovalItemId: item?.id,
      releaseNote: item?.releaseNote ?? `${info.fileName} 배포 패키지`,
      status: 'registered',
      distributionMethod: 'manual-copy',
      staffTargets: [],
      distributionRecords: [],
      riskNotes: item ? [] : ['릴리즈 승인 항목이 없어 릴리즈 노트/링크가 비어 있습니다.'],
      createdAt: now,
      registeredAt: now,
      updatedAt: now
    }
    upsertDistributionPackage(pkg)
    setMsg(`패키지를 등록했습니다: ${info.fileName}`)
  }

  return (
    <Card
      title="직원 배포 패키지 기록"
      icon={<PackageCheck className="h-4 w-4 text-indigo-300" />}
      action={<span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">직원 배포 기록 안전 빌드</span>}
    >
      <p className="mb-3 text-xs text-slate-500">
        직원 PC용 설치파일을 버전별로 기록·추적합니다. 안전한 출력 폴더만 검사하고 SHA-256 체크섬을 계산합니다.
        업로드/발송/빌드는 하지 않습니다.
      </p>
      {!available ? <p className="mb-2 text-[11px] text-amber-300">데스크톱 앱에서만 사용할 수 있습니다.</p> : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MiniBtn tone="slate" icon={busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSearch className="h-3 w-3" />} label="설치파일 폴더 확인" onClick={() => void inspect()} disabled={busy} />
        <span className="text-[11px] text-slate-500">현재 앱 버전: <span className="font-mono">{version}</span></span>
      </div>

      {msg ? <div className="mb-3 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-indigo-200">{msg}</div> : null}

      {/* Detected candidates */}
      {detected && detected.length > 0 ? (
        <div className="mb-3 space-y-2">
          <div className="text-[11px] font-semibold text-slate-400">감지된 설치파일 ({detected.length})</div>
          {detected.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2 text-[11px]">
              <div className="min-w-0">
                <div className="truncate font-mono text-slate-300">{f.relativePath}</div>
                <div className="text-slate-500">{f.sizeLabel} · {f.fileType} · {new Date(f.modifiedAt).toLocaleString()}</div>
              </div>
              <MiniBtn tone="emerald" icon={<HardDriveDownload className="h-3 w-3" />} label="패키지 등록" onClick={() => void register(f)} disabled={busy} />
            </div>
          ))}
        </div>
      ) : null}

      {/* Registered packages */}
      {packages.length > 0 ? (
        <div className="space-y-3">
          <div className="text-[11px] font-semibold text-slate-400">등록된 배포 패키지</div>
          {packages.map((p) => <PackageCard key={p.id} pkg={p} />)}
        </div>
      ) : null}

      {/* Future (disabled) */}
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-500">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <div className="font-semibold text-slate-400">다음 단계 (비활성)</div>
          직원별 다운로드 링크 · 자동 업데이트 · 설치 완료 자동 보고 · 사내 NAS/공유폴더 연동 · 롤백 배포는 다음 안정화 단계에서 활성화됩니다.
        </div>
      </div>
    </Card>
  )
}

function PackageCard({ pkg }: { pkg: StaffDistributionPackage }): JSX.Element {
  const [copied, setCopied] = useState<string | null>(null)
  const [staffName, setStaffName] = useState('')
  const [staffRole, setStaffRole] = useState('')

  const copy = async (key: string, text: string): Promise<void> => {
    if (await copyPromptToClipboard(text)) { setCopied(key); window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000) }
  }
  const infoText = [
    'SJ OS 직원 배포 패키지',
    `- Version: ${pkg.version}`,
    `- File: ${pkg.packageFileName}`,
    `- Size: ${pkg.packageSizeLabel}`,
    `- SHA-256: ${pkg.sha256}`,
    `- Tag: ${pkg.tagName ?? '(없음)'}`,
    `- Commit: ${pkg.commitHash ?? '(없음)'}`,
    `- Release note: ${pkg.releaseNote}`,
    `- Distribution status: ${pkg.status}`
  ].join('\n')

  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{pkg.packageFileName}</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">{pkg.packageRelativePath} · {pkg.packageSizeLabel} · {pkg.fileType}</div>
        </div>
        <span className="shrink-0 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-300">{pkg.status}</span>
      </div>
      <div className="mt-1 space-y-0.5 text-[10px] text-slate-500">
        <div className="truncate">SHA-256: <span className="font-mono">{pkg.sha256}</span></div>
        <div>태그: <span className="font-mono">{pkg.tagName ?? '(없음)'}</span> · 커밋: <span className="font-mono">{pkg.commitHash?.slice(0, 12) ?? '(없음)'}</span></div>
        <div className="text-slate-400">릴리즈 노트: {pkg.releaseNote}</div>
      </div>
      {pkg.riskNotes.length > 0 ? <div className="mt-1 text-[10px] text-amber-300"><AlertTriangle className="mr-1 inline h-3 w-3" />{pkg.riskNotes.join(' · ')}</div> : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {pkg.status === 'registered' ? <MiniBtn tone="emerald" icon={<Check className="h-3 w-3" />} label="배포 준비 완료로 표시" onClick={() => setDistributionStatus(pkg.id, 'ready-for-distribution')} /> : null}
        <MiniBtn tone="slate" icon={copied === 'info' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} label={copied === 'info' ? '복사됨' : '패키지 정보 복사'} onClick={() => void copy('info', infoText)} />
        <MiniBtn tone="slate" icon={copied === 'sha' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} label={copied === 'sha' ? '복사됨' : '체크섬 복사'} onClick={() => void copy('sha', pkg.sha256)} />
      </div>

      {/* Staff distribution records */}
      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-2">
        <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-400"><Users className="h-3 w-3" /> 직원 배포 기록</div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <input value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="직원명" className="w-24 rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-600 focus:outline-none" />
          <input value={staffRole} onChange={(e) => setStaffRole(e.target.value)} placeholder="직책/팀" className="w-24 rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-600 focus:outline-none" />
          <MiniBtn tone="slate" icon={<span />} label="직원 배포 기록 추가" onClick={() => { addStaffRecord(pkg.id, staffName, staffRole, pkg.version); setStaffName(''); setStaffRole('') }} />
        </div>
        {pkg.distributionRecords.length === 0 ? (
          <p className="text-[10px] text-slate-500">기록이 없습니다.</p>
        ) : (
          <div className="space-y-1">
            {pkg.distributionRecords.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
                <span className="text-slate-400">{r.staffName}{r.staffRole ? ` · ${r.staffRole}` : ''} · <span className="text-slate-500">{r.status}</span></span>
                <div className="flex flex-wrap gap-1">
                  {(['not-sent', 'sent', 'installed', 'failed', 'skipped'] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setStaffRecordStatus(pkg.id, r.id, s)} className={['rounded border px-1.5 py-0.5 transition', r.status === s ? 'border-indigo-500/40 bg-indigo-500/20 text-indigo-300' : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200'].join(' ')}>
                      {{ 'not-sent': '발송 전', sent: '발송 완료', installed: '설치 확인', failed: '실패', skipped: '제외' }[s]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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
