import { Rocket, Clock3 } from 'lucide-react'
import { useCompanyStartup } from '@renderer/services/companyStartupStore'

export default function StartupPanel(): JSX.Element {
  const startup = useCompanyStartup()

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">회사 시작</div>
          <div className="mt-1 text-sm text-slate-400">한 번의 클릭으로 전체 AI 컴퍼니 워크플로를 실행합니다.</div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined' && window.sj?.companyStartup) {
              void window.sj.companyStartup.start()
            }
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-400"
        >
          <Rocket className="h-4 w-4" />
          회사 시작
        </button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Clock3 className="h-4 w-4 text-indigo-300" />
            시작 타임라인
          </div>
          <ol className="mt-4 space-y-3">
            {startup.steps.map((step) => (
              <li key={step.id} className="flex items-start gap-3 text-sm">
                <span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${step.status === 'completed' ? 'bg-emerald-400' : step.status === 'failed' ? 'bg-rose-400' : step.status === 'running' ? 'bg-indigo-400 animate-pulse' : step.status === 'skipped' ? 'bg-amber-400' : 'bg-slate-700'}`} />
                <div className="min-w-0">
                  <div className="font-medium text-slate-200">{step.label}</div>
                  {step.detail && <div className="text-xs text-slate-500">{step.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">회사 상태</div>
            <div className="mt-1 text-lg font-semibold text-slate-100">{startup.companyStatus}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">현재 릴리스</div>
            <div className="mt-1 text-slate-100">{startup.currentRelease}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">현재 스프린트</div>
            <div className="mt-1 text-slate-100">{startup.currentSprint}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">다음 우선순위</div>
            <div className="mt-1 text-slate-100">{startup.nextPriority}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">활성 워커</div>
            <div className="mt-1 text-slate-100">{startup.activeWorkers}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">오늘의 목표</div>
            <ul className="mt-2 space-y-1 text-slate-300">
              {startup.todaysObjectives.map((objective) => <li key={objective} className="text-sm">• {objective}</li>)}
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">시작 소요 시간</div>
            <div className="mt-1 text-slate-100">{startup.durationMs ? `${startup.durationMs}ms` : '—'}</div>
          </div>
          {startup.error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">{startup.error}</div>}
        </div>
      </div>
    </section>
  )
}
