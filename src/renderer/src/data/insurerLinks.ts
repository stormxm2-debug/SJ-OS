/**
 * 보험사 설계사(FC/GA) 전산 포털 + 고객센터 목록 — 상단 [보험사] 드롭다운 데이터.
 *
 * 2026-08-04 출처: 설계사닷컴(설계사.com) "보험회사 전산" 표 전체 39곳 —
 * 전산 링크(회사 로고에 걸린 URL)와 고객센터 대표번호(고객센터 열)를 추출.
 * 스킴(https)은 자체 검증된 곳만 승격, 나머지는 원본 그대로.
 * 회사 순서도 설계사닷컴 표 순서를 따른다(현장 익숙함 우선).
 *
 * ars: 고객센터 전화 시 나오는 ARS 메뉴 — 각 사 공식 홈페이지 ARS 안내에서
 * 확인된 25곳만 기재(2026-08-04 조사, 추측 금지). 없으면 UI에서 숨김.
 * 메뉴는 공식 안내를 한 줄로 압축한 것 — 세부 하위메뉴는 생략됨.
 */

export type InsurerGroup = '손해보험' | '생명보험' | '공제·우체국'

export const INSURER_GROUPS: InsurerGroup[] = ['손해보험', '생명보험', '공제·우체국']

export interface InsurerLink {
  name: string
  /** 포털 이름 (드롭다운 부제로 표시) */
  portal: string
  url: string
  group: InsurerGroup
  /** 고객센터 대표번호 (모바일 전화 안내용) */
  csPhone: string
  /** ARS 메뉴 한 줄 요약 — 공식 확인된 회사만 */
  ars?: string
}

export const INSURER_LINKS: InsurerLink[] = [
  // 손해보험 (13)
  {
    name: '삼성화재', portal: 'Dream Portal (영업포탈)', url: 'https://erp.samsungfire.com/', group: '손해보험',
    csPhone: '1588-5114',
    ars: '1 차사고접수 · 2 긴급출동 · 3 계약조회·변경·해지 · 4 가입문의 · 5 보험금청구 · 6 대출 · 9 증명서 · 0 상담사'
  },
  {
    name: '메리츠화재', portal: '영업포탈', url: 'https://sales.meritzfire.com/', group: '손해보험',
    csPhone: '1566-7711',
    ars: '1 차사고접수 · 2 긴급출동 · 3 보험료납입 · 4 계약조회·변경·해지 · 5 보험금신청 · 6 계약대출 · 7 증권·증명서 · 8 신규가입 · 0 상담사'
  },
  {
    name: 'DB손해보험', portal: '영업포탈 통합로그인', url: 'https://www.mdbins.com/', group: '손해보험',
    csPhone: '1588-0100',
    ars: '1 긴급출동 · 2 차사고접수 · 3 신규가입 · 4 보험금청구 · 5 장기 상담·해지 · 6 자동차 상담·해지 · 7 대출 · 8 증명서 · 9 납입변경 · 0 상담사'
  },
  {
    name: 'KB손해보험', portal: 'KB스마트비서 GA전용', url: 'https://nsales.kbinsure.co.kr/', group: '손해보험',
    csPhone: '1544-0114',
    ars: '1 차사고접수 · 2 고장출동 · 3 보험금 청구안내 · 4 장기 상담·변경·해지 · 5 대출 · 6 자동차 상담·변경·해지 · 7 정보변경·증명서 · 0 상담사'
  },
  {
    name: '현대해상', portal: '영업포탈 (Hi Portal)', url: 'https://sp.hi.co.kr/', group: '손해보험',
    csPhone: '1588-5656',
    ars: '1 고장출동 · 2 사고접수 · 3 보험금청구 · 4 장기보험관리 · 5 자동차보험관리 · 6 가입상담 · 7 대출·연금·펀드 · 8 증권·증명서 · 0 상담사'
  },
  {
    name: '한화손해보험', portal: '설계사 전산', url: 'http://portal.hwgeneralins.com/', group: '손해보험',
    csPhone: '1566-8000',
    ars: '1 차사고접수 · 2 고장출동 · 3 신규가입 · 4 장기 계약관리 · 5 보험금청구 · 6 자동차 계약관리 · 7 대출 · 8 증권·서류 · 0 상담사'
  },
  { name: '롯데손해보험', portal: '영업지원 (let NGS)', url: 'https://lottero.lotteins.co.kr/', group: '손해보험', csPhone: '1588-3344' },
  {
    name: '흥국화재', portal: '영업포털', url: 'https://sales.heungkukfire.co.kr/', group: '손해보험',
    csPhone: '1688-1688',
    ars: '1 차사고접수 · 2 긴급출동 · 3 신규가입 · 4 보험금청구 · 5 장기 납입·변경·해지 · 6 자동차상담 · 7 대출 · 8 증명서 · 0 상담사'
  },
  {
    name: '하나손해보험', portal: 'SFA 영업지원', url: 'https://sfa.saleshana.com/index.html', group: '손해보험',
    csPhone: '1566-3000',
    ars: '1 고장출동 · 2 차사고접수 · 3 보험가입 · 4 자동차 계약변경 · 5 장기 계약변경·납입 · 6 보험금청구 · 8 계약대출 · 9 증명서 · 0 상담사'
  },
  {
    name: 'NH농협손해보험', portal: 'SFA 영업지원시스템', url: 'https://ss.nhfire.co.kr/', group: '손해보험',
    csPhone: '1644-9000',
    ars: '1 보이는ARS · 2 음성ARS → 1 계약조회·납입 · 2 계약대출 · 3 해지·환급금 · 4 사고접수·보장상담 · 0 상담사'
  },
  { name: '라이나손해보험', portal: 'GA 전산', url: 'https://ga.linagi.com/', group: '손해보험', csPhone: '1566-5800' },
  { name: 'AIG손해보험', portal: 'GA 로그인', url: 'https://sso.aig.co.kr/gaLogin/gaLogin.jsp', group: '손해보험', csPhone: '1544-2792' },
  {
    name: '예별손해보험', portal: 'MGA넷 (구 MG손보)', url: 'https://mganet.mggeneralins.com/', group: '손해보험',
    csPhone: '1588-5959',
    ars: '1 긴급출동 · 2 차사고접수 · 3 납입·계약문의 · 4 보험금청구 · 5 자동차 조회·변경·해지 · 6 계약대출 · 7 증명서 셀프발급'
  },
  // 생명보험 (21)
  {
    name: '한화생명', portal: 'FP월드 GA', url: 'https://hmp.hanwhalife.com/online/ga', group: '생명보험',
    csPhone: '1588-6363',
    ars: '0 상담사 · 1 계약대출 · 2 보험금·해지 · 3 보험료납입 · 4 부동산·신용대출 · 6 변액 · 7 증명서 · 8 사고보험금'
  },
  {
    name: '동양생명', portal: '설계사 전산', url: 'http://1004.myangel.co.kr/', group: '생명보험',
    csPhone: '1577-1004',
    ars: '1 간편계약대출 · 2 보험료입금·이체 · 3 증명서·서류 · 4 창구위치 · 5 보안·피싱신고 · 0 상담원'
  },
  {
    name: '교보생명', portal: 'GA영업포탈', url: 'https://ga.kyobo.com/', group: '생명보험',
    csPhone: '1588-1001',
    ars: '1 계약대출 · 2 보험금청구·해지환급 · 3 보험료납입 · 4 증명서·비밀번호 · 0 상담사(1 대출·2 사고보험금·3 변액·4 일반)'
  },
  {
    name: '삼성생명', portal: 'GA영업포탈', url: 'https://ga.samsunglife.com/', group: '생명보험',
    csPhone: '1588-3114',
    ars: '0 상담사연결(2 납입·3 대출·4 사고보험금·5 일반문의·6 변액) · 1 ARS 셀프처리 · 2 AI 음성봇'
  },
  { name: '라이나생명', portal: 'GA업무지원시스템', url: 'https://ga.lina.co.kr/', group: '생명보험', csPhone: '1588-0058' },
  { name: 'KDB생명', portal: '설계사 전산', url: 'http://kss.kdblife.co.kr/', group: '생명보험', csPhone: '1588-4040' },
  {
    name: 'iM라이프', portal: '설계사 전산', url: 'https://fgs.dgbfnlife.com:8443/', group: '생명보험',
    csPhone: '1588-4770',
    ars: '1 ARS 자동화 · 2 사고보험금 · 3 상담사 업무 · 4 고령자 간편상담 · 5 변액 · 6 해약'
  },
  {
    name: '미래에셋생명', portal: '설계사 전산', url: 'http://www.loveageplan.com/', group: '생명보험',
    csPhone: '1588-0220',
    ars: '1 사고보험금 접수 · 2 가상계좌 발급 · 3 빠른조회·지급 · 4 변액상담 · 5 장애인·고령 상담 · 0 상담원'
  },
  {
    name: '신한라이프', portal: 'GA 전산', url: 'https://ga.shinhanlife.co.kr/', group: '생명보험',
    csPhone: '1588-5580',
    ars: '1 계약대출 · 2 보험료납입 · 3 휴면·만기보험금 · 4 사고보험금 · 5 증명서 · 7 변액·연금 · 0 상담사'
  },
  {
    name: 'KB라이프', portal: 'SFA 영업지원', url: 'https://sfa.kblife.co.kr/', group: '생명보험',
    csPhone: '1588-3374',
    ars: '1 거래고객 · 2 65세 이상 · 3 변액상담 · 4 은행·영업직원 · 5 기타 → 상담사연결'
  },
  {
    name: 'DB생명', portal: '이토피아 전산', url: 'http://etopia.idblife.com/', group: '생명보험',
    csPhone: '1588-3131',
    ars: '1 계약대출 · 2 사고보험금 · 3 계약확인 · 4 보험료납입 · 5 변액상담 · 6 증권·증명서 · 0 상담사'
  },
  {
    name: '하나생명', portal: 'GA 전산', url: 'https://ga.hanalife.co.kr/', group: '생명보험',
    csPhone: '1577-1112',
    ars: '1 계약대출 · 2 변액 조회·상담 · 3 해지환급금 · 4 보험금청구 · 5 계약관리 · 6 증권·증명서 · 8 납입·가상계좌 · 0 상담사'
  },
  {
    name: '흥국생명', portal: '영업포털', url: 'https://sales.heungkuklife.co.kr/', group: '생명보험',
    csPhone: '1588-2288',
    ars: '0 상담사(1 대출·3 사고보험금·6 변액) · 1 피싱신고·지급중지 · 2 ARS 조회·처리'
  },
  { name: 'ABL생명', portal: 'GA 전산', url: 'http://ga.abllife.co.kr/', group: '생명보험', csPhone: '1588-6500' },
  { name: 'IBK연금보험', portal: '설계사 전산', url: 'https://sf.ibki.co.kr/', group: '생명보험', csPhone: '1577-4117' },
  { name: 'NH농협생명', portal: 'SFA 영업지원', url: 'https://sfa.nhlife.co.kr:8443/', group: '생명보험', csPhone: '1544-4000' },
  { name: '메트라이프', portal: 'MetPlus', url: 'http://metplus.metlife.co.kr/', group: '생명보험', csPhone: '1588-9600' },
  {
    name: '처브라이프', portal: 'e-Smart 전산', url: 'http://esmart.chubblife.co.kr/', group: '생명보험',
    csPhone: '1599-4600',
    ars: '1 자동조회(환급금·대출·납입·지급내역) · 2 보험금청구 문의 · 0 상담사'
  },
  { name: '푸본현대생명', portal: '설계사 전산', url: 'https://ez.fubonhyundai.com/', group: '생명보험', csPhone: '1577-3311' },
  {
    name: 'BNP파리바카디프', portal: 'GA 전산', url: 'http://ga.cardif.co.kr/', group: '생명보험',
    csPhone: '1688-1118',
    ars: '1 거래고객 · 2 65세 이상 · 3 변액상담 · 0 비고객'
  },
  {
    name: 'AIA생명', portal: 'iMAP 전산', url: 'https://imap.aia.co.kr/', group: '생명보험',
    csPhone: '1588-9898',
    ars: '1 납입·이체·가상계좌 · 2 계약확인 · 3 중도인출·휴면보험금 · 4 계약대출 · 5 보험금청구·보장 · 6 변액·펀드 · 9 소득공제증명서'
  },
  // 공제·우체국 (5)
  { name: 'MG새마을금고 공제', portal: '공제보험', url: 'https://insure.kfcc.co.kr/', group: '공제·우체국', csPhone: '1599-9010' },
  { name: '더케이 (교직원공제)', portal: '공제 홈페이지', url: 'https://www.ktcu.or.kr/MH/MH-P010M01.do', group: '공제·우체국', csPhone: '1577-3993' },
  {
    name: '우체국보험', portal: '우체국 보험', url: 'https://epostlife.go.kr/LNLNDM10DM.do', group: '공제·우체국',
    csPhone: '1599-0100',
    ars: '조회 #1~#8 · 보험금신청 11~14 · 2 사고보험금 · 대출 31~33 · 납입·이체 41~45 · 상담사 10/30/40'
  },
  { name: '수협공제', portal: '수협은행', url: 'https://www.suhyup-bank.com/', group: '공제·우체국', csPhone: '1588-4119' },
  { name: '신협공제', portal: '신협 공제', url: 'https://openbank.cu.co.kr/?sub=6000', group: '공제·우체국', csPhone: '1544-3030' }
]
