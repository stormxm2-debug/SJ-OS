import { useState } from 'react'
import { BookOpen, FileText, Copy, Check, Users, Lock, Wrench, RefreshCw } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import type { StaffDistributionPackage } from '@shared/distributionPackage'
import { copyPromptToClipboard } from '@renderer/services/claude-code/claudeCodeBridge'
import { useDistributionPackages } from '@renderer/services/release-approval/distributionRegistry'
import {
  addStaffInstallRecord,
  formatGuideText,
  generateInstallGuide,
  markGuideCopied,
  setStaffInstallStatus,
  STAFF_INSTALL_STATUS_LABEL,
  upsertGuide,
  useInstallGuides,
  type StaffInstallationGuide,
  type StaffInstallStatus
} from '@renderer/services/release-approval/installGuideStore'

/**
 * 직원 PC 설치/업데이트 안내 — generate an install/update guide from a registered
 * distribution package and track each staff member's install status. Guide +
 * local tracking ONLY: no remote install, no sending/upload, no running installers,
 * no shell. Inline cards only.
 */
export default function InstallGuidePanel(): JSX.Element {
  const packages = useDistributionPackages()
  const guides = useInstallGuides()
  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null)

  const generate = (pkg: StaffDistributionPackage): void => {
    upsertGuide(generateInstallGuide(pkg))
    setSelectedPkgId(pkg.id)
  }

  return (
    <Card
      title="직원 PC 설치/업데이트 안내"
      icon={<BookOpen className="h-4 w-4 text-indigo-300" />}
      action={<span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">직원 설치 안내 안전 빌드</span>}
    >
      <p className="mb-3 text-xs text-slate-500">
        등록된 배포 패키지로 설치/업데이트 안내문을 생성하고, 직원별 설치 상태를 기록합니다. 원격 설치·자동
        발송·업로드는 하지 않습니다.
      </p>

      {packages.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-500">
          등록된 직원 배포 패키지가 없습니다. 먼저 “직원 배포 패키지 기록” 센터에서 설치파일을 등록해주세요.
        </p>
      ) : (
        <>
          <div className="mb-3">
            <div className="mb-1.5 text-[11px] font-semibold text-slate-400">배포 패키지 선택 → 설치 안내 생성</div>
            <div className="flex flex-wrap gap-1.5">
              {packages.slice(0, 8).map((p) => (
                <button key={p.id} type="button" onClick={() => generate(p)}
                  className={['rounded-full border px-2.5 py-1 text-[11px] font-medium transition', selectedPkgId === p.id ? 'border-blue-500/40 bg-blue-600 text-white' : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'].join(' ')}>
                  {p.packageFileName} ({p.version})
                </button>
              ))}
            </div>
          </div>

          {guides.length === 0 ? (
            <p className="text-[11px] text-slate-500">패키지를 선택해 “설치 안내 생성”을 진행하세요.</p>
          ) : (
            <div className="space-y-3">
              {guides.map((g) => (
                <GuideCard key={g.id} guide={g} onRegenerate={() => {
                  const pkg = packages.find((p) => p.id === g.packageId)
                  if (pkg) upsertGuide(generateInstallGuide(pkg))
                }} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Future (disabled) */}
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-500">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <div className="font-semibold text-slate-400">다음 단계 (비활성)</div>
          카카오톡 안내 자동 발송 · 이메일 안내 자동 발송 · 설치 완료 자동 보고 · 자동 업데이트 · 직원 PC 원격 배포 · 롤백 설치 안내는 다음 안정화 단계에서 활성화됩니다.
        </div>
      </div>
    </Card>
  )
}

function GuideCard({ guide, onRegenerate }: { guide: StaffInstallationGuide; onRegenerate: () => void }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const [staffName, setStaffName] = useState('')
  const [staffRole, setStaffRole] = useState('')
  const [showGuide, setShowGuide] = useState(false)

  const copy = async (): Promise<void> => {
    if (await copyPromptToClipboard(formatGuideText(guide))) {
      markGuideCopied(guide.id)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{guide.title}</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">설치파일: <span className="font-mono">{guide.installerFileName}</span></div>
        </div>
        <span className="shrink-0 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-300">{guide.status}</span>
      </div>

      <div className="mt-1 space-y-0.5 text-[10px] text-slate-500">
        <div>설치 대상 버전: <span className="font-mono text-slate-400">{guide.version}</span></div>
        <div className="truncate">SHA-256: <span className="font-mono">{guide.sha256 ?? '(없음)'}</span></div>
        <div className="text-slate-400">릴리즈 노트: {guide.releaseNote}</div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <MiniBtn icon={<RefreshCw className="h-3 w-3" />} label="안내문 다시 생성" onClick={onRegenerate} />
        <MiniBtn icon={<FileText className="h-3 w-3" />} label={showGuide ? '안내문 숨기기' : '설치 안내 보기'} onClick={() => setShowGuide((s) => !s)} />
        <MiniBtn icon={copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} label={copied ? '복사됨' : '안내문 복사'} onClick={() => void copy()} />
      </div>

      {showGuide ? (
        <div className="mt-2 space-y-2 text-[11px]">
          <Section title="설치 전 확인사항" items={guide.preInstallChecklist} />
          <Section title="설치 순서" items={guide.installSteps} numbered />
          <Section title="업데이트 체크리스트" items={guide.updateSteps} numbered />
          <Section title="설치 후 확인사항" items={guide.postInstallChecklist} />
          <div>
            <div className="mb-0.5 flex items-center gap-1 font-semibold text-slate-300"><Wrench className="h-3 w-3" /> 문제 해결 가이드</div>
            <ul className="space-y-0.5 text-slate-400">{guide.troubleshootingItems.map((t) => <li key={t}>• {t}</li>)}</ul>
          </div>
        </div>
      ) : null}

      {/* Staff install status */}
      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-2">
        <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-400"><Users className="h-3 w-3" /> 직원별 설치 상태</div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <input value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="직원명" className="w-24 rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-600 focus:outline-none" />
          <input value={staffRole} onChange={(e) => setStaffRole(e.target.value)} placeholder="직책/팀" className="w-24 rounded border border-slate-700 bg-slate-900/50 px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-600 focus:outline-none" />
          <MiniBtn icon={<span />} label="직원 상태 추가" onClick={() => { addStaffInstallRecord(guide.id, staffName, staffRole, guide.version); setStaffName(''); setStaffRole('') }} />
        </div>
        {guide.targetStaffRecords.length === 0 ? (
          <p className="text-[10px] text-slate-500">기록이 없습니다.</p>
        ) : (
          <div className="space-y-1">
            {guide.targetStaffRecords.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
                <span className="text-slate-400">{r.staffName}{r.staffRole ? ` · ${r.staffRole}` : ''} · <span className="text-slate-500">{STAFF_INSTALL_STATUS_LABEL[r.status]}</span></span>
                <div className="flex flex-wrap gap-1">
                  {(['not-started', 'guide-sent', 'installing', 'installed', 'failed', 'skipped'] as StaffInstallStatus[]).map((s) => (
                    <button key={s} type="button" onClick={() => setStaffInstallStatus(guide.id, r.id, s)} className={['rounded border px-1.5 py-0.5 transition', r.status === s ? 'border-indigo-500/40 bg-indigo-500/20 text-indigo-300' : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200'].join(' ')}>
                      {STAFF_INSTALL_STATUS_LABEL[s]}
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

function Section({ title, items, numbered }: { title: string; items: string[]; numbered?: boolean }): JSX.Element {
  return (
    <div>
      <div className="mb-0.5 font-semibold text-slate-300">{title}</div>
      <ul className="space-y-0.5 text-slate-400">
        {items.map((it, i) => <li key={it}>{numbered ? `${i + 1}. ` : '• '}{it}</li>)}
      </ul>
    </div>
  )
}

function MiniBtn({ icon, label, onClick }: { icon: JSX.Element; label: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700/60">
      {icon}
      {label}
    </button>
  )
}
