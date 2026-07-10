/**
 * 자동 로그인 자격증명 저장 (기기별 localStorage) — 대표 승인 "완전 자동 로그인".
 *
 * ⚠️ 보안 주의: 휴대폰 번호 + 비밀번호를 이 기기에 저장한다. 이 기기에 접근하는
 * 사람은 누구나 자동 로그인된다 — 대표님 개인 기기에서만 쓰고, 공용 PC에서는
 * 사용하지 말 것. 로그아웃하면 즉시 삭제된다(무한 재로그인 방지). base64는 암호화가
 * 아니라 devtools에서 눈에 덜 띄게 하는 경량 난독화일 뿐이다.
 */

const KEY = 'sj-os:auto-login:v1'

export interface AutoLoginCreds {
  phone: string
  password: string
}

/** unicode-safe base64 (비밀번호에 한글·기호가 있어도 안전). */
function encode(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
}
function decode(s: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)))
}

export function getAutoLogin(): AutoLoginCreds | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const o = JSON.parse(decode(raw)) as Partial<AutoLoginCreds>
    if (o && typeof o.phone === 'string' && typeof o.password === 'string' && o.phone && o.password) {
      return { phone: o.phone, password: o.password }
    }
    return null
  } catch {
    return null
  }
}

export function setAutoLogin(creds: AutoLoginCreds): void {
  try {
    localStorage.setItem(KEY, encode(JSON.stringify(creds)))
  } catch {
    /* storage 불가(사파리 프라이빗 등)여도 앱은 계속 동작 */
  }
}

export function clearAutoLogin(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function hasAutoLogin(): boolean {
  return getAutoLogin() !== null
}
