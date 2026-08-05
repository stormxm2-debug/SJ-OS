/**
 * 보험사 설계사(FC/GA) 전산 포털 + 고객센터 + 상품공시실 — 상단 [보험사] 메뉴 데이터.
 *
 * 2026-08-04 출처: 설계사닷컴(설계사.com) "보험회사 전산" 표 전체 39곳 —
 * 전산 링크(회사 로고), 고객센터 대표번호(고객센터 열), 상품공시실(약관확인 열),
 * 브라우저 호환(크롬/엣지 아이콘 — 회색이면 미지원)까지 그대로 반영.
 * 회사 순서도 설계사닷컴 표 순서를 따른다(현장 익숙함 우선).
 *
 * ars: 고객센터 ARS 메뉴 — 각 사 공식 안내에서 확인된 25곳만(추측 금지).
 * disclosure: 상품공시실 — 신협은 전산과 동일 페이지라 생략.
 * chrome/edge: 전산 사이트가 해당 브라우저를 지원하는지(설계사닷컴 아이콘 기준).
 * color: 브랜드 근사색 — 카드 모노그램/포인트용(정확한 CI 아님).
 */

export type InsurerGroup = '손해보험' | '생명보험' | '공제·우체국'

export const INSURER_GROUPS: InsurerGroup[] = ['손해보험', '생명보험', '공제·우체국']

export interface InsurerLink {
  name: string
  /** 포털 이름 (부제로 표시) */
  portal: string
  url: string
  group: InsurerGroup
  /** 고객센터 대표번호 */
  csPhone: string
  /** 전산이 크롬을 지원하는지 */
  chrome: boolean
  /** 전산이 엣지를 지원하는지 */
  edge: boolean
  /** 브랜드 근사색 (모노그램·포인트용) */
  color: string
  /** ARS 메뉴 한 줄 요약 — 공식 확인된 회사만 */
  ars?: string
  /** 상품공시실(약관·판매상품 공시) 링크 */
  disclosure?: string
}

export const INSURER_LINKS: InsurerLink[] = [
  // 손해보험 (13)
  {
    name: '삼성화재', portal: 'Dream Portal (영업포탈)', url: 'https://erp.samsungfire.com/', group: '손해보험',
    csPhone: '1588-5114', chrome: true, edge: true, color: '#1428A0',
    ars: '1 차사고접수 · 2 긴급출동 · 3 계약조회·변경·해지 · 4 가입문의 · 5 보험금청구 · 6 대출 · 9 증명서 · 0 상담사',
    disclosure: 'https://www.samsungfire.com/page/VH.REIF0011.do'
  },
  {
    name: '메리츠화재', portal: '영업포탈', url: 'https://sales.meritzfire.com/', group: '손해보험',
    csPhone: '1566-7711', chrome: true, edge: true, color: '#E60012',
    ars: '1 차사고접수 · 2 긴급출동 · 3 보험료납입 · 4 계약조회·변경·해지 · 5 보험금신청 · 6 계약대출 · 7 증권·증명서 · 8 신규가입 · 0 상담사',
    disclosure: 'https://www.meritzfire.com/disclosure/product-announcement/product-list.do'
  },
  {
    name: 'DB손해보험', portal: '영업포탈 통합로그인', url: 'https://www.mdbins.com/', group: '손해보험',
    csPhone: '1588-0100', chrome: true, edge: false, color: '#009490',
    ars: '1 긴급출동 · 2 차사고접수 · 3 신규가입 · 4 보험금청구 · 5 장기 상담·해지 · 6 자동차 상담·해지 · 7 대출 · 8 증명서 · 9 납입변경 · 0 상담사',
    disclosure: 'https://www.idbins.com/FWMAIV1534.do'
  },
  {
    name: 'KB손해보험', portal: 'KB스마트비서 GA전용', url: 'https://nsales.kbinsure.co.kr/', group: '손해보험',
    csPhone: '1544-0114', chrome: true, edge: true, color: '#B8860B',
    ars: '1 차사고접수 · 2 고장출동 · 3 보험금 청구안내 · 4 장기 상담·변경·해지 · 5 대출 · 6 자동차 상담·변경·해지 · 7 정보변경·증명서 · 0 상담사',
    disclosure: 'https://www.kbinsure.co.kr/CG802030001.ec'
  },
  {
    name: '현대해상', portal: '영업포탈 (Hi Portal)', url: 'https://sp.hi.co.kr/', group: '손해보험',
    csPhone: '1588-5656', chrome: true, edge: true, color: '#F26822',
    ars: '1 고장출동 · 2 사고접수 · 3 보험금청구 · 4 장기보험관리 · 5 자동차보험관리 · 6 가입상담 · 7 대출·연금·펀드 · 8 증권·증명서 · 0 상담사',
    disclosure: 'https://www.hi.co.kr/serviceAction.do?view=bin/PA/03/HHPA03010M'
  },
  {
    name: '한화손해보험', portal: '설계사 전산', url: 'https://portal.hwgeneralins.com/', group: '손해보험',
    csPhone: '1566-8000', chrome: true, edge: true, color: '#F37321',
    ars: '1 차사고접수 · 2 고장출동 · 3 신규가입 · 4 장기 계약관리 · 5 보험금청구 · 6 자동차 계약관리 · 7 대출 · 8 증권·서류 · 0 상담사',
    disclosure: 'https://www.hwgeneralins.com/notice/ir/product-ing01.do'
  },
  {
    name: '롯데손해보험', portal: '영업지원 (let NGS)', url: 'https://lottero.lotteins.co.kr/', group: '손해보험',
    csPhone: '1588-3344', chrome: true, edge: true, color: '#DA291C',
    disclosure: 'https://www.lotteins.co.kr/web/C/D/H/cdh190.jsp'
  },
  {
    name: '흥국화재', portal: '영업포털', url: 'https://sales.heungkukfire.co.kr/', group: '손해보험',
    csPhone: '1688-1688', chrome: true, edge: true, color: '#E6007E',
    ars: '1 차사고접수 · 2 긴급출동 · 3 신규가입 · 4 보험금청구 · 5 장기 납입·변경·해지 · 6 자동차상담 · 7 대출 · 8 증명서 · 0 상담사',
    disclosure: 'https://www.heungkukfire.co.kr/FRW/announce/insGoodsGongsiSale.do'
  },
  {
    name: '하나손해보험', portal: 'SFA 영업지원', url: 'https://sfa.saleshana.com/index.html', group: '손해보험',
    csPhone: '1566-3000', chrome: true, edge: false, color: '#009178',
    ars: '1 고장출동 · 2 차사고접수 · 3 보험가입 · 4 자동차 계약변경 · 5 장기 계약변경·납입 · 6 보험금청구 · 8 계약대출 · 9 증명서 · 0 상담사',
    disclosure: 'https://www.hanainsure.co.kr/w/disclosure/product/saleProduct'
  },
  {
    name: 'NH농협손해보험', portal: 'SFA 영업지원시스템', url: 'https://ss.nhfire.co.kr/', group: '손해보험',
    csPhone: '1644-9000', chrome: true, edge: false, color: '#0079C1',
    ars: '1 보이는ARS · 2 음성ARS → 1 계약조회·납입 · 2 계약대출 · 3 해지·환급금 · 4 사고접수·보장상담 · 0 상담사',
    disclosure: 'https://www.nhfire.co.kr/announce/productAnnounce/retrieveInsuranceProductsAnnounce.nhfire'
  },
  {
    name: '라이나손해보험', portal: 'GA 전산', url: 'https://ga.linagi.com/', group: '손해보험',
    csPhone: '1566-5800', chrome: true, edge: true, color: '#1A1A1A',
    disclosure: 'https://www.chubb.com/kr-kr/disclosure/product.html'
  },
  {
    name: 'AIG손해보험', portal: 'GA 로그인', url: 'https://sso.aig.co.kr/gaLogin/gaLogin.jsp', group: '손해보험',
    csPhone: '1544-2792', chrome: true, edge: true, color: '#001F60',
    disclosure: 'https://www.aig.co.kr/wo/dpwot001.html?menuId=MS702'
  },
  {
    name: '예별손해보험', portal: 'MGA넷 (구 MG손보)', url: 'https://mganet.mggeneralins.com/', group: '손해보험',
    csPhone: '1588-5959', chrome: false, edge: true, color: '#1D4ED8',
    ars: '1 긴급출동 · 2 차사고접수 · 3 납입·계약문의 · 4 보험금청구 · 5 자동차 조회·변경·해지 · 6 계약대출 · 7 증명서 셀프발급',
    disclosure: 'https://www.mggeneralins.com/PB031210DM.scp?menuId=MN0803006'
  },
  // 생명보험 (21)
  {
    name: '한화생명', portal: 'FP월드 GA', url: 'https://hmp.hanwhalife.com/online/ga', group: '생명보험',
    csPhone: '1588-6363', chrome: true, edge: true, color: '#F37321',
    ars: '0 상담사 · 1 계약대출 · 2 보험금·해지 · 3 보험료납입 · 4 부동산·신용대출 · 6 변액 · 7 증명서 · 8 사고보험금',
    disclosure: 'https://www.hanwhalife.com/main/disclosure/goods/disclosurenotice/DF_GDDN000_P10000.do?MENU_ID1=DF_GDGL000'
  },
  {
    name: '동양생명', portal: '설계사 전산', url: 'https://1004.myangel.co.kr/', group: '생명보험',
    csPhone: '1577-1004', chrome: true, edge: false, color: '#F58025',
    ars: '1 간편계약대출 · 2 보험료입금·이체 · 3 증명서·서류 · 4 창구위치 · 5 보안·피싱신고 · 0 상담원',
    disclosure: 'https://www.myangel.co.kr/paging/WE_AC_WEPAAP020100L'
  },
  {
    name: '교보생명', portal: 'GA영업포탈', url: 'https://ga.kyobo.com/', group: '생명보험',
    csPhone: '1588-1001', chrome: true, edge: true, color: '#036B3F',
    ars: '1 계약대출 · 2 보험금청구·해지환급 · 3 보험료납입 · 4 증명서·비밀번호 · 0 상담사(1 대출·2 사고보험금·3 변액·4 일반)',
    disclosure: 'https://www.kyobo.com/dgt/web/product-official/all-product/search'
  },
  {
    name: '삼성생명', portal: 'GA영업포탈', url: 'https://ga.samsunglife.com/', group: '생명보험',
    csPhone: '1588-3114', chrome: false, edge: true, color: '#1428A0',
    ars: '0 상담사연결(2 납입·3 대출·4 사고보험금·5 일반문의·6 변액) · 1 ARS 셀프처리 · 2 AI 음성봇',
    disclosure: 'https://www.samsunglife.com/individual/products/disclosure/sales/PDO-PRPRI010110M'
  },
  {
    name: '라이나생명', portal: 'GA업무지원시스템', url: 'https://ga.lina.co.kr/', group: '생명보험',
    csPhone: '1588-0058', chrome: true, edge: true, color: '#111111',
    disclosure: 'https://www.lina.co.kr/disclosure/product_list.htm?productState=01&productKind=01'
  },
  {
    name: 'KDB생명', portal: '설계사 전산', url: 'https://kss.kdblife.co.kr/', group: '생명보험',
    csPhone: '1588-4040', chrome: true, edge: false, color: '#005EB8',
    disclosure: 'https://www.kdblife.co.kr/ajax.do?scrId=HDLMA002M02P'
  },
  {
    name: 'iM라이프', portal: '설계사 전산', url: 'https://fgs.dgbfnlife.com:8443/', group: '생명보험',
    csPhone: '1588-4770', chrome: true, edge: false, color: '#0E4A84',
    ars: '1 ARS 자동화 · 2 사고보험금 · 3 상담사 업무 · 4 고령자 간편상담 · 5 변액 · 6 해약',
    disclosure: 'https://www.dgbfnlife.com/BA/BA_A020.do'
  },
  {
    name: '미래에셋생명', portal: '설계사 전산', url: 'https://www.loveageplan.com/', group: '생명보험',
    csPhone: '1588-0220', chrome: true, edge: true, color: '#F58220',
    ars: '1 사고보험금 접수 · 2 가상계좌 발급 · 3 빠른조회·지급 · 4 변액상담 · 5 장애인·고령 상담 · 0 상담원',
    disclosure: 'https://life.miraeasset.com/micro/disclosure/product/PC-HO-080301-000000.do'
  },
  {
    name: '신한라이프', portal: 'GA 전산', url: 'https://ga.shinhanlife.co.kr/', group: '생명보험',
    csPhone: '1588-5580', chrome: true, edge: false, color: '#0046FF',
    ars: '1 계약대출 · 2 보험료납입 · 3 휴면·만기보험금 · 4 사고보험금 · 5 증명서 · 7 변액·연금 · 0 상담사',
    disclosure: 'https://www.shinhanlife.co.kr/hp/cdhi0010.do'
  },
  {
    name: 'KB라이프', portal: 'SFA 영업지원', url: 'https://sfa.kblife.co.kr/', group: '생명보험',
    csPhone: '1588-3374', chrome: true, edge: true, color: '#B8860B',
    ars: '1 거래고객 · 2 65세 이상 · 3 변액상담 · 4 은행·영업직원 · 5 기타 → 상담사연결',
    disclosure: 'https://www.kblife.co.kr/?tab=currently-selling'
  },
  {
    name: 'DB생명', portal: '이토피아 전산', url: 'https://etopia.idblife.com/', group: '생명보험',
    csPhone: '1588-3131', chrome: true, edge: true, color: '#009490',
    ars: '1 계약대출 · 2 사고보험금 · 3 계약확인 · 4 보험료납입 · 5 변액상담 · 6 증권·증명서 · 0 상담사',
    disclosure: 'https://www.idblife.com/notice/product/sale'
  },
  {
    name: '하나생명', portal: 'GA 전산', url: 'https://ga.hanalife.co.kr/', group: '생명보험',
    csPhone: '1577-1112', chrome: true, edge: true, color: '#009178',
    ars: '1 계약대출 · 2 변액 조회·상담 · 3 해지환급금 · 4 보험금청구 · 5 계약관리 · 6 증권·증명서 · 8 납입·가상계좌 · 0 상담사',
    disclosure: 'https://hanalife.co.kr/anm/product/allProduct.do?status=on'
  },
  {
    name: '흥국생명', portal: '영업포털', url: 'https://sales.heungkuklife.co.kr/', group: '생명보험',
    csPhone: '1588-2288', chrome: true, edge: false, color: '#E6007E',
    ars: '0 상담사(1 대출·3 사고보험금·6 변액) · 1 피싱신고·지급중지 · 2 ARS 조회·처리',
    disclosure: 'https://www.heungkuklife.co.kr/front/public/saleProduct.do?searchFlgSale=Y'
  },
  {
    name: 'ABL생명', portal: 'GA 전산', url: 'https://ga.abllife.co.kr/', group: '생명보험',
    csPhone: '1588-6500', chrome: true, edge: true, color: '#E4032E',
    disclosure: 'https://www.abllife.co.kr/st/pban/prdtPban/whlPrdt/whlPrdt1/whlPrdt11?page=index'
  },
  {
    name: 'IBK연금보험', portal: '설계사 전산', url: 'https://sf.ibki.co.kr/', group: '생명보험',
    csPhone: '1577-4117', chrome: true, edge: true, color: '#0086D4',
    disclosure: 'https://www.ibki.co.kr/process/HP_PBANO_PDT_SP_INDV'
  },
  {
    name: 'NH농협생명', portal: 'SFA 영업지원', url: 'https://sfa.nhlife.co.kr:8443/', group: '생명보험',
    csPhone: '1544-4000', chrome: true, edge: true, color: '#0079C1',
    disclosure: 'https://www.nhlife.co.kr/ho/on/HOON0004M00.nhl'
  },
  {
    name: '메트라이프', portal: 'MetPlus', url: 'https://metplus.metlife.co.kr/', group: '생명보험',
    csPhone: '1588-9600', chrome: true, edge: false, color: '#0090DA',
    disclosure: 'https://brand.metlife.co.kr/pn/paReal/insuProductDisclMain.do'
  },
  {
    name: '처브라이프', portal: 'e-Smart 전산', url: 'https://esmart.chubblife.co.kr/', group: '생명보험',
    csPhone: '1599-4600', chrome: false, edge: true, color: '#1B2A4A',
    ars: '1 자동조회(환급금·대출·납입·지급내역) · 2 보험금청구 문의 · 0 상담사',
    disclosure: 'https://www.chubblife.co.kr/front/official/sale/list.do'
  },
  {
    name: '푸본현대생명', portal: '설계사 전산', url: 'https://ez.fubonhyundai.com/', group: '생명보험',
    csPhone: '1577-3311', chrome: true, edge: true, color: '#00A29A',
    disclosure: 'https://www.fubonhyundai.com/#CUSI150102010101'
  },
  {
    name: 'BNP파리바카디프', portal: 'GA 전산', url: 'https://ga.cardif.co.kr/', group: '생명보험',
    csPhone: '1688-1118', chrome: false, edge: true, color: '#00915A',
    ars: '1 거래고객 · 2 65세 이상 · 3 변액상담 · 0 비고객',
    disclosure: 'https://www.cardif.co.kr/disclosure/papag101.do'
  },
  {
    name: 'AIA생명', portal: 'iMAP 전산', url: 'https://imap.aia.co.kr/', group: '생명보험',
    csPhone: '1588-9898', chrome: true, edge: true, color: '#D31145',
    ars: '1 납입·이체·가상계좌 · 2 계약확인 · 3 중도인출·휴면보험금 · 4 계약대출 · 5 보험금청구·보장 · 6 변액·펀드 · 9 소득공제증명서',
    disclosure: 'https://www.aia.co.kr/ko/our-products.html'
  },
  // 공제·우체국 (5)
  {
    name: 'MG새마을금고 공제', portal: '공제보험', url: 'https://insure.kfcc.co.kr/', group: '공제·우체국',
    csPhone: '1599-9010', chrome: false, edge: true, color: '#1D6FB8',
    disclosure: 'https://insu.kfcc.co.kr/ino/inoGuide.do'
  },
  {
    name: '더케이 (교직원공제)', portal: '공제 홈페이지', url: 'https://www.ktcu.or.kr/MH/MH-P010M01.do', group: '공제·우체국',
    csPhone: '1577-3993', chrome: false, edge: true, color: '#00A551',
    disclosure: 'https://www.ktcu.or.kr/IS/IS-P170M01.do'
  },
  {
    name: '우체국보험', portal: '우체국 보험', url: 'https://epostlife.go.kr/LNLNDM10DM.do', group: '공제·우체국',
    csPhone: '1599-0100', chrome: false, edge: true, color: '#D6001C',
    ars: '조회 #1~#8 · 보험금신청 11~14 · 2 사고보험금 · 대출 31~33 · 납입·이체 41~45 · 상담사 10/30/40',
    disclosure: 'https://mall.epostbank.go.kr/IPPSKE0000.do'
  },
  {
    name: '수협공제', portal: '수협은행', url: 'https://www.suhyup-bank.com/', group: '공제·우체국',
    csPhone: '1588-4119', chrome: false, edge: true, color: '#0083CB',
    disclosure: 'https://www.suhyup-bank.com/ib20/mnu/FPD00127'
  },
  {
    name: '신협공제', portal: '신협 공제', url: 'https://openbank.cu.co.kr/?sub=6000', group: '공제·우체국',
    csPhone: '1544-3030', chrome: false, edge: true, color: '#0072BC'
  }
]

// =============================================================================
// 해지 진행 안내 (2026-08-05) — ⚠ 검수 전 참고용 초안.
// 회사별 ARS 경로는 위 ars 데이터에서 도출했고, 단계·준비물·유의사항은 대부분
// 공통이라 아래 공통값을 쓴다. 실제 절차는 회사·상품별로 다를 수 있으므로
// 대표/직원 검수 후 확정할 것(화면에 '검수 전 참고용' 배지 노출).
// =============================================================================

export interface CancelGuide {
  /** 해지 상담까지 가는 ARS 경로 (회사별) */
  arsPath: string
  /** 회사 특이 단계 — 없으면 CANCEL_COMMON_STEPS 사용 */
  steps?: string[]
  /** 회사 특이 준비물 — 없으면 CANCEL_COMMON_DOCS 사용 */
  docs?: string[]
  /** 회사 특이 유의사항 — 없으면 CANCEL_COMMON_NOTE 사용 */
  notes?: string
}

/** 대부분 회사 공통 해지 진행 순서 (회사 특이사항은 CancelGuide.steps 로 덮어쓴다). */
export const CANCEL_COMMON_STEPS: string[] = [
  '고객센터에 전화해 아래 경로로 상담원 연결',
  '계약자 본인 확인 (반드시 계약자 본인이 통화)',
  '해지할 계약 특정 — 증권번호 또는 생년월일 안내',
  '해지환급금·손실 안내 확인 (해지는 되돌릴 수 없음)',
  '해지신청서 작성·전자서명 (문자/앱 링크로 발송)',
  '처리 완료 → 환급금은 보통 영업일 2~3일 내 입금'
]

export const CANCEL_COMMON_DOCS: string[] = [
  '계약자 본인 신분증',
  '본인 명의 환급 계좌',
  '증권번호 (없으면 생년월일)'
]

export const CANCEL_COMMON_NOTE =
  '해지하면 그동안 낸 보험료보다 적게 돌려받을 수 있고(원금 손실), 같은 조건으로 재가입이 어렵거나 보장 공백이 생길 수 있습니다. 신중히 결정하세요.'

/** 주요 12개사 해지 ARS 경로 (검수 전 초안). 나머지 회사는 공통 안내로 폴백. */
export const CANCEL_GUIDES: Record<string, CancelGuide> = {
  '삼성화재': { arsPath: '전화 → 3번(계약조회·변경·해지) → 상담원 연결' },
  '메리츠화재': { arsPath: '전화 → 4번(계약조회·변경·해지) → 상담원 연결' },
  'DB손해보험': { arsPath: '전화 → 5번(장기 상담·해지) → 상담원 연결' },
  'KB손해보험': { arsPath: '전화 → 4번(장기 상담·변경·해지) → 상담원 연결' },
  '현대해상': { arsPath: '전화 → 4번(장기보험 관리) → 상담원 연결' },
  '한화손해보험': { arsPath: '전화 → 4번(장기 계약관리) → 상담원 연결' },
  'NH농협손해보험': { arsPath: '전화 → 2번(음성ARS) → 3번(해지·환급금) → 상담원 연결' },
  '삼성생명': { arsPath: '전화 → 0번(상담사 연결) → 일반문의(해지)' },
  '한화생명': { arsPath: '전화 → 2번(보험금·해지) → 상담원 연결' },
  '교보생명': { arsPath: '전화 → 2번(보험금청구·해지환급) → 상담원 연결' },
  '신한라이프': { arsPath: '전화 → 0번(상담사 연결) → 해지 요청' },
  '미래에셋생명': { arsPath: '전화 → 0번(상담원 연결) → 해지 요청' }
}

export function cancelGuideFor(name: string): CancelGuide | undefined {
  return CANCEL_GUIDES[name]
}
