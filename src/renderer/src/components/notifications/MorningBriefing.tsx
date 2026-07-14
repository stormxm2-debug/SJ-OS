import { useEffect } from 'react'
import { useSession } from '@renderer/navigation/SessionContext'
import { pushLocalNotification } from '@renderer/services/notifications/localNotify'
import { listCustomers } from '@renderer/services/commercial/customerService'
import { supabaseScheduleAdapter } from '@renderer/services/commercial/supabaseScheduleAdapter'
import { listConsultations } from '@renderer/services/commercial/consultationService'
import { listReferrals } from '@renderer/services/commercial/referralService'
import {
  listContactLogs,
  computeContactList,
  CONTACT_REASON_LABEL,
  type ContactReason
} from '@renderer/services/commercial/contactListService'

/**
 * 아침 접촉 브리핑 — 자체생산 영업 루틴의 시작점.
 *
 * 하루 첫 접속 시(출퇴근 체크로 매일 아침 보장됨) "오늘 접촉할 고객 N명"을
 * 사유별 요약과 함께 토스트+OS 알림으로 띄운다. 클릭하면 오늘의 접촉으로 이동.
 * 계산은 오늘의 접촉 페이지와 동일한 computeContactList를 그대로 재사용하므로
 * 숫자가 화면과 항상 일치한다. 접촉할 고객이 0명이면 조용히 넘어간다.
 */

const SHOWN_KEY = 'sj-os:morning-briefing:v1'
/** 신호 요약 표기 순서 (급한 순). */
const REASON_ORDER: ContactReason[] = ['referral-call', 'birthday', 'referral-remind', 'dormant']

function todayKey(userId: string): string {
  const d = new Date()
  return `${userId}:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

let inFlight = false

export default function MorningBriefing(): null {
  const { session } = useSession()

  useEffect(() => {
    if (!session.isLoggedIn || !session.id) return
    const key = todayKey(session.id)
    try {
      if (window.localStorage.getItem(SHOWN_KEY) === key) return
    } catch {
      /* localStorage 불가 환경이면 브리핑 생략 */
      return
    }
    if (inFlight) return
    inFlight = true

    // 부팅 직후의 초기 로딩과 경쟁하지 않도록 잠깐 늦춘다
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [custRes, evRes, consRes, refRes, logRes] = await Promise.all([
            listCustomers(),
            supabaseScheduleAdapter.listScheduleEvents(),
            listConsultations(),
            listReferrals(),
            listContactLogs()
          ])
          const customers = custRes.ok ? custRes.customers : []
          const myCustomers = custRes.mode === 'supabase' ? customers.filter((c) => c.ownerStaffId === session.id) : customers
          const logs = logRes.ok ? logRes.logs : []
          const myLogs = logs.filter((l) => l.fcId === session.id || logRes.mode !== 'supabase')
          const referrals = refRes.ok ? refRes.referrals : []
          const myReferrals = referrals.filter((r) => r.fcId === session.id || logRes.mode !== 'supabase')

          const { todo } = computeContactList({
            customers: myCustomers,
            events: evRes.ok ? evRes.data : [],
            consultations: consRes.ok ? consRes.consultations : [],
            referrals: myReferrals,
            logs: myLogs,
            staffId: session.id
          })

          // 오늘은 봤다고 표시 (0명이어도 재계산 반복 방지)
          try {
            window.localStorage.setItem(SHOWN_KEY, key)
          } catch {
            /* ignore */
          }
          if (todo.length === 0) return

          const counts = new Map<ContactReason, number>()
          for (const item of todo) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1)
          const parts = REASON_ORDER.filter((r) => (counts.get(r) ?? 0) > 0).map(
            (r) => `${CONTACT_REASON_LABEL[r]} ${counts.get(r)}`
          )
          pushLocalNotification({
            title: `오늘의 접촉 브리핑 — ${todo.length}명 ☀️`,
            body: parts.join(' · '),
            target: 'today-contacts'
          })
        } catch {
          /* 브리핑 실패는 조용히 — 다음 날 다시 시도 */
        } finally {
          inFlight = false
        }
      })()
    }, 4000)
    return () => {
      window.clearTimeout(timer)
      inFlight = false
    }
  }, [session.isLoggedIn, session.id])

  return null
}
