import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * 고객/상담/일정 삭제 — RLS가 "본인 것 + 관리자 전부"를 강제한다
 * (customers_delete_own / consultations_delete_own / schedule_delete_own).
 * 권한 밖 행은 0건 삭제로 끝나므로, 삭제된 행 수를 확인해 명확한 메시지를 돌려준다.
 *
 * 참고: 고객 삭제 시 DB FK에 따라 상담기록·고객등록요청·청구분석은 함께 삭제(CASCADE)되고
 * 일정의 고객 연결은 끊긴다(SET NULL) — 호출부 확인창에서 반드시 고지할 것.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

async function deleteRow(table: string, id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as any
    if (!client) return { ok: false, error: '서버 연결 후 삭제할 수 있습니다.' }
    const { data, error } = await client.from(table).delete().eq('id', id).select('id')
    if (error) return { ok: false, error: error.message }
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, error: '삭제 권한이 없습니다 (본인 데이터 또는 관리자만 삭제 가능).' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: '삭제 중 오류가 발생했습니다.' }
  }
}

export function deleteCustomerRecord(id: string): Promise<{ ok: boolean; error?: string }> {
  return deleteRow('customers', id)
}

/** 여러 고객 한 번에 삭제 — RLS 밖 행은 건너뛰고 실제 삭제 건수를 돌려준다. */
export async function deleteCustomerRecords(
  ids: string[]
): Promise<{ ok: boolean; deleted: number; error?: string }> {
  if (ids.length === 0) return { ok: true, deleted: 0 }
  try {
    await initSupabaseClient()
    const client = getSupabaseClient() as any
    if (!client) return { ok: false, deleted: 0, error: '서버 연결 후 삭제할 수 있습니다.' }
    let deleted = 0
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { data, error } = await client.from('customers').delete().in('id', chunk).select('id')
      if (error) return { ok: false, deleted, error: error.message }
      deleted += Array.isArray(data) ? data.length : 0
    }
    if (deleted < ids.length) {
      return { ok: false, deleted, error: `${ids.length - deleted}명은 삭제 권한이 없어 건너뛰었습니다.` }
    }
    return { ok: true, deleted }
  } catch {
    return { ok: false, deleted: 0, error: '삭제 중 오류가 발생했습니다.' }
  }
}

export function deleteConsultationRecord(id: string): Promise<{ ok: boolean; error?: string }> {
  return deleteRow('consultations', id)
}

export function deleteScheduleRecord(id: string): Promise<{ ok: boolean; error?: string }> {
  return deleteRow('schedule_events', id)
}
