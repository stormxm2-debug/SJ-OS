/**
 * 보험사 설계사(FC/GA) 전산 포털 바로가기 목록 — 상단 [보험사] 드롭다운 데이터.
 *
 * 2026-08-04 출처: 설계사닷컴(설계사.com) "보험회사 전산" 표 전체 39곳 —
 * 각 행의 회사 로고가 걸어둔 전산 링크를 그대로 추출(대표 지시).
 * 스킴(https)은 자체 검증된 곳만 승격, 나머지는 원본 그대로.
 * 회사 순서도 설계사닷컴 표 순서를 따른다(현장 익숙함 우선).
 */

export type InsurerGroup = '손해보험' | '생명보험' | '공제·우체국'

export const INSURER_GROUPS: InsurerGroup[] = ['손해보험', '생명보험', '공제·우체국']

export interface InsurerLink {
  name: string
  /** 포털 이름 (드롭다운 부제로 표시) */
  portal: string
  url: string
  group: InsurerGroup
}

export const INSURER_LINKS: InsurerLink[] = [
  // 손해보험 (13)
  { name: '삼성화재', portal: 'Dream Portal (영업포탈)', url: 'https://erp.samsungfire.com/', group: '손해보험' },
  { name: '메리츠화재', portal: '영업포탈', url: 'https://sales.meritzfire.com/', group: '손해보험' },
  { name: 'DB손해보험', portal: '영업포탈 통합로그인', url: 'https://www.mdbins.com/', group: '손해보험' },
  { name: 'KB손해보험', portal: 'KB스마트비서 GA전용', url: 'https://nsales.kbinsure.co.kr/', group: '손해보험' },
  { name: '현대해상', portal: '영업포탈 (Hi Portal)', url: 'https://sp.hi.co.kr/', group: '손해보험' },
  { name: '한화손해보험', portal: '설계사 전산', url: 'http://portal.hwgeneralins.com/', group: '손해보험' },
  { name: '롯데손해보험', portal: '영업지원 (let NGS)', url: 'https://lottero.lotteins.co.kr/', group: '손해보험' },
  { name: '흥국화재', portal: '영업포털', url: 'https://sales.heungkukfire.co.kr/', group: '손해보험' },
  { name: '하나손해보험', portal: 'SFA 영업지원', url: 'https://sfa.saleshana.com/index.html', group: '손해보험' },
  { name: 'NH농협손해보험', portal: 'SFA 영업지원시스템', url: 'https://ss.nhfire.co.kr/', group: '손해보험' },
  { name: '라이나손해보험', portal: 'GA 전산', url: 'https://ga.linagi.com/', group: '손해보험' },
  { name: 'AIG손해보험', portal: 'GA 로그인', url: 'https://sso.aig.co.kr/gaLogin/gaLogin.jsp', group: '손해보험' },
  { name: '예별손해보험', portal: 'MGA넷 (구 MG손보)', url: 'https://mganet.mggeneralins.com/', group: '손해보험' },
  // 생명보험 (21)
  { name: '한화생명', portal: 'FP월드 GA', url: 'https://hmp.hanwhalife.com/online/ga', group: '생명보험' },
  { name: '동양생명', portal: '설계사 전산', url: 'http://1004.myangel.co.kr/', group: '생명보험' },
  { name: '교보생명', portal: 'GA영업포탈', url: 'https://ga.kyobo.com/', group: '생명보험' },
  { name: '삼성생명', portal: 'GA영업포탈', url: 'https://ga.samsunglife.com/', group: '생명보험' },
  { name: '라이나생명', portal: 'GA업무지원시스템', url: 'https://ga.lina.co.kr/', group: '생명보험' },
  { name: 'KDB생명', portal: '설계사 전산', url: 'http://kss.kdblife.co.kr/', group: '생명보험' },
  { name: 'iM라이프', portal: '설계사 전산', url: 'https://fgs.dgbfnlife.com:8443/', group: '생명보험' },
  { name: '미래에셋생명', portal: '설계사 전산', url: 'http://www.loveageplan.com/', group: '생명보험' },
  { name: '신한라이프', portal: 'GA 전산', url: 'https://ga.shinhanlife.co.kr/', group: '생명보험' },
  { name: 'KB라이프', portal: 'SFA 영업지원', url: 'https://sfa.kblife.co.kr/', group: '생명보험' },
  { name: 'DB생명', portal: '이토피아 전산', url: 'http://etopia.idblife.com/', group: '생명보험' },
  { name: '하나생명', portal: 'GA 전산', url: 'https://ga.hanalife.co.kr/', group: '생명보험' },
  { name: '흥국생명', portal: '영업포털', url: 'https://sales.heungkuklife.co.kr/', group: '생명보험' },
  { name: 'ABL생명', portal: 'GA 전산', url: 'http://ga.abllife.co.kr/', group: '생명보험' },
  { name: 'IBK연금보험', portal: '설계사 전산', url: 'https://sf.ibki.co.kr/', group: '생명보험' },
  { name: 'NH농협생명', portal: 'SFA 영업지원', url: 'https://sfa.nhlife.co.kr:8443/', group: '생명보험' },
  { name: '메트라이프', portal: 'MetPlus', url: 'http://metplus.metlife.co.kr/', group: '생명보험' },
  { name: '처브라이프', portal: 'e-Smart 전산', url: 'http://esmart.chubblife.co.kr/', group: '생명보험' },
  { name: '푸본현대생명', portal: '설계사 전산', url: 'https://ez.fubonhyundai.com/', group: '생명보험' },
  { name: 'BNP파리바카디프', portal: 'GA 전산', url: 'http://ga.cardif.co.kr/', group: '생명보험' },
  { name: 'AIA생명', portal: 'iMAP 전산', url: 'https://imap.aia.co.kr/', group: '생명보험' },
  // 공제·우체국 (5)
  { name: 'MG새마을금고 공제', portal: '공제보험', url: 'https://insure.kfcc.co.kr/', group: '공제·우체국' },
  { name: '더케이 (교직원공제)', portal: '공제 홈페이지', url: 'https://www.ktcu.or.kr/MH/MH-P010M01.do', group: '공제·우체국' },
  { name: '우체국보험', portal: '우체국 보험', url: 'https://epostlife.go.kr/LNLNDM10DM.do', group: '공제·우체국' },
  { name: '수협공제', portal: '수협은행', url: 'https://www.suhyup-bank.com/', group: '공제·우체국' },
  { name: '신협공제', portal: '신협 공제', url: 'https://openbank.cu.co.kr/?sub=6000', group: '공제·우체국' }
]
