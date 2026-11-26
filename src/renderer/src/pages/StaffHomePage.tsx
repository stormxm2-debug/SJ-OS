import { useState, type ReactNode } from 'react'
import { JARVIS_UI_VISIBLE } from '@renderer/components/jarvis/jarvisVisibility'
import { Bot, Check, ArrowRight } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { jarvisService } from '@renderer/services/jarvis/JarvisService'
import MyDayWidgets from '@renderer/components/home/MyDayWidgets'
import SalesListHomeCard from '@renderer/components/home/SalesListHomeCard'

/**
 * Staff Home — quick-action launcher + Jarvis command shortcuts. Sits below the
 * role dashboard (StaffMvpDashboard). Demo/preview numbers were removed so the home
 * starts clean; this section is purely navigation + Jarvis prefill (no fake data,
 * no backend, no global listeners). Styling follows Direction A (bright surfaces).
 */

const JARVIS_COMMANDS = [
  '오늘 일정 알려줘',
  '이번 달 실적 보여줘',
  '미완료 영업활동 정리해줘',
  '클로징 예정 고객 알려줘',
  '고객 상담 준비해줘',
  '보험분석 시작해줘',
  '오늘 해야 할 일 정리해줘',
  '팀 실적 요약해줘'
]

export default function StaffHomePage(): JSX.Element {
  const [copied, setCopied] = useState<string | null>(null)

  // Open Jarvis and prefill its input with the command (NOT auto-executed).
  const useCommand = (command: string): void => {
    jarvisService.openWithDraft(command)
    setCopied(command)
    window.setTimeout(() => setCopied((c) => (c === command ? null : c)), 2500)
  }

  return (
    <div className="space-y-5">
      {/* 내 하루 — 본인 일정 + 본인 이번 달 매출 (자기 것만, 실데이터) */}
      <MyDayWidgets />

      {/* 영업·리쿠르팅 리스트 바로가기 + 이번 달 요약 */}
      <SalesListHomeCard />

      {JARVIS_UI_VISIBLE ? (
      <>
      {/* Jarvis recommended commands */}
      <Card title="자비스 추천 명령" icon={<Bot className="h-4 w-4 text-indigo-600" />} action={<span className="text-xs text-slate-500">클릭하면 자비스 입력창에 넣기</span>}>
        <p className="mb-3 text-xs text-slate-500">자비스에게 자연어로 요청할 수 있습니다. 예: 오늘 일정 알려줘 / 이번 달 실적 보여줘</p>
        <div className="flex flex-wrap gap-2">
          {JARVIS_COMMANDS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              onClick={() => useCommand(cmd)}
              title="자비스 입력창에 넣기"
              className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition hover:bg-[#e0e7ff]"
            >
              {copied === cmd ? <Check className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
              {cmd}
            </button>
          ))}
        </div>
        {copied ? (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5" />
            명령이 자비스에 준비되었습니다. Enter로 실행하세요.
          </div>
        ) : null}
      </Card>
      </>
      ) : null}
    </div>
  )
}
