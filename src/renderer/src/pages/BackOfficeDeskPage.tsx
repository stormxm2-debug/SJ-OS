import { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, Loader2, AlertTriangle, CheckCircle2, XCircle, RefreshCw, MessageSquarePlus, BellRing } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole, isBackOffice } from '@renderer/navigation/roleAccess'
import {
  listRegistrations,
  processRegistration,
  saveRegistrationNote,
  REGISTRATION_STATUS_LABEL,
  type CustomerRegistration
} from '@renderer/services/commercial/registrationService'
import { useRealtimeSync } from '@renderer/services/commercial/useRealtimeSync'

/**
 * 총무 상황판 — FC가 고객등록을 저장하면 여기에 카드로 올라온다.
 *  - 총무·대표·관리자: [완료] [메모] [반려] 로 처리한다.
 *    · 완료: 고객 보험사 반영 + 상태 완료 → 요청 FC에게 알림
 *    · 메모: 저장 시 요청 FC에게 "총무 메모 도착" 알림 (다시 연락 유도)
 *    · 반려: 상태 반려 → 요청 FC에게 알림
 *  - FC: 본인이 올린 고객등록의 진행 상황과 총무 메모를 읽기 전용으로 본다.
 *    (DB 정책상 FC는 본인 요청만 조회되므로 다른 FC 건은 보이지 않는다.)
 * 목록은 실시간 구독으로 자동 갱신된다.
 */

const RT_TABLES = ['customer_registrations']

type NotifyPerm = NotificationPermission | 'unsupported'

function readPerm(): NotifyPerm {
  try {
    if (typeof Notification === 'undefined') return 'unsupported'
    return Notification.permission
  } catch {
    return 'unsupported'
  }
}

export default function BackOfficeDeskPage(): JSX.Element {
  const { session } = useSession()
  // 처리 권한: 대표·관리자·총무비서. 그 외(FC·팀장)는 본인 건을 읽기 전용으로 본다.
  const canProcess = isAdminRole(session.role) || isBackOffice(session.role)

  const [items, setItems] = useState<CustomerRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [memoId, setMemoId] = useState<string | null>(null)
  const [memoText, setMemoText] = useState('')
  const [perm, setPerm] = useState<NotifyPerm>(() => readPerm())

  const load = async (): Promise<void> => {
    const res = await listRegistrations()
    setItems(res.items)
    setError(res.ok ? undefined : res.error)
    setLoading(false)
  }
  useEffect(() => {
    void load()
  }, [])
  useRealtimeSync(RT_TABLES, load)

  const pending = useMemo(() => items.filter((i) => i.status === 'requested'), [items])
  const processed = useMemo(() => items.filter((i) => i.status !== 'requested').slice(0, 30), [items])

  const act = async (reg: CustomerRegistration, action: 'done' | 'rejected'): Promise<void> => {
    setBusyId(reg.id)
    const res = await processRegistration(reg, action)
    setBusyId(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(undefined)
    void load()
  }

  const saveMemo = async (reg: CustomerRegistration): Promise<void> => {
    setBusyId(reg.id)
    const res = await saveRegistrationNote(reg, memoText)
    setBusyId(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(undefined)
    setMemoId(null)
    setMemoText('')
    void load()
  }

  const askNotify = (): void => {
    try {
      void Notification.requestPermission().then((p) => setPerm(p))
    } catch {
      setPerm('unsupported')
    }
  }

  const fmt = (iso: string): string => {
    const t = Date.parse(iso)
    return Number.isNaN(t) ? '' : new Date(t).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-4">
      <Card
        title={canProcess ? `총무 상황판 · 대기 ${pending.length}건` : `내 고객등록 현황 · 대기 ${pending.length}건`}
        icon={<ClipboardCheck className="h-4 w-4 text-indigo-600" />}
        action={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-slate-950"
          >
            <RefreshCw className="h-3 w-3" /> 새로고침
          </button>
        }
      >
        <p className="text-[12px] text-slate-500">
          {canProcess ? (
            <>
              FC가 고객등록을 저장하면 여기에 카드가 올라옵니다. <b className="text-slate-300">완료</b>하면 고객 보험사에 반영되고,{' '}
              <b className="text-slate-300">메모</b>를 남기면 요청한 FC에게 알림이 가서 다시 연락을 받습니다.
            </>
          ) : (
            <>
              내가 등록한 고객의 진행 상황입니다. 총무가 남긴 <b className="text-slate-300">메모</b>는 여기서 확인하고, 필요한 연락은
              총무와 직접 나누세요.
            </>
          )}
        </p>

        {canProcess && perm !== 'granted' && perm !== 'unsupported' ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <BellRing className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              {perm === 'denied'
                ? 'PC 알림이 차단되어 있습니다. 브라우저 주소창 옆 설정에서 알림을 허용해 주세요.'
                : '이 PC에서 새 등록 요청 알림(OS 팝업)이 꺼져 있습니다.'}
            </span>
            {perm === 'default' ? (
              <button type="button" onClick={askNotify} className="rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-500">
                알림 켜기
              </button>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
          </div>
        ) : pending.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-slate-700 py-8 text-center text-[12px] text-slate-500">
            {canProcess ? '대기 중인 고객등록이 없습니다. 👏' : '대기 중인 고객등록이 없습니다.'}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {pending.map((r) => {
              const editing = canProcess && memoId === r.id
              return (
                <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">대기</span>
                    <span className="text-sm font-bold text-slate-100">{r.customerName || '(고객)'}</span>
                    <span className="text-[12px] text-slate-500">
                      {canProcess ? `${r.staffName || '(FC)'} 등록` : '내가 등록'} · {fmt(r.requestedAt)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {r.insurers.map((ins) => (
                      <span key={ins} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">
                        {ins}
                      </span>
                    ))}
                  </div>
                  {r.note && !editing ? (
                    <p className="mt-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[12px] text-slate-300">📝 {canProcess ? '최근 메모' : '총무 메모'}: {r.note}</p>
                  ) : null}

                  {editing ? (
                    <div className="mt-2 space-y-1.5">
                      <textarea
                        value={memoText}
                        onChange={(e) => setMemoText(e.target.value)}
                        rows={2}
                        maxLength={300}
                        placeholder="예) 보험사 로그인 완료, 서류 1장 더 필요 — FC 연락 바람"
                        className="w-full rounded-lg border border-slate-700 bg-white px-2.5 py-2 text-[12px] text-slate-100 outline-none focus:border-indigo-400"
                      />
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setMemoId(null)
                            setMemoText('')
                          }}
                          className="rounded-lg border border-slate-800 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-400"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveMemo(r)}
                          disabled={busyId === r.id || !memoText.trim()}
                          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
                        >
                          {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null} 저장 · FC에게 알림
                        </button>
                      </div>
                    </div>
                  ) : canProcess ? (
                    <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setMemoId(r.id)
                          setMemoText(r.note ?? '')
                        }}
                        disabled={busyId === r.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-[11px] font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-60"
                      >
                        <MessageSquarePlus className="h-3 w-3" /> 메모
                      </button>
                      <button
                        type="button"
                        onClick={() => void act(r, 'rejected')}
                        disabled={busyId === r.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-400 transition hover:text-rose-600 disabled:opacity-60"
                      >
                        <XCircle className="h-3 w-3" /> 반려
                      </button>
                      <button
                        type="button"
                        onClick={() => void act(r, 'done')}
                        disabled={busyId === r.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                      >
                        {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} 완료
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card title={canProcess ? '처리 이력' : '처리된 요청'} icon={<ClipboardCheck className="h-4 w-4 text-emerald-600" />}>
        {processed.length === 0 ? (
          <p className="text-[12px] text-slate-500">아직 처리 이력이 없습니다.</p>
        ) : (
          <div className="space-y-1.5">
            {processed.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-white px-3 py-2 text-[12px]">
                <span
                  className={[
                    'rounded-full px-2 py-0.5 text-[10px] font-bold',
                    r.status === 'done' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                  ].join(' ')}
                >
                  {REGISTRATION_STATUS_LABEL[r.status]}
                </span>
                <span className="font-semibold text-slate-100">{r.customerName}</span>
                <span className="text-slate-500">{r.insurers.join(' · ')}</span>
                <span className="ml-auto text-[11px] text-slate-500">
                  {canProcess ? r.staffName : ''} {r.processedAt ? `· ${fmt(r.processedAt)}` : ''}
                </span>
                {r.note ? <span className="basis-full text-[11px] text-slate-500">📝 {r.note}</span> : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
