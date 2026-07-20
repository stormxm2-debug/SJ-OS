import { getSupabaseClient, initSupabaseClient } from './supabaseClient'

/**
 * 앱 설치·배포 — 웹 링크/초대 문안/PC 설치파일 링크.
 *
 * 웹 주소는 배포 origin에서 자동 파악(일렉트론·데모에서는 운영 주소 폴백).
 * PC 설치파일 링크는 app_settings(key-value, 관리자 쓰기 RLS)에 저장 —
 * 테이블 미적용(42P01)이면 configured=false로 "설정 전" 처리 (SQL 인계).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 운영 웹 주소 — https 배포 화면에서는 그 origin, 그 외(일렉트론/로컬)는 운영 폴백. */
export const PRODUCTION_WEB_URL = 'https://sj-invest.pages.dev'

export function webAppUrl(): string {
  try {
    const o = window.location.origin
    if (o.startsWith('https://') && !o.includes('localhost') && !o.includes('127.0.0.1')) return o
  } catch {
    /* ignore */
  }
  return PRODUCTION_WEB_URL
}

/** 직원 초대 문안 — 카톡에 그대로 보낼 수 있는 형태. */
export function buildInviteText(url: string): string {
  return [
    '[SJ INVEST] 업무앱 안내',
    '',
    `아래 링크를 열어 로그인하세요.`,
    url,
    '',
    '📱 폰: 링크 접속 후 브라우저 메뉴에서 "홈 화면에 추가"하면 앱처럼 쓸 수 있어요.',
    '💻 PC: 같은 주소를 크롬/엣지에서 열면 됩니다.'
  ].join('\n')
}

export const SETTING_DESKTOP_DOWNLOAD_URL = 'desktop_download_url'

function isMissingSetup(err: any): boolean {
  const code = String(err?.code ?? '')
  const msg = String(err?.message ?? '')
  return code === '42P01' || /relation .* does not exist|could not find the table/i.test(msg)
}

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

/** 설정값 조회 — 전 직원 읽기 가능. 테이블 미적용이면 configured=false. */
export async function getAppSetting(key: string): Promise<{ ok: boolean; value: string | null; configured: boolean }> {
  const client = await getClient()
  if (!client) return { ok: false, value: null, configured: false }
  try {
    const { data, error } = await client.from('app_settings').select('value').eq('key', key).maybeSingle()
    if (error) return { ok: false, value: null, configured: !isMissingSetup(error) }
    return { ok: true, value: (data?.value as string | null) ?? null, configured: true }
  } catch {
    return { ok: false, value: null, configured: true }
  }
}

/** 설정값 저장 — RLS가 관리자만 허용. */
export async function setAppSetting(key: string, value: string): Promise<{ ok: boolean; error?: string; configured?: boolean }> {
  const client = await getClient()
  if (!client) return { ok: false, error: '서버 연결 후 사용할 수 있습니다.' }
  try {
    const { data: u } = await client.auth.getUser()
    const uid = u?.user?.id ?? null
    const { error } = await client
      .from('app_settings')
      .upsert({ key, value: value.trim() || null, updated_by: uid, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) {
      if (isMissingSetup(error)) return { ok: false, configured: false, error: '설정 저장소 준비 전입니다 (APP_SETTINGS SQL 적용 필요).' }
      return { ok: false, error: error.message ?? '저장에 실패했습니다.' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: '저장 중 오류가 발생했습니다.' }
  }
}
