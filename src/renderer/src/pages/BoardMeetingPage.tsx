import { useCallback, useEffect, useState } from 'react'
import {
  Users,
  Sparkles,
  Loader2,
  CalendarClock,
  ClipboardList,
  Lightbulb,
  Flag,
  Trash2,
  RefreshCw
} from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { buildAssistantContext } from '@renderer/services/assistant/assistantContext'
import {
  isSupabaseMode,
  currentWeekLabel,
  generateReport,
  buildBasicReport,
  saveReport,
  listReports,
  deleteReport,
  type BoardReport,
  type SavedReport
} from '@renderer/services/commercial/boardMeetingService'

const TEAM_ICON: Record<string, string> = { plan: '🧭', ops: '⚙️', sales: '📈', dev: '🛠️' }

/**
 * 경영 회의실 — 대표/관리자가 ‘이번 주 회의 열기’를 누르면, 사내 데이터 스냅샷을
 * 바탕으로 4개 팀(기획·운영·영업·개발) 관점의 주간 경영 자문 리포트를 생성·저장한다.
 */
export default function BoardMeetingPage(): JSX.Element {
  const { session } = useSession()
  const supa = isSupabaseMode()
  const [week] = useState<string>(() => currentWeekLabel())
  const [report, setReport] = useState<BoardReport | null>(null)
  const [reportWeek, setReportWeek] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedReport[]>([])

  const refreshSaved = useCallback(async () => {
    if (!supa) return
    try {
      setSaved(await listReports())
    } catch {
      /* 목록 실패는 조용히 무시 */
    }
  }, [supa])

  useEffect(() => {
    void refreshSaved()
  }, [refreshSaved])

  const onGenerate = async (): Promise<void> => {
    setLoading(true)
    setErr(null)
    setNotice(null)
    try {
      const context = await buildAssistantContext(true, session.id)
      const res = await generateReport(week, context)
      let rep: BoardReport | null = null
      if (res.ok && res.report) {
        rep = res.report
      } else if (res.disabled) {
        rep = buildBasicReport(week, context)
        setNotice('AI 자문 서버가 아직 설정되지 않아, 데이터 요약만 표시합니다.')
      } else {
        setErr(res.error ?? '리포트를 생성하지 못했습니다.')
      }
      if (rep) {
        setReport(rep)
        setReportWeek(week)
        try {
          await saveReport(week, week, rep)
          await refreshSaved()
        } catch {
          setNotice((n) => n ?? '리포트는 만들었지만 저장에 실패했습니다.')
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '회의 생성 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const onOpenSaved = (r: SavedReport): void => {
    setReport(r.report)
    setReportWeek(r.week)
    setErr(null)
    setNotice(null)
  }

  const onDelete = async (id: string): Promise<void> => {
    if (!window.confirm('이 회의 기록을 삭제할까요?')) return
    try {
      await deleteReport(id)
      await refreshSaved()
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-100">
            <Users className="h-5 w-5 text-[#e6c877]" /> 경영 회의실
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            4개 팀(기획·운영·영업·개발)이 지난주 데이터를 바탕으로 경영 자문을 올립니다
          </p>
          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#0e1e3a]/5 px-2 py-0.5 text-[11px] font-semibold text-[#8a6a1e]">
            <CalendarClock className="h-3 w-3" /> 매주 월요일 아침 자동 소집 + 푸시 알림
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0e1e3a] to-[#1f3864] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-125 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-[#e6c877]" />}
          {loading ? '회의 진행 중…' : '이번 주 회의 열기'}
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-400">
        <CalendarClock className="h-3.5 w-3.5" /> 이번 주차: <span className="font-semibold text-slate-200">{week}</span>
      </div>

      {!supa ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          전산(서버) 연동 환경에서만 동작합니다. 웹앱(sj-invest)에서 로그인 후 이용하세요.
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{notice}</div>
      ) : null}
      {err ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-8 text-center">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-indigo-500" />
          <p className="mt-3 text-sm text-slate-500">4개 팀이 데이터를 검토해 리포트를 작성하고 있어요… (최대 1분)</p>
        </div>
      ) : null}

      {/* 리포트 */}
      {report && !loading ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-[#c6982f]/40 bg-white p-5 shadow-sm">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#8a6a1e]">
              <ClipboardList className="h-4 w-4" /> {reportWeek} · 이번 주 현황
            </div>
            <p className="text-sm leading-relaxed text-slate-700">{report.overview || '요약이 비어 있습니다.'}</p>
          </section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {report.teams.map((t) => (
              <section key={t.key} className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
                  <span className="text-lg">{TEAM_ICON[t.key] ?? '•'}</span>
                  <span className="text-sm font-bold text-slate-800">{t.name}</span>
                </div>
                {t.insights.length > 0 ? (
                  <div className="mb-3">
                    <div className="mb-1 flex items-center gap-1 text-[11px] font-bold text-slate-400">
                      <Lightbulb className="h-3.5 w-3.5" /> 현황
                    </div>
                    <ul className="space-y-1">
                      {t.insights.map((s, i) => (
                        <li key={i} className="flex gap-1.5 text-[13px] text-slate-600">
                          <span className="text-slate-300">·</span>
                          <span className="min-w-0">{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {t.proposals.length > 0 ? (
                  <div>
                    <div className="mb-1 flex items-center gap-1 text-[11px] font-bold text-[#c6982f]">
                      <Flag className="h-3.5 w-3.5" /> 제안
                    </div>
                    <ul className="space-y-1">
                      {t.proposals.map((s, i) => (
                        <li key={i} className="flex gap-1.5 text-[13px] font-medium text-slate-700">
                          <span className="text-[#c6982f]">▸</span>
                          <span className="min-w-0">{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {t.insights.length === 0 && t.proposals.length === 0 ? (
                  <p className="text-[13px] text-slate-400">내용 없음</p>
                ) : null}
              </section>
            ))}
          </div>

          {report.decisions.length > 0 ? (
            <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-indigo-700">
                <Flag className="h-4 w-4" /> 대표님 결정이 필요한 안건
              </div>
              <ol className="space-y-1.5">
                {report.decisions.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700">
                    <span className="font-bold text-indigo-500">{i + 1}.</span>
                    <span className="min-w-0">{s}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      ) : null}

      {!report && !loading ? (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-white/50 px-4 py-10 text-center text-sm text-slate-500">
          ‘이번 주 회의 열기’를 누르면 4개 팀의 경영 자문 리포트가 생성됩니다.
        </div>
      ) : null}

      {/* 저장된 회의 */}
      {saved.length > 0 ? (
        <section className="rounded-2xl border border-slate-800 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
              <CalendarClock className="h-3.5 w-3.5" /> 지난 회의 ({saved.length})
            </div>
            <button
              type="button"
              onClick={() => void refreshSaved()}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
            >
              <RefreshCw className="h-3 w-3" /> 새로고침
            </button>
          </div>
          <div className="space-y-1">
            {saved.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <button
                  type="button"
                  onClick={() => onOpenSaved(r)}
                  className="min-w-0 flex-1 text-left text-sm font-medium text-slate-700"
                >
                  {r.week}
                  <span className="ml-2 text-[11px] text-slate-400">
                    {new Date(r.createdAt).toLocaleDateString('ko-KR')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(r.id)}
                  className="shrink-0 text-slate-400 hover:text-rose-500"
                  aria-label="삭제"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
