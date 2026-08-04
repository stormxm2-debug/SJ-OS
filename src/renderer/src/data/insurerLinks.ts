/**
 * 보험사 설계사(FC/GA) 전산 포털 바로가기 목록 — 상단 [보험사] 드롭다운 데이터.
 *
 * 2026-08-04 조사·검증: 전부 각 보험사 공식 도메인이며 HTTP 200 확인.
 * (롯데·NH농협은 해외 IP 차단이라 국내망에서만 열림 — 실사용엔 문제 없음)
 * 회사 목록은 registrationService의 INSURERS 12개사 기준.
 */

export type InsurerGroup = '손해보험' | '생명보험'

export const INSURER_GROUPS: InsurerGroup[] = ['손해보험', '생명보험']

export interface InsurerLink {
  name: string
  /** 포털 이름 (드롭다운 부제로 표시) */
  portal: string
  url: string
  group: InsurerGroup
}

export const INSURER_LINKS: InsurerLink[] = [
  // 손해보험
  { name: '삼성화재', portal: 'Dream Portal (영업포탈)', url: 'https://erp.samsungfire.com/login.html', group: '손해보험' },
  { name: '현대해상', portal: '영업포탈 (Hi Portal)', url: 'https://sp.hi.co.kr', group: '손해보험' },
  { name: 'DB손해보험', portal: '영업포탈 통합로그인', url: 'https://www.mdbins.com/', group: '손해보험' },
  { name: 'KB손해보험', portal: 'KB스마트비서 GA전용', url: 'https://sales.kbinsure.co.kr/', group: '손해보험' },
  { name: '메리츠화재', portal: '영업포탈', url: 'https://sales.meritzfire.com/', group: '손해보험' },
  { name: '흥국화재', portal: '영업포털', url: 'https://sales.heungkukfire.co.kr/', group: '손해보험' },
  { name: '롯데손해보험', portal: '영업지원 (let NGS)', url: 'https://lottero.lotteins.co.kr/ncrmwebroot/webfw/html/nawlogon.jsp', group: '손해보험' },
  { name: 'NH농협손해보험', portal: 'SFA 영업지원시스템', url: 'https://ss.nhfire.co.kr/', group: '손해보험' },
  // 생명보험
  { name: '삼성생명', portal: 'GA영업포탈', url: 'https://ga.samsunglife.com/', group: '생명보험' },
  { name: '한화생명', portal: 'FP월드 GA', url: 'https://hmp.hanwhalife.com/online/ga', group: '생명보험' },
  { name: '교보생명', portal: 'GA영업포탈', url: 'https://ga.kyobo.com/', group: '생명보험' },
  { name: '라이나생명', portal: 'GA업무지원시스템', url: 'https://ga.lina.co.kr/', group: '생명보험' }
]
