import {
  getFunctionsBaseUrl,
  getSupabaseAnonKey,
  getSupabaseClient,
  initSupabaseClient
} from './supabaseClient'
import type { PolicyExemption } from './exemptionService'

/**
 * 면책 종료(보장 시작) 고객 안내 — exemption-notify edge function 호출 + 무료 공유문.
 *
 * 알림톡(솔라피)이 설정되기 전에는 서버가 ALIMTALK_NOT_CONFIGURED를 반환하고
 * UI는 무료 '카톡 공유' 경로를 안내한다. 전화번호는 클라이언트를 거치지 않는다
 * (exemptionId만 보내면 서버가 고객 연락처를 직접 조회 — 본인 담당/관리자만).
 * 자동 발송은 pg_cron 배치(notify-due)가 수행 — EXEMPTION_NOTIFY SQL 적용 후.
 */

export interface ExemptionNotifyResult {
  ok: boolean
  message: string
  notConfigured?: boolean
}

async function functionsBearer(): Promise<string | undefined> {
  const anon = getSupabaseAnonKey()
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as {
      auth?: { getSession: () => Promise<{ data?: { session?: { access_token?: string } } }> }
    } | null
    const { data } = (await client?.auth?.getSession()) ?? {}
    return data?.session?.access_token ?? anon
  } catch {
    return anon
  }
}

/** 담당 고객에게 보장 시작 알림톡 발송 (본인 담당/관리자만 — 서버가 검증). */
export async function sendExemptionAlimtalk(exemptionId: string): Promise<ExemptionNotifyResult> {
  const base = getFunctionsBaseUrl()
  const anon = getSupabaseAnonKey()
  if (!base || !anon) return { ok: false, message: '서버 연결 후 사용할 수 있습니다.' }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 30000)
  try {
    const token = (await functionsBearer()) ?? anon
    const res = await fetch(`${base}/exemption-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ exemptionId }),
      signal: controller.signal
    })
    const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string; code?: string } | null
    if (res.ok && data?.success) return { ok: true, message: '고객에게 보장 시작 안내를 보냈습니다.' }
    const notConfigured = data?.code === 'ALIMTALK_NOT_CONFIGURED'
    return {
      ok: false,
      notConfigured,
      message: notConfigured
        ? '알림톡 설정 전입니다 — 옆의 [카톡 공유]로 보내주세요.'
        : data?.error || '발송에 실패했습니다. 잠시 후 다시 시도해 주세요.'
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return { ok: false, message: aborted ? '발송 시간 초과. 다시 시도해 주세요.' : '발송 중 오류가 발생했습니다.' }
  } finally {
    window.clearTimeout(timer)
  }
}

/** 무료 공유용 안내문 — 카톡에 그대로 붙여넣을 수 있는 존댓말 문안. */
export function buildExemptionShareText(e: PolicyExemption): string {
  const end = new Date(e.waitingEnd)
  const endLabel = Number.isNaN(end.getTime())
    ? e.waitingEnd
    : `${end.getMonth() + 1}월 ${end.getDate()}일`
  const target = [e.insurer, e.coverage || e.productName].filter(Boolean).join(' ')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  const started = end.getTime() <= today.getTime()
  return [
    `[SJ INVEST] 보장 개시 안내`,
    ``,
    `${e.customerName || '고객'}님, 안녕하세요.`,
    started
      ? `가입하신 ${target}의 면책기간이 끝나 ${endLabel}부터 보장이 시작되었습니다. 🎉`
      : `가입하신 ${target}의 면책기간이 ${endLabel}에 끝나고 보장이 시작될 예정입니다.`,
    `이제 안심하시고, 궁금하신 점은 언제든 편하게 문의 주세요.`
  ].join('\n')
}

/** 안내문 공유 — 모바일은 공유창(카톡 선택), 그 외엔 클립보드 복사. */
export async function shareExemptionText(text: string): Promise<{ ok: boolean; message: string }> {
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ text })
      return { ok: true, message: '공유창을 열었습니다.' }
    }
  } catch {
    /* 사용자가 공유를 취소해도 클립보드 폴백으로 넘어가지 않고 조용히 종료 */
    return { ok: false, message: '공유가 취소되었습니다.' }
  }
  try {
    await navigator.clipboard.writeText(text)
    return { ok: true, message: '안내문을 복사했습니다 — 카톡에 붙여넣어 보내세요.' }
  } catch {
    return { ok: false, message: '복사에 실패했습니다.' }
  }
}
