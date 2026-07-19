import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardList, Loader2, Play, Plus, RefreshCw, Trash2, X, CheckCircle2, RotateCcw } from 'lucide-react'
import type { JarvisTicket, JarvisTicketStatus } from '@shared/jarvisTickets'
import {
  buildDeveloperPromptFromTicket,
  suggestAcceptanceCriteria,
  TICKET_STATUS_LABEL
} from '@shared/jarvisTickets'
import { useClaudeAutoBuild } from '@renderer/services/claude-auto-build/useClaudeAutoBuild'
import { deriveTitle } from '@renderer/services/claude-auto-build/promptGenerator'

/**
 * 자비스 티켓 보드 — 디렉터→개발자→리뷰어 파이프라인의 1단계 UI.
 *
 *  - 대표 명령 → 디렉터가 완료 기준이 명시된 티켓 초안 생성(수정 가능) → 저장.
 *  - [개발 실행] = 티켓을 개발자 프롬프트로 변환해 기존 claudeAutoBuild 잡으로
 *    실행 (사람이 버튼을 누르는 것이 실행 승인).
 *  - 개발 잡 성공 → 검토 대기, 실패 → 반려로 자동 전환. 검토 승인/반려는 1단계에선
 *    사람이 (2단계에서 리뷰어 AI로 대체 예정). 커밋/배포는 기존 게이트 그대로.
 */

function ticketApi(): Window['sj']['tickets'] | undefined {
  return typeof window !== 'undefined' ? window.sj?.tickets : undefined
}

interface DraftState {
  title: string
  objective: string
  originalCommand: string
  inputFilesText: string
  criteria: string[]
}

/** 보드 4열: 반려는 요청 열에(재실행 대상), 승인은 완료 열에 묶는다. */
const COLUMNS: { key: string; label: string; statuses: JarvisTicketStatus[] }[] = [
  { key: 'requested', label: '요청', statuses: ['requested', 'rejected'] },
  { key: 'developing', label: '개발 중', statuses: ['developing'] },
  { key: 'reviewing', label: '검토 대기', statuses: ['reviewing'] },
  { key: 'done', label: '완료', statuses: ['approved', 'done'] }
]

export default function TicketBoardPanel(): JSX.Element {
  const available = !!ticketApi()
  const { jobs, createJobFromPrompt, runJob, envReady } = useClaudeAutoBuild()
  const [tickets, setTickets] = useState<JarvisTicket[]>([])
  const [error, setError] = useState<string | undefined>()
  const [busyId, setBusyId] = useState<string | undefined>()
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [command, setCommand] = useState('')
  const [openId, setOpenId] = useState<string | undefined>()
  // 같은 잡 상태 전환을 중복 반영하지 않기 위한 처리 기록
  const handledRef = useRef<Set<string>>(new Set())

  const reload = useCallback(async (): Promise<void> => {
    const bridge = ticketApi()
    if (!bridge) return
    try {
      setTickets(await bridge.list())
      setError(undefined)
    } catch {
      setError('티켓 목록을 불러오지 못했습니다.')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // 개발 잡 상태 → 티켓 상태 자동 전환 (성공=검토 대기, 실패=반려)
  useEffect(() => {
    const bridge = ticketApi()
    if (!bridge) return
    for (const t of tickets) {
      if (t.status !== 'developing' || !t.jobId) continue
      const job = jobs.find((j) => j.id === t.jobId)
      if (!job) continue
      const key = `${t.taskId}:${job.id}:${job.status}`
      if (handledRef.current.has(key)) continue
      if (job.status === 'succeeded') {
        handledRef.current.add(key)
        void bridge.update(t.taskId, { status: 'reviewing', event: '개발 잡 성공 — 검토 대기 (typecheck·build 통과)' }).then(reload)
      } else if (['failed', 'timed-out', 'blocked', 'cancelled'].includes(job.status)) {
        handledRef.current.add(key)
        void bridge.update(t.taskId, { status: 'rejected', event: `개발 잡 실패 (${job.status}) — 재실행 필요` }).then(reload)
      }
    }
  }, [jobs, tickets, reload])

  /** 디렉터: 명령 → 완료 기준이 채워진 티켓 초안 (편집 후 저장). */
  const makeDraft = (): void => {
    const text = command.trim()
    if (!text) return
    setDraft({
      title: deriveTitle(text),
      objective: text,
      originalCommand: text,
      inputFilesText: '',
      criteria: suggestAcceptanceCriteria(text)
    })
  }

  const saveDraft = async (): Promise<void> => {
    const bridge = ticketApi()
    if (!bridge || !draft) return
    const criteria = draft.criteria.map((c) => c.trim()).filter(Boolean)
    if (!draft.objective.trim() || criteria.length === 0) {
      setError('목표와 완료 기준은 비울 수 없습니다.')
      return
    }
    await bridge.create({
      title: draft.title.trim() || '제목 없는 작업',
      objective: draft.objective.trim(),
      originalCommand: draft.originalCommand,
      inputFiles: draft.inputFilesText.split(',').map((s) => s.trim()).filter(Boolean),
      acceptanceCriteria: criteria
    })
    setDraft(null)
    setCommand('')
    await reload()
  }

  /** 사람이 누르는 [개발 실행] = 실행 승인. 티켓 → 개발자 프롬프트 → 잡 생성+실행. */
  const runTicket = async (t: JarvisTicket): Promise<void> => {
    const bridge = ticketApi()
    if (!bridge) return
    setBusyId(t.taskId)
    setError(undefined)
    try {
      const job = await createJobFromPrompt({
        title: `[${t.taskId}] ${t.title}`,
        prompt: buildDeveloperPromptFromTicket(t),
        command: t.originalCommand,
        source: 'developer-prompt-center'
      })
      if (!job) {
        setError('개발 잡 생성 실패 — 데스크톱 앱에서만 실행할 수 있습니다.')
        return
      }
      await bridge.update(t.taskId, { status: 'developing', jobId: job.id, event: `개발 잡 실행 (${job.id})` })
      await runJob(job.id)
      await reload()
    } finally {
      setBusyId(undefined)
    }
  }

  const setStatus = async (t: JarvisTicket, status: JarvisTicketStatus, event: string): Promise<void> => {
    const bridge = ticketApi()
    if (!bridge) return
    await bridge.update(t.taskId, { status, event })
    await reload()
  }

  const removeTicket = async (t: JarvisTicket): Promise<void> => {
    if (typeof window !== 'undefined' && !window.confirm(`${t.taskId} 티켓을 삭제할까요?`)) return
    await ticketApi()?.remove(t.taskId)
    await reload()
  }

  if (!available) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
          <ClipboardList className="h-4 w-4 text-[#b0821f]" /> 자비스 티켓 보드
        </div>
        <p className="mt-2 text-[12px] text-slate-500">
          작업 티켓 파이프라인은 데스크톱 앱에서만 사용할 수 있습니다 (파일 저장소·Claude 실행이 필요).
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0e1e3a]">
          <ClipboardList className="h-5 w-5 text-[#e6c877]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-100">자비스 티켓 보드 (디렉터 → 개발자 → 검토)</div>
          <div className="text-[11px] text-slate-500">명령 → 완료 기준이 명시된 티켓 → 개발 실행 → 성공 시 검토 대기. 커밋·배포는 기존 승인 절차 그대로.</div>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          aria-label="티켓 새로고침"
          className="rounded-lg border border-slate-800 bg-white p-1.5 text-slate-400 hover:text-indigo-600"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {error ? <div className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</div> : null}

      {/* 디렉터: 명령 입력 → 티켓 초안 */}
      {draft === null ? (
        <div className="mt-3 flex gap-2">
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') makeDraft()
            }}
            placeholder="예: 고객 목록에 최근 상담일 표시해줘"
            className="w-full rounded-xl border border-slate-800 bg-white px-3 py-2.5 text-sm text-slate-100 focus:outline-none"
          />
          <button
            type="button"
            onClick={makeDraft}
            disabled={!command.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#0e1e3a] px-3.5 py-2 text-xs font-bold text-[#e6c877] transition hover:brightness-125 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> 티켓 만들기
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-bold text-slate-100">티켓 초안 — 완료 기준을 확인·수정 후 저장하세요</span>
            <button type="button" onClick={() => setDraft(null)} aria-label="초안 닫기" className="rounded-lg p-1 text-slate-400 hover:text-rose-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <label className="mb-2 block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">제목</span>
            <input
              value={draft.title}
              onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
              className="w-full rounded-lg border border-slate-800 bg-white px-2.5 py-2 text-[13px] text-slate-100 focus:outline-none"
            />
          </label>
          <label className="mb-2 block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">목표 (무엇을 만들어야 하는가)</span>
            <textarea
              value={draft.objective}
              onChange={(e) => setDraft((d) => (d ? { ...d, objective: e.target.value } : d))}
              rows={3}
              className="w-full rounded-lg border border-slate-800 bg-white px-2.5 py-2 text-[13px] text-slate-100 focus:outline-none"
            />
          </label>
          <div className="mb-2">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">완료 기준 (검토 단계에서 이 목록으로 판정)</span>
            <div className="space-y-1.5">
              {draft.criteria.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    value={c}
                    onChange={(e) => setDraft((d) => (d ? { ...d, criteria: d.criteria.map((x, j) => (j === i ? e.target.value : x)) } : d))}
                    className="w-full rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[12px] text-slate-100 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setDraft((d) => (d ? { ...d, criteria: d.criteria.filter((_, j) => j !== i) } : d))}
                    aria-label="기준 삭제"
                    className="rounded-lg p-1 text-slate-400 hover:text-rose-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDraft((d) => (d ? { ...d, criteria: [...d.criteria, ''] } : d))}
              className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-700 px-2 py-1 text-[11px] font-bold text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
            >
              <Plus className="h-3 w-3" /> 기준 추가
            </button>
          </div>
          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] font-medium text-slate-500">입력 자료 (선택 — 파일 경로, 쉼표 구분)</span>
            <input
              value={draft.inputFilesText}
              onChange={(e) => setDraft((d) => (d ? { ...d, inputFilesText: e.target.value } : d))}
              placeholder="docs/..., src/renderer/..."
              className="w-full rounded-lg border border-slate-800 bg-white px-2.5 py-2 text-[12px] text-slate-100 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveDraft()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:brightness-110"
          >
            <ClipboardList className="h-3.5 w-3.5" /> 티켓 저장
          </button>
        </div>
      )}

      {/* 보드 */}
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = tickets.filter((t) => col.statuses.includes(t.status))
          return (
            <div key={col.key} className="rounded-xl border border-slate-800 bg-slate-950 p-2.5">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-bold text-slate-300">{col.label}</span>
                <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-400">{list.length}</span>
              </div>
              <div className="space-y-2">
                {list.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-700 py-3 text-center text-[10px] text-slate-500">없음</div>
                ) : (
                  list.map((t) => {
                    const job = t.jobId ? jobs.find((j) => j.id === t.jobId) : undefined
                    const open = openId === t.taskId
                    return (
                      <div key={t.taskId} className="rounded-lg border border-slate-800 bg-white p-2.5">
                        <button type="button" onClick={() => setOpenId(open ? undefined : t.taskId)} className="block w-full text-left">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-[#0e1e3a] px-1.5 py-0.5 text-[9px] font-bold text-[#e6c877]">{t.taskId}</span>
                            {t.status === 'rejected' ? (
                              <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-600">{TICKET_STATUS_LABEL[t.status]}</span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-[12px] font-bold leading-snug text-slate-100">{t.title}</div>
                          <div className="mt-0.5 text-[10px] text-slate-500">완료 기준 {t.acceptanceCriteria.length}개{job ? ` · 잡 ${job.status}` : ''}</div>
                        </button>
                        {open ? (
                          <div className="mt-2 border-t border-slate-800 pt-2">
                            <ul className="space-y-0.5 text-[10px] text-slate-500">
                              {t.acceptanceCriteria.map((c, i) => (
                                <li key={i}>· {c}</li>
                              ))}
                            </ul>
                            {t.history.length > 0 ? (
                              <div className="mt-1.5 text-[9px] text-slate-500">{t.history[t.history.length - 1].event}</div>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {t.status === 'requested' || t.status === 'rejected' ? (
                            <button
                              type="button"
                              onClick={() => void runTicket(t)}
                              disabled={busyId === t.taskId || !envReady}
                              title={envReady ? '개발자 잡으로 실행' : 'Claude 실행 환경 점검 필요'}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#0e1e3a] px-2 py-1 text-[10px] font-bold text-[#e6c877] transition hover:brightness-125 disabled:opacity-50"
                            >
                              {busyId === t.taskId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} 개발 실행
                            </button>
                          ) : null}
                          {t.status === 'reviewing' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void setStatus(t, 'done', '검토 승인 — 완료 (커밋은 자동개발 패널에서 진행)')}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:brightness-110"
                              >
                                <CheckCircle2 className="h-3 w-3" /> 승인
                              </button>
                              <button
                                type="button"
                                onClick={() => void setStatus(t, 'rejected', '검토 반려 — 수정 후 재실행 필요')}
                                className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-[10px] font-bold text-white hover:brightness-110"
                              >
                                <RotateCcw className="h-3 w-3" /> 반려
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void removeTicket(t)}
                            aria-label="티켓 삭제"
                            className="ml-auto rounded-lg border border-slate-800 bg-white p-1 text-slate-400 hover:border-rose-300 hover:text-rose-600"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
