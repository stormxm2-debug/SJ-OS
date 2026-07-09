import { useEffect, useRef, useState } from 'react'
import { Bell, X, ClipboardCheck } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import { getBackendConfig } from '@renderer/services/commercial/backendConfig'
import { getSupabaseClient, initSupabaseClient } from '@renderer/services/commercial/supabaseClient'

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
  target: 'registration-admin' | 'customer'
}

let toastSeq = 1

export default function NotificationCenter(): JSX.Element | null {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const [toasts, setToasts] = useState<Toast[]>([])
  const meRef = useRef<string | null>(null)
  const adminRef = useRef(false)
  adminRef.current = isAdminRole(session.role)

  const push = (t: Omit<Toast, 'id'>): void => {
    const id = toastSeq++
    setToasts((prev) => [...prev.slice(-3), { ...t, id }])
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 9000)
    // OS 알림 (권한 있으면) — 클릭 시 창 포커스 + 이동
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const n = new Notification(t.title, { body: t.body, tag: `sj-${id}` })
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

    void (async () => {
      const client: any = (await initSupabaseClient()) ?? getSupabaseClient()
      if (!client || !active || typeof client.channel !== 'function') return
      try {
        const { data } = await client.auth.getSession()
        meRef.current = data?.session?.user?.id ?? null
      } catch {
        meRef.current = null
      }

      channel = client.channel('sj-notify-registrations')
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'customer_registrations' }, (payload: any) => {
        const row = payload?.new ?? {}
        // 새 요청 → 관리자에게 (본인이 방금 만든 요청은 제외)
        if (!adminRef.current || String(row.staff_id ?? '') === meRef.current) return
        void describe(client, row).then((d) => {
          if (active) push({ title: '새 고객등록 요청', body: d, target: 'registration-admin' })
        })
      })
      channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'customer_registrations' }, (payload: any) => {
        const row = payload?.new ?? {}
        const status = String(row.status ?? '')
        // 처리 결과 → 요청한 직원 본인에게
        if (String(row.staff_id ?? '') !== meRef.current || (status !== 'done' && status !== 'rejected')) return
        void describe(client, row).then((d) => {
          if (active)
            push({
              title: status === 'done' ? '고객등록 완료 ✓' : '고객등록 반려',
              body: d,
              target: 'customer'
            })
        })
      })
      channel.subscribe()
    })()

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
            {t.target === 'registration-admin' ? <ClipboardCheck className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
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
