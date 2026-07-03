import { Layers } from 'lucide-react'
import type { KernelStateSnapshot } from '@shared/kernel'
import { useKernel } from '@renderer/chief-of-staff/useKernel'
import Card from '@renderer/components/ui/Card'
import Chip from '@renderer/components/ui/Chip'

/**
 * Domain architecture — the highest business layer. Derived entirely from the
 * generated project files (artifacts) in the Kernel snapshot: no Kernel, Meeting
 * Engine, Department or Asset Store changes. Shows Company → Project → Domains,
 * and links each domain to the module/asset it owns.
 */

const PREFIX = 'src/renderer/src/domains/'

const TITLES: Record<string, string> = {
  customer: '고객',
  consultation: '상담',
  'insurance-analysis': '보험 분석',
  policy: '보험증권',
  claim: '보험금 청구',
  medical: '의료',
  'hidden-money': '숨은 보험금',
  'ai-planner': 'AI 플래너',
  document: '문서',
  admin: '관리자'
}

const AREA_LABEL: Record<string, string> = {
  models: 'Models',
  services: 'Services',
  views: 'Views',
  components: 'Components',
  commands: 'Commands',
  events: 'Events',
  tests: 'Tests',
  assets: 'Assets',
  data: 'Data',
  README: 'Docs',
  DOMAIN: 'Docs',
  domain: 'Manifest',
  index: 'Contract'
}

interface DomainInfo {
  slug: string
  files: number
  areas: string[]
}

function humanize(slug: string): string {
  return (
    TITLES[slug] ??
    slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  )
}

function deriveDomains(snapshot: KernelStateSnapshot): DomainInfo[] {
  const byslug = new Map<string, { files: number; areas: Set<string> }>()
  for (const artifact of snapshot.artifacts) {
    if (!artifact.path.startsWith(PREFIX)) continue
    const segs = artifact.path.slice(PREFIX.length).split('/')
    const slug = segs[0]
    if (!slug) continue
    let info = byslug.get(slug)
    if (!info) {
      info = { files: 0, areas: new Set() }
      byslug.set(slug, info)
    }
    info.files += 1
    const area = (segs[1] ?? '').replace(/\.(ts|tsx|md|json)$/, '')
    const label = AREA_LABEL[area]
    if (label) info.areas.add(label)
  }
  return [...byslug.entries()].map(([slug, info]) => ({
    slug,
    files: info.files,
    areas: [...info.areas].sort()
  }))
}

export default function DomainArchitecture(): JSX.Element | null {
  const kernel = useKernel()
  const domains = deriveDomains(kernel)
  if (domains.length === 0) return null
  return (
    <Card
      title="도메인 아키텍처"
      icon={<Layers className="h-4 w-4 text-indigo-300" />}
      action={<span className="text-xs text-slate-500">{domains.length}개 도메인</span>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {domains.map((domain) => (
          <DomainCard key={domain.slug} domain={domain} snapshot={kernel} />
        ))}
      </div>
    </Card>
  )
}

function DomainCard({
  domain,
  snapshot
}: {
  domain: DomainInfo
  snapshot: KernelStateSnapshot
}): JSX.Element {
  const asset = snapshot.assets.find((a) =>
    a.files.some((f) => f.startsWith(PREFIX + domain.slug + '/'))
  )
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center gap-2">
        <Layers className="h-3.5 w-3.5 text-indigo-300" />
        <span className="text-sm font-semibold text-slate-100">
          {humanize(domain.slug)} 도메인
        </span>
        <span className="ml-auto text-xs text-slate-500">{domain.files}개 파일</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {domain.areas.map((area) => (
          <Chip key={area} tone="slate">{area}</Chip>
        ))}
      </div>
      {asset && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          모듈:
          <span className="text-slate-300">{asset.name}</span>
          <Chip tone={asset.status === 'registered' ? 'emerald' : 'amber'}>
            {asset.status === 'registered' ? 'registered' : 'in dev'}
          </Chip>
        </div>
      )}
    </div>
  )
}
