import { useEffect, useRef, useState } from 'react'
import { Bell, X, ClipboardCheck, PhoneCall, ShieldCheck, Hourglass, Sunrise, Cake } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { isAdminRole, isBackOffice } from '@renderer/navigation/roleAccess'
import { getBackendConfig } from '@renderer/services/commercial/backendConfig'
import { getSupabaseClient, initSupabaseClient } from '@renderer/services/commercial/supabaseClient'
import { subscribeLocalNotifications } from '@renderer/services/notifications/localNotify'
import { ensureWebPushSubscription } from '@renderer/services/push/webPush'
import { getNotifySeconds, syncNotifyPrefsToServiceWorker } from '@renderer/services/push/notifyPrefs'

/**
 * 우하단 알림 센터 (카카오톡 스타일 토스트 + OS 알림).
 *
 * customer_registrations 실시간 이벤트 구독:
 *  - INSERT → 관리자에게 "새 고객등록 요청" (본인이 만든 요청은 제외)
 *  - UPDATE(status done/rejected) → 요청한 직원에게 "처리 결과" (RLS가 본인 행만
 *    전달하므로 자연스럽게 대상만 받음)
 * 토스트 클릭 → 관리자는 고객등록 관리, 직원은 고객관리로 이동. OS 알림은 앱이
 * 백그라운드여도 뜨고, 클릭하면 창을 앞으로 가져온다. 알림 내용에 PII 최소 표기.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Toast {
  id: number
  title: string
  body: string
  target: 'registration-admin' | 'backoffice-desk' | 'customer' | 'leads' | 'claim-assistant' | 'exemptions' | 'today-contacts' | 'family-birthdays'
}

let toastSeq = 1
let channelSeq = 0

export default function NotificationCenter(): JSX.Element | null {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const [toasts, setToasts] = useState<Toast[]>([])
  const meRef = useRef<string | null>(null)
  const adminRef = useRef(false)
  adminRef.current = isAdminRole(session.role)
  // 고객등록 요청을 처리하는 사람: 대표·관리자·총무
  const reviewerRef = useRef(false)
  reviewerRef.current = isAdminRole(session.role) || isBackOffice(session.role)
  // 총무비서는 새 요청을 '총무 상황판'으로, 대표·관리자는 '고객등록 관리'로 안내한다.
  const backOfficeRef = useRef(false)
  backOfficeRef.current = isBackOffice(session.role)

  const push = (t: Omit<Toast, 'id'>): void => {
    const id = toastSeq++
    setToasts((prev) => [...prev.slice(-3), { ...t, id }])
    // 표시 시간: '알림 설정'에서 고른 값 (기본 5초, 0 = 누를 때까지)
    const seconds = getNotifySeconds()
    if (seconds > 0) window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), seconds * 1000)
    // OS 알림 (권한 있으면) — 클릭 시 창 포커스 + 이동
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const n = new Notification(t.title, { body: t.body, tag: `sj-${id}`, requireInteraction: seconds === 0 })
        if (seconds > 0) window.setTimeout(() => n.close(), seconds * 1000)
        n.onclick = () => {
          window.focus()
          navigate({ name: t.target })
          n.close()
        }
      }
    } catch {
      /* OS 알림 실패는 무시 — 토스트는 이미 표시됨 */
    }
  }

  // 로컬 버스 (청구비서 분석 완료 등 앱 내부 이벤트) — DB 구독과 독립적으로 항상 수신
  const pushRef = useRef(push)
  pushRef.current = push
  useEffect(() => {
    return subscribeLocalNotifications((n) => pushRef.current({ title: n.title, body: n.body, target: n.target }))
  }, [])

  useEffect(() => {
    if (getBackendConfig().mode !== 'supabase' || !session.isLoggedIn) return
    let active = true
    let channel: any = null

    // OS 알림 권한 1회 요청 (거절해도 토스트는 동작)
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission()
      }
    } catch {
      /* ignore */
    }

    const subscribe = async (): Promise<void> => {
      const client: any = (await initSupabaseClient()) ?? getSupabaseClient()
      if (!client || !active || typeof client.channel !== 'function') return
      if (channel) {
        try {
          channel.unsubscribe()
        } catch {
          /* ignore */
        }
        channel = null
      }
      try {
        const { data } = await client.auth.getSession()
        meRef.current = data?.session?.user?.id ?? null
      } catch {
        meRef.current = null
      }

      // 알림 권한이 허용된 기기면 웹 푸시 구독을 (재)등록 — 앱을 닫아도 OS 알림이 오도록.
      void ensureWebPushSubscription()
      void syncNotifyPrefsToServiceWorker()

      // 채널 이름은 (재)구독마다 고유하게 — 닫힌 채널의 topic을 재사용하면 일부
      // supabase-js 버전에서 조용히 죽은 채널에 조인된다 (wakeKey 리마운트 시 재현).
      channel = client.channel(`sj-notify-${++channelSeq}`)
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'customer_registrations' }, (payload: any) => {
        const row = payload?.new ?? {}
        // 새 요청 → 처리자(대표·관리자·총무)에게 (본인이 방금 만든 요청은 제외)
        if (!reviewerRef.current || String(row.staff_id ?? '') === meRef.current) return
        const target = backOfficeRef.current ? 'backoffice-desk' : 'registration-admin'
        void describe(client, row).then((d) => {
          if (active) push({ title: '새 고객등록 요청', body: d, target })
        })
      })
      channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'customer_registrations' }, (payload: any) => {
        const row = payload?.new ?? {}
        const status = String(row.status ?? '')
        if (String(row.staff_id ?? '') !== meRef.current) return
        // 총무 메모 → 요청한 FC 본인에게 (다시 연락 받으라는 알림)
        const memo = typeof row.note === 'string' ? row.note.trim() : ''
        if (status === 'requested') {
          if (!memo) return
          void custName(client, row.customer_id).then((c) => {
            if (active) push({ title: '총무 메모 도착 📝', body: `${c} · ${memo}`, target: 'backoffice-desk' })
          })
          return
        }
        // 처리 결과 → 요청한 직원 본인에게
        if (status !== 'done' && status !== 'rejected') return
        // 이미 처리된 건에 총무가 메모만 다시 남긴 경우(처리 시각이 2분 넘게 지남) → 메모 알림
        const processedMs = Date.parse(String(row.processed_at ?? ''))
        if (memo && !Number.isNaN(processedMs) && Date.now() - processedMs > 2 * 60 * 1000) {
          void custName(client, row.customer_id).then((c) => {
            if (active) push({ title: '총무 메모 도착 📝', body: `${c} · ${memo}`, target: 'backoffice-desk' })
          })
          return
        }
        void describe(client, row).then((d) => {
          if (active)
            push({
              title: status === 'done' ? '고객등록 완료 ✓' : '고객등록 반려',
              body: d,
              target: 'customer'
            })
        })
      })
      // 새 DB(리드) 배정 → 배정받은 FC 본인에게만 (RLS가 관리자에게도 INSERT를
      // 전달하므로, 배정 대상이 나일 때만 알림을 띄운다 — 분배한 관리자 스팸 방지).
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload: any) => {
        const row = payload?.new ?? {}
        if (String(row.assigned_fc_id ?? '') !== meRef.current) return
        const name = row.name ? String(row.name) : '신규 고객'
        const source = row.source ? String(row.source) : ''
        if (active)
          push({
            title: '새 DB 배정 · 24시간 내 콜',
            body: `${name}${source ? ` · ${source}` : ''}`,
            target: 'leads'
          })
      })
      // 면책 종료 임박/도래 → 담당 FC 본인에게만 (cron 이 exemption_alerts 생성).
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exemption_alerts' }, (payload: any) => {
        const row = payload?.new ?? {}
        if (String(row.staff_id ?? '') !== meRef.current) return
        const who = row.customer_name ? String(row.customer_name) : '고객'
        const what = [row.insurer, row.coverage].filter(Boolean).join(' ')
        const due = String(row.kind ?? '') === 'due'
        if (active)
          push({
            title: due ? '면책 종료 · 보장 시작 🔔' : '면책 종료 임박 (D-7 이내)',
            body: `${who}${what ? ` · ${what}` : ''}`,
            target: 'exemptions'
          })
      })
      // 직원 본인·가족 생일 3일 전~당일 → 관리자에게만 (cron 이 birthday_alerts 생성,
      // RLS로 관리자만 조회 가능). 등록한 직원 본인에겐 알림이 가지 않는다.
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'birthday_alerts' }, (payload: any) => {
        if (!adminRef.current) return
        const row = payload?.new ?? {}
        const person = row.person_name ? String(row.person_name) : '직원'
        const rel = row.relation ? String(row.relation) : ''
        const staff = row.staff_name ? String(row.staff_name) : ''
        const du = Number(row.days_until ?? 0)
        if (active)
          push({
            title: du === 0 ? '오늘 생일 🎂' : `생일 ${du}일 전 🎉`,
            body: `${person}${rel && rel !== '본인' ? `(${staff}님 ${rel})` : ` (${staff}님)`}`,
            target: 'family-birthdays'
          })
      })
      channel.subscribe((status: string) => {
        // 소켓 오류/타임아웃이면 잠시 후 재구독 (useRealtimeSync와 같은 방어).
        if (!active) return
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          window.setTimeout(() => {
            if (active && document.visibilityState === 'visible') void subscribe()
          }, 3000)
        }
      })
    }
    void subscribe()

    return () => {
      active = false
      if (channel) {
        try {
          channel.unsubscribe()
        } catch {
          /* ignore */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.isLoggedIn])

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-72 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => {
            navigate({ name: t.target })
            setToasts((prev) => prev.filter((x) => x.id !== t.id))
          }}
          className="pointer-events-auto flex items-start gap-2.5 rounded-2xl border border-slate-800 bg-white p-3 text-left shadow-xl ring-1 ring-black/5 transition hover:border-indigo-300"
        >
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            {t.target === 'registration-admin' || t.target === 'backoffice-desk' ? (
              <ClipboardCheck className="h-4 w-4" />
            ) : t.target === 'leads' ? (
              <PhoneCall className="h-4 w-4" />
            ) : t.target === 'claim-assistant' ? (
              <ShieldCheck className="h-4 w-4" />
            ) : t.target === 'exemptions' ? (
              <Hourglass className="h-4 w-4" />
            ) : t.target === 'today-contacts' ? (
              <Sunrise className="h-4 w-4" />
            ) : t.target === 'family-birthdays' ? (
              <Cake className="h-4 w-4" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-bold text-slate-100">{t.title}</span>
            <span className="block truncate text-[12px] text-slate-400">{t.body}</span>
            <span className="mt-0.5 block text-[10px] text-indigo-500">누르면 이동</span>
          </span>
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              setToasts((prev) => prev.filter((x) => x.id !== t.id))
            }}
            aria-label="알림 닫기"
            className="rounded p-0.5 text-slate-500 hover:text-slate-300"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        </button>
      ))}
    </div>
  )
}

/** 고객 이름만 짧게 조회 (메모 알림용). */
async function custName(client: any, customerId: unknown): Promise<string> {
  try {
    const { data } = await client.from('customers').select('name').eq('id', customerId).maybeSingle()
    return data?.name ? String(data.name) : '고객'
  } catch {
    return '고객'
  }
}

/** 이벤트 행 → 사람이 읽는 한 줄 (고객·요청자 이름 짧게 조회). */
async function describe(client: any, row: Record<string, any>): Promise<string> {
  try {
    const [custRes, staffRes] = await Promise.all([
      client.from('customers').select('name').eq('id', row.customer_id).maybeSingle(),
      client.from('profiles').select('name').eq('id', row.staff_id).maybeSingle()
    ])
    const cust = custRes?.data?.name ? String(custRes.data.name) : '고객'
    const staff = staffRes?.data?.name ? String(staffRes.data.name) : '직원'
    const insurers = Array.isArray(row.insurers) ? (row.insurers as string[]) : []
    const ins = insurers.length > 0 ? `${insurers[0]}${insurers.length > 1 ? ` 외 ${insurers.length - 1}` : ''}` : ''
    return `${staff} → ${cust}${ins ? ` (${ins})` : ''}`
  } catch {
    return '고객등록 요청'
  }
}
