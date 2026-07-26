import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * 본인 비밀번호 변경.
 *
 * 배경(2026-07-21 보안 감사): 초기 온보딩 때 전 직원에게 `sjos`+휴대폰 뒤 4자리 형태의
 * 임시 비밀번호가 지급됐는데, 아이디(전화번호)와 비밀번호가 같은 값에서 나와서 번호만
 * 알면 로그인이 가능한 상태였다. 게다가 앱에 비밀번호를 바꿀 화면 자체가 없었다.
 *
 * 이 모듈이 그 공백을 메운다. Supabase Auth의 updateUser로 실제 비밀번호를 바꾸고,
 * profiles.password_rotated_at에 변경 시각을 남겨 "아직 초기 비밀번호를 쓰는 사람"을
 * 식별할 수 있게 한다(관리자 독촉/게이트 노출 판단용 — 비밀번호 자체는 저장하지 않는다).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

/** 비밀번호 규칙 — 서버(claim-phone-account)와 동일 기준 + 초기 비밀번호 패턴 거부. */
export function passwordError(pw: string, phone?: string): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return '비밀번호는 8자 이상이어야 합니다.'
  if (pw.length > 72) return '비밀번호는 72자 이하여야 합니다.'
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '영문과 숫자를 함께 넣어주세요.'
  const digits = (phone ?? '').replace(/\D/g, '')
  const last4 = digits.slice(-4)
  if (last4 && pw.toLowerCase() === `sjos${last4}`) return '처음 받은 비밀번호는 다시 쓸 수 없습니다.'
  if (last4 && pw.includes(last4) && pw.length <= 10) return '전화번호가 들어간 비밀번호는 쉽게 추측됩니다. 다른 비밀번호를 사용해주세요.'
  return null
}

export interface RotationState {
  /** 서버 조회 성공 여부 (데모/미연결이면 false) */
  configured: boolean
  /** 아직 한 번도 본인이 바꾼 적이 없다 = 초기 지급 비밀번호 사용 중 */
  needsRotation: boolean
  /** 초기 비밀번호 패턴 검사용 본인 번호 */
  phone?: string
}

/** 내 비밀번호 변경 이력 조회 — 게이트를 띄울지 판단한다. */
export async function getRotationState(): Promise<RotationState> {
  const client = await getClient()
  if (!client) return { configured: false, needsRotation: false }
  try {
    const { data: sess } = await client.auth.getSession()
    const uid = sess?.session?.user?.id
    if (!uid) return { configured: false, needsRotation: false }
    const { data, error } = await client.from('profiles').select('password_rotated_at, phone').eq('id', uid).maybeSingle()
    if (error) return { configured: false, needsRotation: false }
    return { configured: true, needsRotation: !data?.password_rotated_at, phone: data?.phone ?? undefined }
  } catch {
    return { configured: false, needsRotation: false }
  }
}

/** 비밀번호 변경 실행. 성공 시 profiles.password_rotated_at 갱신. */
export async function changeMyPassword(newPassword: string, phone?: string): Promise<{ ok: boolean; error?: string }> {
  const invalid = passwordError(newPassword, phone)
  if (invalid) return { ok: false, error: invalid }

  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { data: sess } = await client.auth.getSession()
    const uid = sess?.session?.user?.id
    if (!uid) return { ok: false, error: '로그인 후 사용할 수 있습니다.' }

    const { error } = await client.auth.updateUser({ password: newPassword })
    if (error) return { ok: false, error: error.message || '비밀번호 변경에 실패했습니다.' }

    // 변경 시각 기록 (실패해도 비밀번호 자체는 이미 바뀌었으므로 성공으로 처리)
    try {
      await client.from('profiles').update({ password_rotated_at: new Date().toISOString() }).eq('id', uid)
    } catch {
      /* 기록 실패는 무시 — 게이트가 한 번 더 뜨는 정도의 영향 */
    }
    // 기기에 저장된 자동 로그인 자격증명은 옛 비밀번호라 반드시 지운다.
    try {
      window.localStorage.removeItem('sj-os:auto-login:v1')
    } catch {
      /* ignore */
    }
    return { ok: true }
  } catch {
    return { ok: false, error: '비밀번호 변경 중 오류가 발생했습니다.' }
  }
}

/* 메뉴에서 변경 창을 여는 store (생일 게이트와 같은 패턴) */
type Listener = () => void
const listeners = new Set<Listener>()

export function openPasswordGate(): void {
  listeners.forEach((fn) => fn())
}

export function subscribePasswordGate(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
