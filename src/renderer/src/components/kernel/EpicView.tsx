import { Target } from 'lucide-react'
import type { KernelStateSnapshot } from '@shared/kernel'
import { useKernel } from '@renderer/chief-of-staff/useKernel'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'
import ProgressBar from '@renderer/components/ui/ProgressBar'

/**
 * Epic 001 — Insurance Analysis. Derived entirely from the generated project
 * files (artifacts) in the Kernel snapshot — no Kernel/Meeting/Department/Asset
 * Store changes. The CEO observes EPIC progress and its decomposed features,
 * rather than individual feature progress.
 */

const PREFIX = 'src/renderer/src/domains/insurance-analysis/features/'

const ORDER = [
  'mock-analysis-data',
  'customer-link',
  'policy-link',
  'coverage-summary',
  'coverage-gap-detection',
  'recommendation-engine',
  'analysis-report',
  'analysis-dashboard'
]

const TITLES: Record<string, string> = {
  'mock-analysis-data': '모의 분석 데이터',
  'customer-link': '고객 연동',
  'policy-link': '보험증권 연동',
  'coverage-summary': '보장 요약',
  'coverage-gap-detection': '보장 공백 탐지',
  'recommendation-engine': '추천 엔진',
  'analysis-report': '분석 리포트',
  'analysis-dashboard': '분석 대시보드'
}

function deriveFeatures(snapshot: KernelStateSnapshot): { slug: string; files: number }[] {
  const map = new Map<string, number>()
  for (const artifact of snapshot.artifacts) {
    if (!artifact.path.startsWith(PREFIX)) continue
    const slug = artifact.path.slice(PREFIX.length).split('/')[0]
    if (!slug) continue
    map.set(slug, (map.get(slug) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([slug, files]) => ({ slug, files }))
    .sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug))
}

export default function EpicView(): JSX.Element | null {
  const kernel = useKernel()
  const features = deriveFeatures(kernel)
  if (features.length === 0) return null

  const project =
    kernel.projects.find((p) => p.state === 'active') ??
    kernel.projects[kernel.projects.length - 1]
  const tasks = project ? kernel.tasks.filter((t) => t.projectId === project.id) : []
  const progress = tasks.length
    ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length)
    : 0
  const asset = kernel.assets.find((a) => a.name === 'Insurance Analysis')

  return (
    <Card
      title="Epic 001 — 보험 분석"
      icon={<Target className="h-4 w-4 text-indigo-300" />}
      action={<span className="text-xs text-slate-500">{features.length}개 기능</span>}
    >
      <div className="flex items-center gap-3">
        <ProgressBar value={progress} />
        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-500">
          {progress}%
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {features.map((feature) => (
          <div
            key={feature.slug}
            className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5"
          >
            <div className="truncate text-sm font-medium text-slate-200">
              {TITLES[feature.slug] ?? feature.slug}
            </div>
            <div className="text-xs text-slate-500">{feature.files}개 파일</div>
          </div>
        ))}
      </div>

      {asset && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          등록된 자산:
          <span className="text-slate-300">{asset.name}</span>
          <Chip tone={asset.status === 'registered' ? 'emerald' : 'amber'}>
            {asset.status === 'registered' ? 'registered' : 'in dev'}
          </Chip>
          <span>· 의존: {asset.dependencies.join(', ')}</span>
        </div>
      )}
    </Card>
  )
}
