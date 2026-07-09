import type { CompanyContact } from './companyContactsService'

/**
 * vCard(.vcf) 생성/저장 유틸.
 *
 * 웹앱은 보안상 폰 주소록에 직접 쓸 수 없다(모든 브라우저 공통). 표준 해법은
 * vCard 파일: 버튼 1탭 → OS 연락처 앱이 열리고 → "저장" 1탭이면 끝. 여러 연락처를
 * 파일 하나에 담으면 "전체 저장"도 1번에 된다.
 *
 * 저장 경로 선택:
 * - 카카오톡 등 인앱브라우저는 blob 다운로드를 자주 막는다 → Web Share API(파일
 *   공유)가 되면 공유시트로 우회(연락처/파일 앱 선택 가능).
 * - 그 외(사파리/크롬/데스크톱)는 일반 다운로드 — 모바일에서는 받은 .vcf를 탭하면
 *   연락처 추가 화면이 바로 열린다.
 */

/** 폰에 저장될 연락처 표시 이름 — 발신 시 "삼성화재 홍길동 매니저"로 뜬다. */
export function contactDisplayName(c: Pick<CompanyContact, 'insurer' | 'managerName' | 'title'>): string {
  return [c.insurer, c.managerName, c.title].filter(Boolean).join(' ')
}

/** vCard 텍스트 값 이스케이프 (백슬래시/줄바꿈/콤마/세미콜론). */
function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function vcardOf(c: CompanyContact): string {
  const name = contactDisplayName(c)
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:;${esc(name)};;;`,
    `FN:${esc(name)}`,
    `ORG:${esc(c.insurer)}`,
    `TITLE:${esc(c.title)}`,
    `TEL;TYPE=CELL,VOICE:${esc(c.phone)}`
  ]
  if (c.officePhone) lines.push(`TEL;TYPE=WORK,VOICE:${esc(c.officePhone)}`)
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(c.email)}`)
  lines.push(`NOTE:${esc([c.memo, 'SJ INVEST 매니저 연락처부'].filter(Boolean).join(' — '))}`)
  if (c.updatedAt) lines.push(`REV:${c.updatedAt}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

/** 여러 연락처를 .vcf 파일 하나로 (전체 저장용). */
export function buildVcf(contacts: CompanyContact[]): string {
  return contacts.map(vcardOf).join('\r\n') + '\r\n'
}

const isInAppBrowser = (): boolean =>
  /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent)

export interface SaveVcfResult {
  ok: boolean
  /** 사용자가 공유시트를 스스로 닫은 경우 (오류 아님 — 조용히 무시) */
  cancelled?: boolean
  error?: string
}

/** vCard를 폰으로 전달 — 인앱브라우저는 공유시트, 그 외는 파일 다운로드. */
export async function saveVcfToPhone(contacts: CompanyContact[], filename: string): Promise<SaveVcfResult> {
  if (contacts.length === 0) return { ok: false, error: '저장할 연락처가 없습니다.' }
  const vcf = buildVcf(contacts)
  const file = new File([vcf], filename, { type: 'text/vcard' })

  const canShareFile =
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })

  // 인앱브라우저: 다운로드가 막히는 경우가 많아 공유시트를 우선한다.
  if (isInAppBrowser() && canShareFile) {
    try {
      await navigator.share({ files: [file], title: '매니저 연락처' })
      return { ok: true }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return { ok: false, cancelled: true }
      // 공유 실패 시 다운로드로 폴백
    }
  }

  try {
    const url = URL.createObjectURL(new Blob([vcf], { type: 'text/vcard;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    return { ok: true }
  } catch {
    // 다운로드까지 막힌 환경(일부 인앱브라우저) — 마지막으로 공유시트 시도
    if (canShareFile) {
      try {
        await navigator.share({ files: [file], title: '매니저 연락처' })
        return { ok: true }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return { ok: false, cancelled: true }
      }
    }
    return { ok: false, error: '이 브라우저에서는 저장이 막혀 있습니다. 크롬/사파리에서 열어주세요.' }
  }
}
