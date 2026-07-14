import { buildJarvisContext } from '@renderer/services/jarvis/JarvisContextService'
import { listMyLeads, listAllLeads, isOverdue } from '@renderer/services/commercial/leadService'
import { listReferrals, referralFunnel, monthlyCounts } from '@renderer/services/commercial/referralService'
import { listContactLogs } from '@renderer/services/commercial/contactListService'

/**
 * 경영 비서용 사내 데이터 스냅샷 — 자비스 공용 스냅샷(오늘 일정·실적·고객·출근)에
 * 영업 파이프라인 섹션(리드·소개·접촉)을 얹는다. 브레인이 "리드 몇 건 남았어?",
 * "이번 달 소개 몇 건이야?" 같은 질문에 실제 숫자로 답하는 재료.
 *
 * RLS가 접근 경계 — 직원은 본인 것만, 관리자는 전체가 조회된다. 실패한 섹션은
 * 조용히 생략 (스냅샷은 보조 정보이며 대화를 막지 않는다).
 */

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return await Promise.race([p.catch(() => null), new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms))])
}

/** 리드(DB 배정) 섹션 — 미콜·24h 초과·오늘 셀프퍼널 유입. */
async function leadsSection(admin: boolean): Promise<string | null> {
  const res = await withTimeout(admin ? listAllLeads() : listMyLeads(), 3000)
  if (!res || !res.ok) return null
  const leads = res.leads
  if (leads.length === 0) return null
  const open = leads.filter((l) => l.status === 'new')
  const overdue = open.filter(isOverdue)
  const todayIso = new Date().toISOString().slice(0, 10)
  const funnelToday = leads.filter((l) => l.source?.includes('셀프퍼널') && l.createdAt.startsWith(todayIso))
  const scope = admin ? '전체' : '내'
  return `${scope} 리드(DB 배정): 미콜 ${open.length}건${overdue.length > 0 ? ` (24시간 초과 ${overdue.length}건 ⚠)` : ''} · 오늘 셀프퍼널 유입 ${funnelToday.length}건`
}

/** 소개 파이프라인 섹션. */
async function referralSection(admin: boolean, staffId: string): Promise<string | null> {
  const res = await withTimeout(listReferrals(), 3000)
  if (!res || !res.ok) return null
  const rows = admin || res.mode !== 'supabase' ? res.referrals : res.referrals.filter((r) => r.fcId === staffId)
  if (rows.length === 0) return null
  const f = referralFunnel(rows)
  const m = monthlyCounts(rows)
  const scope = admin ? '전체' : '내'
  return `${scope} 소개 파이프라인: 요청 ${f.asked} · 소개받음 ${f.received} · 상담 ${f.consulted} · 계약 ${f.contracted}${
    f.conversionPct !== null ? ` (전환율 ${f.conversionPct}%)` : ''
  } · 이번 달 소개 ${m.received}건/계약 ${m.contracted}건`
}

/** 오늘 접촉 활동 섹션. */
async function contactSection(staffId: string): Promise<string | null> {
  const res = await withTimeout(listContactLogs(), 3000)
  if (!res || !res.ok) return null
  const todayIso = new Date().toISOString().slice(0, 10)
  const mineToday = res.logs.filter((l) => l.fcId === staffId && l.contactedAt.startsWith(todayIso))
  const allToday = res.logs.filter((l) => l.contactedAt.startsWith(todayIso))
  if (allToday.length === 0 && mineToday.length === 0) return null
  return `오늘 고객 접촉 기록: 내 ${mineToday.length}건 · 전체 ${allToday.length}건 (오늘의 접촉 화면에서 관리)`
}

/** 경영 비서 스냅샷 — 공용 스냅샷 + 영업 파이프라인. 전체 4000자 예산. */
export async function buildAssistantContext(admin: boolean, staffId: string): Promise<string> {
  try {
    const [base, extra] = await Promise.all([
      buildJarvisContext(),
      withTimeout(Promise.all([leadsSection(admin), referralSection(admin, staffId), contactSection(staffId)]), 4000)
    ])
    const extraBody = (extra ?? []).filter((s): s is string => Boolean(s)).join('\n')
    if (!extraBody) return base
    if (!base) return `[사내 데이터 스냅샷]\n${extraBody}`.slice(0, 4000)
    return `${base}\n${extraBody}`.slice(0, 4000)
  } catch {
    return ''
  }
}
