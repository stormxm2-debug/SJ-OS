import { getSupabaseClient, initSupabaseClient, getSupabaseConfigStatus } from './supabaseClient'
import type { Category, ContactsData, CompanyContacts } from './managerContacts'

/**
 * 매니저 연락처 Supabase 어댑터 — public.company_contacts (팀 공유).
 *
 * 보안: anon 공개 클라이언트만 사용(service_role 사용 안 함). 실제 접근 제어는 RLS —
 * 전 직원 읽기 가능, 쓰기(업로드/삭제)는 owner·admin 만 가능(replace_company_contacts 는
 * SECURITY INVOKER 라 호출자 권한/RLS 가 그대로 적용됨). 전화번호는 로깅하지 않는다.
 *
 * 저장 모델(플랫): 한 사람 = 한 행. title 로 설계매니저/부지점장/지점장 구분,
 * category 로 손보/생보 구분. 화면의 보험사 단위 그룹 뷰는 조회 시 재구성한다.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FlatRow {
  category: Category
  insurer: string
  manager_name: string
  title: string
  phone: string
  sort_order: number
}

async function getClient(): Promise<any | null> {
  await initSupabaseClient()
  return (getSupabaseClient() as any) ?? null
}

export function managerContactsRemoteEnabled(): boolean {
  return getSupabaseConfigStatus().isConfigured
}

/** ContactsData(그룹 뷰) → 플랫 행 배열. sort_order 로 표시 순서를 보존한다. */
export function flatten(data: ContactsData): FlatRow[] {
  const rows: FlatRow[] = []
  let so = 0
  const push = (category: Category, insurer: string, name: string, title: string, phone: string): void => {
    if (!name) return
    rows.push({ category, insurer, manager_name: name, title, phone: phone || '', sort_order: so++ })
  }
  for (const cat of ['sonbo', 'saengbo'] as Category[]) {
    for (const co of data[cat]) {
      for (const m of co.managers) push(cat, co.company, m.name, '설계매니저', m.phone)
      push(cat, co.company, co.vice, '부지점장', co.vicePhone)
      push(cat, co.company, co.head, '지점장', co.headPhone)
    }
  }
  return rows
}

/** 플랫 행(정렬됨) → 보험사 단위 그룹 뷰. */
function group(rows: FlatRow[]): ContactsData {
  const out: ContactsData = { sonbo: [], saengbo: [] }
  const index: Record<string, CompanyContacts> = {}
  for (const r of rows) {
    const cat: Category = r.category === 'saengbo' ? 'saengbo' : 'sonbo'
    const key = `${cat}|${r.insurer}`
    let co = index[key]
    if (!co) {
      co = {
        no: String(out[cat].length + 1),
        company: r.insurer,
        vice: '',
        vicePhone: '',
        head: '',
        headPhone: '',
        managers: []
      }
      index[key] = co
      out[cat].push(co)
    }
    if (r.title === '부지점장') {
      if (!co.vice) {
        co.vice = r.manager_name
        co.vicePhone = r.phone
      }
    } else if (r.title === '지점장') {
      if (!co.head) {
        co.head = r.manager_name
        co.headPhone = r.phone
      }
    } else {
      co.managers.push({ name: r.manager_name, phone: r.phone })
    }
  }
  return out
}

/** 팀 공유 목록을 불러온다. */
export async function remoteList(): Promise<ContactsData> {
  const client = await getClient()
  if (!client) throw new Error('Supabase 설정이 없습니다.')
  const { data, error } = await client
    .from('company_contacts')
    .select('category, insurer, manager_name, title, phone, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw new Error('매니저 연락처를 불러오지 못했습니다.')
  return group((data ?? []) as FlatRow[])
}

/** 팀 공유 목록 전체를 원자적으로 교체한다(owner·admin 만 성공). */
export async function remoteReplaceAll(data: ContactsData): Promise<void> {
  const client = await getClient()
  if (!client) throw new Error('Supabase 설정이 없습니다.')
  const rows = flatten(data)
  const { error } = await client.rpc('replace_company_contacts', { p_rows: rows })
  if (error) {
    // RLS 위반(권한 없음) 등
    const msg = /row-level security|permission|policy/i.test(error.message ?? '')
      ? '수정 권한이 없습니다. 관리자(대표/관리자)만 목록을 변경할 수 있습니다.'
      : '저장에 실패했습니다. 잠시 후 다시 시도해 주세요.'
    throw new Error(msg)
  }
}

/** 다른 사용자의 변경을 실시간으로 감지한다. 반환값은 구독 해제 함수. */
export function remoteSubscribe(onChange: () => void): () => void {
  const client = getSupabaseClient() as any
  if (!client?.channel) return () => {}
  const channel = client
    .channel('manager-contacts-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'company_contacts' }, () => onChange())
    .subscribe()
  return () => {
    try {
      client.removeChannel(channel)
    } catch {
      /* ignore */
    }
  }
}
