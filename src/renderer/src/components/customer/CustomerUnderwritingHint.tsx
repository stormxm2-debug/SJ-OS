import { useEffect, useMemo, useState } from 'react'
import { Stethoscope, ChevronRight } from 'lucide-react'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import {
  listUnderwritingCached,
  matchDiseasesToHistory,
  worstStatusByInsurer,
  UNDERWRITING_INSURERS,
  UNDERWRITING_STATUS_LABEL,
  type UnderwritingDisease,
  type UnderwritingStatus
} from '@renderer/services/underwriting/underwritingService'

/**
 * 고객 병력 텍스트를 인수 가이드 질병 목록과 실시간 매칭해 "이 고객을 받아줄 수 있는
 * 보험사" 요약을 보여준다. 병력이 없거나 매칭이 없으면 아무것도 렌더링하지 않는다.
 * 여러 병력이 매칭되면 회사별로 가장 제한적인 기준(worst)을 표시한다.
 */

const CHIP: Record<UnderwritingStatus, string> = {
  standard: 'bg-emerald-100 text-emerald-700',
  simplified: 'bg-sky-100 text-sky-700',
  exclusion: 'bg-amber-100 text-amber-700',
  loading: 'bg-orange-100 text-orange-700',
  decline: 'bg-rose-100 text-rose-700',
  unknown: 'border border-slate-800 bg-white text-slate-500'
}

export default function CustomerUnderwritingHint({ medicalHistory }: { medicalHistory: string }): JSX.Element | null {
  const { navigate } = useNavigation()
  const [items, setItems] = useState<UnderwritingDisease[]>([])

  useEffect(() => {
    let alive = true
    void listUnderwritingCached().then((res) => {
      if (alive && res.ok) setItems(res.items)
    })
    return () => {
      alive = false
    }
  }, [])

  const matched = useMemo(() => matchDiseasesToHistory(medicalHistory, items), [medicalHistory, items])
  const summary = useMemo(() => worstStatusByInsurer(matched), [matched])

  if (matched.length === 0) return null

  return (
    <div className="mb-3 rounded-xl border border-[#e6c877] bg-[#fdf7ea] p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Stethoscope className="h-4 w-4 shrink-0 text-[#c6982f]" />
        <span className="text-[12px] font-bold text-slate-100">인수 가이드 매칭</span>
        {matched.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => navigate({ name: 'underwriting', q: d.name })}
            className="inline-flex items-center gap-0.5 rounded-full border border-[#c6982f] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#8a6a1f]"
          >
            {d.name}
            <ChevronRight className="h-3 w-3" />
          </button>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
        {UNDERWRITING_INSURERS.map((insurer) => {
          const s = summary[insurer]?.status ?? 'unknown'
          return (
            <div key={insurer} className="flex items-center justify-between gap-1 rounded-lg border border-slate-800 bg-white px-2 py-1.5">
              <span className="truncate text-[10px] font-medium text-slate-300">{insurer}</span>
              <span className={['shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold', CHIP[s]].join(' ')}>
                {UNDERWRITING_STATUS_LABEL[s]}
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-1.5 text-[10px] leading-4 text-slate-500">
        매칭된 병력 중 가장 제한적인 기준으로 요약했습니다 · 질병 칩을 누르면 상세 기준으로 이동합니다
      </p>
    </div>
  )
}
