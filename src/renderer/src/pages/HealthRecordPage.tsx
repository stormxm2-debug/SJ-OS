import { useEffect, useMemo, useRef, useState } from 'react'
import { ShieldCheck, Send, RefreshCw, Loader2, Smartphone, AlertTriangle, Eye, EyeOff, ChevronDown, Link2, Copy, Check, Share2 } from 'lucide-react'
import {
  startHealthRecord,
  confirmHealthRecord,
  listHealthRecords,
  inviteCustomerLink,
  type TwoWayInfo,
  type HealthRecordRequest
} from '@renderer/services/commercial/healthRecordService'
import { listCustomers } from '@renderer/services/commercial/customerService'
import type { CustomerRecord } from '@shared/commercial/models'
import { shareMeetingText } from '@renderer/services/share/meetingShare'
import {
  collectHrSections,
  summarizeByDisease,
  summarizeEpisodes,
  diseaseFlags,
  groupKeyOf,
  sequelaeForSurgery,
  groupSurgeryOccasions,
  EPISODE_GAP_DAYS,
  BIG_SELFPAY_THRESHOLD,
  normalizeDisease,
  type GroupBy,
  type DiseaseSummary,
  type DiseaseEpisode,
  type SurgeryOccasion,
  type PartGroup
} from '@renderer/services/health-record/summarize'
import { deriveEntryPhase, type EntryPhase } from '@renderer/services/health-record/entryPhase'
import { classifyHealthError, createForegroundGuard, createHistoryRefresher, healthUiError, historyRowAction, initialHistoryLoad, PREV_REQUEST_NOTE, runForeground, type ForegroundGuard, type ForegroundTask, type HealthUiError, type HistoryLoadState, type HistoryRefresher } from '@renderer/services/health-record/healthStatusView'
import { askHealthRecordAi } from '@renderer/services/health-record/healthRecordAiService'
import HealthRecordWorkspace from '@renderer/components/health-record/HealthRecordWorkspace'
import SonsonEstimator from '@renderer/components/health-record/SonsonEstimator'
import RecentCareTable from '@renderer/components/health-record/RecentCareTable'
import { admissionSummary, buildCareRecords, CARE_PERIODS, careListSummary, calendarMonthsAgo, filterCareResult, localYmd, periodStart, validCareDate, type CarePeriod, type CareRecord, type HrUnderwritingContext } from '@renderer/services/health-record/careWorkspace'
import { aiGuideNote, type GuideLoadStatus } from '@renderer/services/health-record/guideLoadState'

/**
 * 고객 건강기록 조회 — CODEF 간편인증. 상품(건강보험공단/심평원)별로 입력·요청변수가 달라
 * 상품 설정(HEALTH_PRODUCTS)으로 폼·파라미터·결과 렌더러를 바꾼다.
 *
 * 1) 상품 선택 + 고객 정보 입력 → 간편인증 요청  2) 고객이 휴대폰에서 승인  3) 결과 조회.
 * 민감 의료정보이므로 동의 하에만 진행하고, 저장은 RLS로 보호 + 30일 후 자동 만료한다.
 */

type IdField = 'birth' | 'rrn'
type DateMode = 'range' | 'none'

interface HealthProduct {
  key: string
  label: string
  short: string // 헤더 배지
  url: string // CODEF Endpoint 경로
  organization: string // 기관코드
  idField: IdField // identity = 생년월일(8) | 주민번호(13)
  dateMode: DateMode // range: startDate/endDate(YYYYMMDD) | none: 최근 1년 자동
  extraParams?: Record<string, string> // detailYN 등
  encrypt?: string[] // 서버 RSA 암호화 필드(주민번호 등)
  kind: 'treatment' | 'medicine' // 결과 렌더러
  /** dateMode 'range' 조회기간 검증 창 — 상품별로 다름(없으면 기본값 사용). */
  periodWindow?: { backMonths: number; recentMonths: number }
  /** 민감상병 포함 토글(type 파라미터) 노출 여부. */
  supportsSensitive?: boolean
  /** 자녀정보 포함 토글(childYN 파라미터) 노출 여부. */
  supportsChild?: boolean
  note: string
}

/** CODEF 상품 설정. 요청변수는 각 상품 스펙(developer.codef.io)에 맞춰 확정. */
const HEALTH_PRODUCTS: HealthProduct[] = [
  {
    key: 'medical-history',
    label: '진료받은 내용 (건강보험공단)',
    short: '진료받은 내용',
    url: '/v1/kr/public/pp/nhis-list/medical-history',
    organization: '0002',
    idField: 'birth',
    dateMode: 'range',
    kind: 'treatment',
    note: '병원·약국별 진료형태·처방횟수·투약일수·본인/공단 부담금. 생년월일로 간편인증.'
  },
  {
    key: 'my-medicine',
    label: '내가먹는약 한눈에 (심평원·약품 상세)',
    short: '내가먹는약',
    url: '/v1/kr/public/hw/hira-list/my-medicine',
    organization: '0020',
    idField: 'rrn',
    dateMode: 'none',
    extraParams: { detailYN: '1' }, // 의약품 상세 포함
    encrypt: ['identity'], // 주민번호 RSA 암호화
    kind: 'medicine',
    note: '최근 1년간 조제받은 의약품(약품명·성분·조제기관·투약일수). 주민번호로 조회하며 암호화 전송됩니다.'
  },
  {
    key: 'my-medical-information',
    label: '내진료정보열람 (심평원·최근 5년)',
    short: '내진료정보열람',
    url: '/v1/kr/public/hw/hira-list/my-medical-information',
    organization: '0020',
    idField: 'rrn',
    dateMode: 'range',
    periodWindow: { backMonths: 60, recentMonths: 0 }, // 최근 5년 ~ 오늘
    // ⚠️ identity(주민번호)는 RSA 암호화하지 않는다 — CODEF 스펙상 certPassword만 암호화 대상이고
    // 주민번호는 평문(TLS)으로 보낸다. 암호화하면 CODEF가 blob을 주민번호로 읽어 "주민번호 잘못됨" 거부.
    supportsSensitive: true, // type: 민감상병 포함여부
    supportsChild: true, // childYN: 자녀정보 포함여부
    kind: 'treatment',
    note: '최근 5년 본인(및 자녀)의 진료내역·세부진료·처방조제정보 — 병원/약국·투약명·투약일수·입원일수·수술/치료내용. 주민번호로 본인확인(간편인증)하여 조회합니다.'
  }
]

/** 간편인증 수단 (loginTypeLevel). CODEF 스펙값. */
const AUTH_PROVIDERS: { v: string; label: string }[] = [
  { v: '1', label: '카카오톡' },
  { v: '6', label: '네이버' },
  { v: '8', label: '토스' },
  { v: '5', label: '통신사(PASS)' },
  { v: '4', label: 'KB모바일' },
  { v: '7', label: '신한인증서' },
  { v: '3', label: '삼성패스' },
  { v: '10', label: 'NH인증서' }
]

/** 통신사 (telecom) — loginTypeLevel="5"(통신사인증서)일 때만 필수. */
const TELECOMS: { v: string; label: string }[] = [
  { v: '0', label: 'SKT (알뜰폰 포함)' },
  { v: '1', label: 'KT (알뜰폰 포함)' },
  { v: '2', label: 'LG U+ (알뜰폰 포함)' }
]

const digits = (s: string): string => s.replace(/[^\d]/g, '')
const monthsAgoStr = (n: number): string => {
  return calendarMonthsAgo(n)
}

type Row = Record<string, unknown>

/** 응답 안의 목록(배열) 하나 = 한 섹션. 기본진료내역/세부진료·처방조제가 여러 배열로
 *  나뉘어 와도 각각 표로 보여주기 위해 전부 수집한다(기존엔 첫 배열만 보여 누락됐음). */
interface Section {
  key: string
  label: string
  rows: Row[]
}
/** 알려진 CODEF 목록 키 → 한글 섹션명(없으면 키 그대로). */
const SECTION_LABELS: Record<string, string> = {
  resList: '진료내역',
  resTreatmentList: '기본 진료내역',
  resBasicList: '기본 진료내역',
  resDetailList: '세부 진료내역',
  resPrescribeList: '처방·조제내역',
  resDrugList: '처방·조제내역',
  resMedicineList: '처방·조제내역',
  resBasicTreatList: '기본 진료내역',
  resDetailTreatList: '세부 진료·치료',
  resPrescribeDrugList: '처방·조제내역',
  resOperationList: '수술내역',
  resInfoList: '진료정보'
}
const sectionLabelOf = (k: string): string => SECTION_LABELS[k] ?? k

/** 알려진 섹션의 컬럼 스펙 — 내진료정보열람(심평원) 응답 3배열에 맞춘 전용 표. */
interface ColSpec {
  key: string
  label: string
  kind?: 'date' | 'won' | 'num' | 'text'
}
const SECTION_SPECS: Record<string, ColSpec[]> = {
  // 기본 진료내역: 병원·진료과·구분·상병·방문(입원)일수·부담금
  resBasicTreatList: [
    { key: 'resTreatStartDate', label: '진료일', kind: 'date' },
    { key: 'resHospitalName', label: '병의원' },
    { key: 'resDepartment', label: '진료과' },
    { key: 'resTreatType', label: '구분' },
    { key: 'resDiseaseName', label: '상병명' },
    { key: 'resVisitDays', label: '방문/입원일수', kind: 'num' },
    { key: 'resTotalAmount', label: '총액', kind: 'won' },
    { key: 'resDeductibleAmt', label: '본인부담', kind: 'won' },
    { key: 'resPublicCharge', label: '공단부담', kind: 'won' }
  ],
  // 세부 진료·치료: 치료종류(수술 등)·항목·투약량/횟수/일수
  resDetailTreatList: [
    { key: 'resTreatStartDate', label: '진료일', kind: 'date' },
    { key: 'resHospitalName', label: '병의원' },
    { key: 'resTreatType', label: '치료종류' },
    { key: 'resCodeName', label: '항목' },
    { key: 'resOneDose', label: '1회량' },
    { key: 'resDailyDosesNumber', label: '1일횟수' },
    { key: 'resTotalDosingdays', label: '일수', kind: 'num' }
  ],
  // 처방·조제: 약품명·성분·투약량/횟수/일수
  resPrescribeDrugList: [
    { key: 'resTreatStartDate', label: '처방일', kind: 'date' },
    { key: 'resHospitalName', label: '처방기관' },
    { key: 'resTreatType', label: '구분' },
    { key: 'resDrugName', label: '약품명' },
    { key: 'resIngredients', label: '성분' },
    { key: 'resOneDose', label: '1회량' },
    { key: 'resDailyDosesNumber', label: '1일횟수' },
    { key: 'resTotalDosingdays', label: '투약일수', kind: 'num' }
  ]
}

/** result → 섹션 목록. 최상위가 배열이면 1섹션, 객체면 배열 속성마다 1섹션씩. */
const collectSections = (result: unknown): Section[] => {
  if (Array.isArray(result)) return result.length ? [{ key: 'list', label: '조회 내역', rows: result as Row[] }] : []
  if (!result || typeof result !== 'object') return []
  const obj = result as Record<string, unknown>
  const out: Section[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') out.push({ key: k, label: sectionLabelOf(k), rows: v as Row[] })
  }
  // 배열이 하나도 없지만 스칼라 필드가 있으면 1행짜리 정보 섹션으로.
  if (out.length === 0 && Object.values(obj).some((v) => v !== null && typeof v !== 'object' && v !== '')) {
    out.push({ key: 'info', label: '진료정보', rows: [obj as Row] })
  }
  return out
}

/** 진료(카테고리 보고서) 모양인지 — 진료형태/부담금/방문일수 필드가 있으면 진료형. */
const isTreatmentShape = (rows: Row[]): boolean => rows.some((r) => 'resTreatType' in r || 'resPublicCharge' in r || 'resVisitDays' in r)
const userNameOf = (rows: Row[]): string => String(rows.find((r) => r.resUserNm)?.resUserNm ?? '')

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const won = (v: unknown): string => `${num(v).toLocaleString('ko-KR')}원`
const ymd = (v: unknown): string => {
  const d = String(v ?? '').replace(/[^\d]/g, '')
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}` : String(v ?? '') || '-'
}

/** 조회 결과 보관·열람 기간(일). 지나면 cron 이 결과를 비우고 '만료' 처리한다. */
const RETAIN_DAYS = 30
/** 최근 요청 기본 표시 건수(더보기로 늘림). */
const HISTORY_PAGE = 5
/** 휴대폰 번호 표시용 하이픈(저장·전송 값은 그대로). */
const formatPhone = (v: string): string => {
  const d = digits(v)
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : v
}
const daysSince = (iso: string): number => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)

interface CatRow {
  type: string
  count: number
  deductible: number
  publicCharge: number
}
/** 진료형태별 카테고리 집계 + 합계. */
const summarize = (recs: Row[]): { cats: CatRow[]; total: CatRow } => {
  const map = new Map<string, CatRow>()
  const total: CatRow = { type: '합계', count: recs.length, deductible: 0, publicCharge: 0 }
  for (const r of recs) {
    const type = (String(r.resTreatType ?? '') || '기타').trim()
    const cur = map.get(type) ?? { type, count: 0, deductible: 0, publicCharge: 0 }
    cur.count += 1
    cur.deductible += num(r.resDeductibleAmt)
    cur.publicCharge += num(r.resPublicCharge)
    map.set(type, cur)
    total.deductible += num(r.resDeductibleAmt)
    total.publicCharge += num(r.resPublicCharge)
  }
  return { cats: [...map.values()].sort((a, b) => b.count - a.count), total }
}

export default function HealthRecordPage(): JSX.Element {
  // 기본 상품: 내진료정보열람(심평원·최근 5년) — 열자마자 5년 조회기간이 잡히도록.
  const [productKey, setProductKey] = useState('my-medical-information')
  const selected = HEALTH_PRODUCTS.find((p) => p.key === productKey) ?? HEALTH_PRODUCTS[0]
  const defaultWindow = (HEALTH_PRODUCTS.find((p) => p.key === 'my-medical-information') ?? HEALTH_PRODUCTS[0]).periodWindow ?? { backMonths: 14, recentMonths: 2 }

  const [customers, setCustomers] = useState<CustomerRecord[]>([]) // 내 고객만(RLS)
  const [customerId, setCustomerId] = useState('') // 선택한 고객 id — 조회 결과에 연결
  const [name, setName] = useState('')
  const [idValue, setIdValue] = useState('') // 생년월일(8) 또는 주민번호(13) — 상품에 따라
  const [showRrn, setShowRrn] = useState(false) // 주민번호 화면 표시 여부(기본 가림)
  const [phone, setPhone] = useState('')
  const [provider, setProvider] = useState('1') // loginTypeLevel (기본: 카카오톡)
  const [telecom, setTelecom] = useState('0') // telecom (통신사인증서일 때만)
  const [startDate, setStartDate] = useState(monthsAgoStr(defaultWindow.backMonths))
  const [endDate, setEndDate] = useState(monthsAgoStr(defaultWindow.recentMonths))
  const [includeSensitive, setIncludeSensitive] = useState(false) // type: 민감상병 포함
  const [includeChild, setIncludeChild] = useState(false) // childYN: 자녀 포함

  const [busy, setBusy] = useState<string | null>(null)
  const [busySeconds, setBusySeconds] = useState(0)
  useEffect(() => {
    setBusySeconds(0)
    if (!busy) return
    const start = Date.now()
    const timer = window.setInterval(() => setBusySeconds(Math.floor((Date.now()-start)/1000)), 1000)
    return () => window.clearInterval(timer)
  }, [busy])
  const [notice, setNotice] = useState<string | null>(null)
  // 오류 메시지 + 응답 code(HEALTH_TIMEOUT 등, 표시 분류용 메타데이터만)를 한 상태로 — 새 오류·초기화 때 code 가 함께 바뀐다.
  const [uiError, setUiError] = useState<HealthUiError | null>(null)
  const error = uiError?.message ?? null
  const errorCode = uiError?.code ?? ''
  const setError = (message: string | null, code = ''): void => setUiError(healthUiError(message, code))
  const [configNote, setConfigNote] = useState<string | null>(null)

  const [requestId, setRequestId] = useState<string | undefined>(undefined)
  const [twoWay, setTwoWay] = useState<TwoWayInfo | undefined>(undefined)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [history, setHistory] = useState<HealthRecordRequest[]>([])
  const [historyQuery, setHistoryQuery] = useState('') // 최근 요청 고객명 검색
  const historyQueryRef = useRef('')

  // 주민번호 입력 주체: 직원 직접 / 고객에게 링크
  const [inputMode, setInputMode] = useState<'staff' | 'customer'>('customer')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [invite, setInvite] = useState<{ url: string; smsSent: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  const needTelecom = provider === '5'
  const needDate = selected.dateMode === 'range'
  const idLen = selected.idField === 'birth' ? 8 : 13

  // 최근 요청 로딩 메타데이터 — 늦게 온 이전 응답(이전 검색어 등)이 최신 목록·상태를 덮지 않게 순번으로 가드.
  const [historyLoad, setHistoryLoad] = useState<HistoryLoadState>(initialHistoryLoad)
  // 같은 검색어의 진행 중 요청은 공유(폴링·수동 새로고침 겹침), 검색어가 바뀌면 새 요청.
  const historyRefresherRef = useRef<HistoryRefresher | null>(null)
  if (!historyRefresherRef.current) {
    historyRefresherRef.current = createHistoryRefresher<HealthRecordRequest>({
      // 본인(FC)이 조회한 것만 + (있으면) 고객명 검색으로 조회.
      load: (q) => listHealthRecords(undefined, q),
      query: () => historyQueryRef.current,
      now: () => Date.now(),
      publish: setHistoryLoad,
      apply: setHistory // 실패 시 호출되지 않아 기존 목록 유지(빈 목록으로 바꾸지 않음)
    })
  }
  const historyRefresher = historyRefresherRef.current
  // 진행 중 start/confirm/invite 응답을 지금 화면(고객·상품·입력방식·작업)에만 반영하는 표시용 가드.
  const foregroundRef = useRef<ForegroundGuard | null>(null)
  if (!foregroundRef.current) foregroundRef.current = createForegroundGuard()
  const fg = foregroundRef.current
  // 이전 작업 무효화 + 그 작업의 busy 표시 정리(서버 요청은 취소하지 않음 — 「최근 요청」에서 확인).
  const dropForeground = (): boolean => {
    const was = fg.invalidate()
    setBusy(null)
    setInviteBusy(false)
    return was
  }
  const beginForeground = (): ForegroundTask => {
    dropForeground()
    return fg.begin()
  }
  const refresh = (): Promise<void> => historyRefresher.refresh()
  const onHistorySearch = (v: string): void => {
    setHistoryQuery(v)
    historyQueryRef.current = v
    void refresh()
  }
  useEffect(() => {
    void refresh()
  }, [])
  // 내 고객만 로드(owner_staff_id = 내 uid). 다른 FC 고객은 선택 목록에 뜨지 않는다.
  useEffect(() => {
    void (async () => {
      const r = await listCustomers({ mineOnly: true })
      if (r.ok) setCustomers(r.customers)
    })()
  }, [])

  // 선택 상품의 식별값(생년월일 8 / 주민번호 13)을 고객 레코드에서 꺼낸다.
  const idFromCustomer = (c: CustomerRecord, idField: 'birth' | 'rrn'): string =>
    digits(idField === 'birth' ? c.birthDate ?? '' : c.rrn ?? '')

  // 고객 선택 → 이름·전화·식별값 자동 입력 + customerId 연결(진행 세션/결과는 초기화).
  const onSelectCustomer = (id: string): void => {
    const hadPending = dropForeground() // 이전 고객의 늦은 응답이 새 고객 화면을 덮지 않게
    setCustomerId(id)
    setTwoWay(undefined)
    setRequestId(undefined)
    setResult(null)
    setInvite(null) // 이전 고객 링크가 새 고객 화면에 남지 않게
    setCopied(false)
    setError(null)
    setNotice(hadPending ? PREV_REQUEST_NOTE : null)
    setConfigNote(null)
    const c = customers.find((x) => x.id === id)
    if (!c) return
    setName(c.name ?? '')
    if (c.phone) setPhone(digits(c.phone))
    const v = idFromCustomer(c, selected.idField)
    if (v) setIdValue(v)
  }

  // 상품을 바꾸면 진행 중이던 세션/결과를 비운다(요청변수가 달라지므로).
  const onProductChange = (key: string): void => {
    const hadPending = dropForeground() // 옛 상품의 늦은 응답이 새 상품 화면을 덮지 않게
    setProductKey(key)
    setIdValue('')
    setTwoWay(undefined)
    setRequestId(undefined)
    setResult(null)
    setInvite(null) // 링크 템플릿(요청변수)이 상품마다 다르므로 이전 링크는 버린다
    setCopied(false)
    setError(null)
    setNotice(hadPending ? PREV_REQUEST_NOTE : null)
    setConfigNote(null)
    // 상품별 조회기간 창에 맞춰 기본 날짜를 다시 설정(요청변수가 달라지므로).
    const p = HEALTH_PRODUCTS.find((x) => x.key === key) ?? HEALTH_PRODUCTS[0]
    const win = p.periodWindow ?? { backMonths: 14, recentMonths: 2 }
    setStartDate(monthsAgoStr(win.backMonths))
    setEndDate(monthsAgoStr(win.recentMonths))
    setIncludeSensitive(false)
    setIncludeChild(false)
    // 고객이 선택돼 있으면 새 상품의 식별값(생년월일/주민번호)을 다시 자동 입력.
    const c = customers.find((x) => x.id === customerId)
    if (c) {
      const v = idFromCustomer(c, p.idField)
      if (v) setIdValue(v)
    }
  }

  // CODEF 요청 변수 — 선택 상품 스펙(간편인증 loginType "5")대로.
  const buildParam = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {
      organization: selected.organization,
      loginType: '5',
      loginTypeLevel: provider,
      userName: name.trim(),
      identity: digits(idValue),
      phoneNo: digits(phone),
      ...(selected.extraParams ?? {})
    }
    if (needDate) {
      p.startDate = digits(startDate)
      p.endDate = digits(endDate)
    }
    if (needTelecom) p.telecom = telecom
    if (selected.supportsSensitive) p.type = includeSensitive ? '1' : '0'
    if (selected.supportsChild) p.childYN = includeChild ? '1' : '0'
    return p
  }

  // 조회기간 규칙은 상품별(periodWindow)로 다름. 진료받은 내용: 14개월 전~2개월 전,
  // 내진료정보열람: 60개월(5년) 전~오늘. 없으면 기본값(14/2)을 쓴다.
  const period = selected.periodWindow ?? { backMonths: 14, recentMonths: 2 }
  const minStart = monthsAgoStr(period.backMonths)
  const maxEnd = monthsAgoStr(period.recentMonths)
  const validPeriod =
    !needDate ||
    (validCareDate(digits(startDate)) &&
      validCareDate(digits(endDate)) &&
      digits(startDate) < digits(endDate) &&
      digits(startDate) >= minStart &&
      digits(endDate) <= maxEnd)
  const canStart =
    Boolean(name.trim()) && digits(idValue).length === idLen && digits(phone).length >= 10 && validPeriod

  const onStart = async (): Promise<void> => {
    const task = beginForeground()
    setError(null)
    setNotice(null)
    setConfigNote(null)
    setResult(null)
    setTwoWay(undefined)
    setRequestId(undefined)
    if (!canStart) {
      const idMsg = selected.idField === 'birth' ? '생년월일(8자리)' : '주민등록번호(13자리)'
      const dateMsg = needDate ? ` 조회기간은 ${ymd(minStart)} ~ ${ymd(maxEnd)} 안이어야 합니다.` : ''
      setError(`고객 성함·${idMsg}·휴대폰 번호를 확인해주세요.${dateMsg}`)
      fg.invalidate()
      return
    }
    setBusy('고객 휴대폰으로 간편인증을 요청하는 중…')
    await runForeground(fg, task, {
      work: () =>
        startHealthRecord({
          customerId: customerId || null,
          customerName: name.trim(),
          product: selected.url,
          param: buildParam(),
          encryptFields: selected.encrypt
        }),
      apply: (r) => {
        if (r.disabled) {
          setConfigNote(r.error ?? 'CODEF 연동이 아직 설정되지 않았습니다. 키·상품 URL을 등록하면 바로 동작합니다.')
          return
        }
        if (!r.ok && r.status !== 'awaiting_auth') {
          setError(r.error ?? '요청에 실패했습니다.', r.code ?? '')
          return
        }
        setRequestId(r.requestId)
        setTwoWay(r.twoWay)
        if (r.status === 'completed' && r.result) setResult(r.result)
        setNotice(r.message ?? '고객님 휴대폰에서 간편인증을 승인해 주세요. 승인 후 아래 「결과 조회」를 누르세요.')
        void refresh()
      },
      fail: () => setError('요청 중 오류가 발생했습니다.'),
      settle: () => setBusy(null),
      stale: () => void refresh() // 지난 작업은 화면 대신 「최근 요청」 목록만 갱신
    })
  }

  const onConfirm = async (): Promise<void> => {
    const task = beginForeground()
    setError(null)
    if (!twoWay) {
      setError('먼저 간편인증을 요청하세요.')
      fg.invalidate()
      return
    }
    setBusy('고객 건강기록을 불러오는 중…')
    await runForeground(fg, task, {
      work: () =>
        confirmHealthRecord({
          requestId,
          product: selected.url,
          param: buildParam(),
          twoWay,
          encryptFields: selected.encrypt
        }),
      apply: (r) => {
        if (r.disabled) {
          setConfigNote(r.error ?? 'CODEF 연동이 아직 설정되지 않았습니다.')
          return
        }
        if (!r.ok) {
          const deadSession = r.code === 'CF-00025' || /완료된 요청|만료|CF-00025/.test(r.error ?? '')
          if (deadSession) {
            setTwoWay(undefined)
            setRequestId(undefined)
            setError('인증 세션이 끝났습니다(1회용). 「간편인증 요청」부터 다시 하세요 — 요청 → 승인 → 결과 조회를 한 번씩만.', 'CF-00025')
          } else {
            setError(r.error ?? '아직 승인 전이거나 조회에 실패했습니다. 고객 승인 후 다시 시도해주세요.', r.code ?? '')
          }
          return
        }
        setResult(r.result ?? {})
        setRequestId(r.requestId ?? requestId)
        setTwoWay(undefined) // 2-way 세션은 1회용 — 성공 후 재조회 방지(새 조회는 다시 요청).
        setNotice('건강기록을 받아왔습니다.')
        void refresh()
      },
      fail: () => setError('조회 중 오류가 발생했습니다.'),
      settle: () => setBusy(null),
      stale: () => void refresh()
    })
  }

  // 고객 링크(주민번호 고객 직접 입력) 발급 — 주민번호는 보내지 않고 템플릿만.
  const canInvite = Boolean(name.trim()) && digits(phone).length >= 10 && validPeriod
  const onInvite = async (): Promise<void> => {
    const task = beginForeground()
    setError(null)
    setNotice(null)
    setConfigNote(null)
    setInvite(null)
    setCopied(false)
    // 새 링크 요청 — 열어 둔 이전 결과는 비운다(이전 결과를 새 요청의 성공으로 보이지 않게).
    setResult(null)
    setRequestId(undefined)
    if (!canInvite) {
      setError('고객 성함·휴대폰 번호를 확인해주세요.')
      fg.invalidate()
      return
    }
    setInviteBusy(true)
    await runForeground(fg, task, {
      work: () => {
        const template = buildParam() as Record<string, unknown>
        delete template.identity
        return inviteCustomerLink({
          customerId: customerId || null,
          customerName: name.trim(),
          phone,
          product: selected.url,
          paramTemplate: template,
          encryptFields: selected.encrypt,
          idField: selected.idField,
          idLen,
          appOrigin: window.location.origin
        })
      },
      apply: (r) => {
        if (r.disabled) {
          setConfigNote(r.error ?? '링크 발급 서버(엣지함수)가 아직 배포되지 않았습니다.')
          return
        }
        if (!r.ok || !r.url) {
          setError(r.error ?? '링크 생성에 실패했습니다.')
          return
        }
        setInvite({ url: r.url, smsSent: Boolean(r.smsSent) })
        // 발급 결과·문자 발송 여부는 상단 링크 상자에 표시(중복 안내 생략).
        void refresh()
      },
      fail: () => setError('링크 생성 중 오류가 발생했습니다.'),
      settle: () => setInviteBusy(false),
      stale: () => void refresh()
    })
  }
  const copyInvite = async (): Promise<void> => {
    if (!invite) return
    try {
      await navigator.clipboard.writeText(invite.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard 불가 시 무시 */
    }
  }
  const shareInvite = (): void => {
    if (!invite) return
    void shareMeetingText(`[SJ INVEST] ${name.trim() || '고객'}님, 건강보험 조회를 위해 아래 링크에서 본인확인(주민번호+간편인증)을 진행해 주세요.\n${invite.url}\n(30분 이내 1회용)`)
  }

  // 고객 입력/인증 대기 건이 있으면 결과가 자동 반영되게 가볍게 폴링.
  useEffect(() => {
    const anyPending = history.some((h) => h.status === 'awaiting_customer' || h.status === 'awaiting_auth' || h.status === 'fetching' || h.status === 'consented')
    if (!anyPending) return
    const id = window.setInterval(() => void refresh(), 10000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history])

  // 저장된(과거) 결과 다시 보기 — 완료 건이고 보관기간(30일) 안이면 그 결과를 결과 영역에 띄운다.
  const viewSaved = (h: HealthRecordRequest): void => {
    if (!h.result) return
    dropForeground() // 저장 결과 열람 — 진행 중이던 응답이 이 결과를 덮지 않게
    setError(null)
    setConfigNote(null)
    setTwoWay(undefined)
    setInvite(null) // 저장 결과 열람 — 진행 중이던 링크 표시는 정리(결과 보기가 우선)
    setCopied(false)
    setRequestId(h.id)
    setResult(h.result)
    setNotice(`저장된 결과를 불러왔습니다 — ${h.customerName || '고객'} · ${new Date(h.createdAt).toLocaleDateString('ko-KR')}`)
    setTimeout(() => document.getElementById('hr-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  // ── 조회 전 화면 표시용 파생 상태(요청 변수·핸들러는 위 그대로) ──
  const [settingsOpen, setSettingsOpen] = useState(false) // 조회 설정 변경(접힘)
  const [editContact, setEditContact] = useState(false) // 선택 고객의 이름·번호 수정
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE)
  const providerLabel = AUTH_PROVIDERS.find((p) => p.v === provider)?.label ?? '간편인증'
  const telecomLabel = TELECOMS.find((t) => t.v === telecom)?.label.replace(/\s*\(.*\)$/, '') ?? ''
  const hasContact = Boolean(name.trim()) && digits(phone).length >= 10
  const showSettings = settingsOpen || !validPeriod // 기간이 틀리면 펼쳐서 보여준다
  const periodSummary = needDate ? `${ymd(startDate)} ~ ${ymd(endDate)}` : '최근 1년 자동'
  const optionSummary = [
    selected.supportsSensitive ? `민감상병 ${includeSensitive ? '포함' : '미포함'}` : '',
    selected.supportsChild ? `자녀 ${includeChild ? '포함' : '미포함'}` : ''
  ].filter(Boolean).join(' · ')
  const missingMsg = !name.trim()
    ? '고객을 선택하거나 성함을 입력하세요.'
    : digits(phone).length < 10
      ? '휴대폰 번호를 확인하세요.'
      : !validPeriod
        ? `조회기간은 ${ymd(minStart)} ~ ${ymd(maxEnd)} 안이어야 합니다.`
        : inputMode === 'staff' && digits(idValue).length !== idLen
          ? `${selected.idField === 'birth' ? '생년월일 8자리' : '주민등록번호 13자리'}를 입력하세요.`
          : ''
  type Phase = EntryPhase
  // 새 인증/링크 작업 상태가 결과 표시보다 우선(entryPhase.ts 참고).
  const phase: Phase = deriveEntryPhase({
    inputMode,
    hasResult: Boolean(result),
    busy: Boolean(busy),
    hasTwoWay: Boolean(twoWay),
    inviteBusy,
    hasInvite: Boolean(invite),
    hasError: Boolean(error)
  })
  const currentStep: 1 | 2 | 3 = phase === 'done' ? 3 : hasContact ? 2 : 1
  const errView = classifyHealthError(error ?? '', errorCode)
  // 응답 확인 필요(시간초과·연결 불확실 등): 주행동은 최근 요청 확인, 새 인증·조회는 보조행동.
  const checkFirst = phase === 'failed' && errView.checkHistoryFirst
  const checkHistory = (): void => {
    void refresh() // 목록 새로고침만 — start/confirm/invite 는 다시 호출하지 않는다.
    document.getElementById('hr-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const PHASE_TEXT: Record<Phase, { title: string; desc: string }> = {
    idle: {
      title: '인증 요청 전',
      desc: inputMode === 'customer' ? '고객에게 인증 링크를 보내세요.' : '고객 휴대폰으로 간편인증을 요청하세요.'
    },
    requesting: { title: inputMode === 'customer' ? '링크 만드는 중' : '인증 요청 중', desc: '잠시만 기다려 주세요.' },
    awaiting: { title: '인증 대기', desc: `고객이 휴대폰(${providerLabel})에서 승인하면 「결과 조회」를 누르세요.` },
    link_sent: { title: '링크 발급됨', desc: '고객 입력·인증 후 아래 「최근 요청」에서 진행을 확인하세요.' },
    fetching: { title: '조회 중', desc: '기관에서 건강기록을 받아오고 있습니다.' },
    done: { title: '조회 성공', desc: '아래 「조회 결과」에서 내용을 확인하세요.' },
    failed: {
      title: errView.title,
      desc: errView.checkHistoryFirst ? errView.action : twoWay && errView.kind === 'general' ? '고객 승인을 확인한 뒤 「결과 조회」를 다시 누르세요.' : errView.action
    }
  }
  const phaseTone =
    phase === 'done' ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
      : phase === 'failed' ? 'border-rose-300 bg-rose-50 text-rose-800'
        : phase === 'idle' ? 'border-[#e2e8f0] bg-[#f8fafc] text-[#334155]'
          : 'border-[#c6982f] bg-[#fdf7ea] text-[#6b5216]'
  const scrollToResult = (): void => document.getElementById('hr-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const secondaryBtn =
    'inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[#cbd5e1] bg-white px-4 py-2 text-[14px] font-bold text-[#0e1e3a] transition hover:bg-[#f8fafc] disabled:opacity-50'
  const primaryBtn =
    'inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#0e1e3a] px-4 py-3 text-[15px] font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50'
  const fieldCls =
    'mt-1 min-h-[44px] w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[14px] text-slate-100 outline-none focus:border-[#c6982f] disabled:opacity-60'
  // 요청 진행 중에는 요청 변수(성함·연락처·식별번호·기간·인증수단·옵션)만 잠가 응답과 화면 입력이 어긋나지 않게 한다.
  // 고객·상품·입력방식 전환은 열어 두고, 전환 시 진행 중 응답은 표시용 가드로 분리한다.
  const lockParams = Boolean(busy) || inviteBusy
  const labelCls = 'text-[12px] font-semibold text-slate-400'
  const visibleHistory = history.slice(0, historyLimit)
  // 입력한 검색어와 화면 목록의 검색어가 다르면(검색 중/실패) 현재 검색 결과로 오인하지 않게 표시.
  const staleSearch = historyLoad.lastOkAt !== null && historyQuery.trim() !== historyLoad.shownQuery.trim()
  const hiddenCount = Math.max(0, history.length - visibleHistory.length)

  return (
    <div className="space-y-4 overflow-x-hidden">
      {/* 헤더 */}
      <div className="rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-[15px] font-extrabold text-white">고객 건강기록 조회</h1>
        </div>
        <p className="mt-1 text-[12px] text-white/70">
          고객 동의 하에 간편인증으로 조회합니다. 결과는 접근 권한으로 보호되며 {RETAIN_DAYS}일 후 자동 만료됩니다.
        </p>
        <StepGuide current={currentStep} />
      </div>

      {configNote ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b className="font-bold">CODEF 연동 설정 필요</b> — {configNote}
            <div className="mt-1 text-[12px] text-amber-700">
              Supabase 시크릿에 CODEF_CLIENT_ID / CODEF_CLIENT_SECRET / CODEF_PUBLIC_KEY 를 등록하면 즉시 동작합니다.
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 1 고객 선택 */}
        <section aria-labelledby="hr-step1" className="min-w-0 rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <h2 id="hr-step1" className="text-[15px] font-bold text-slate-100">1. 고객 선택</h2>
          <label htmlFor="hr-customer" className={`mt-3 block ${labelCls}`}>내 고객</label>
          <select id="hr-customer" value={customerId} onChange={(e) => { onSelectCustomer(e.target.value); setEditContact(false) }}
            className={`${fieldCls} font-semibold`}>
            <option value="">— 고객 선택 —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>
            ))}
          </select>
          {customers.length === 0 ? (
            <p className="mt-1 text-[12px] text-slate-500">등록된 내 고객이 없습니다. 고객관리에서 등록하거나 아래에 직접 입력하세요.</p>
          ) : null}

          {customerId && !editContact ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-bold text-[#0f172a]">{name || '이름 없음'}</div>
                <div className="text-[13px] text-[#475569]">{phone ? formatPhone(phone) : '휴대폰 번호 없음'}</div>
              </div>
              <button type="button" onClick={() => setEditContact(true)}
                className="min-h-[36px] rounded-lg border border-[#cbd5e1] bg-white px-3 text-[12px] font-bold text-[#334155]">수정</button>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label htmlFor="hr-name" className={labelCls}>고객 성함</label>
                <input id="hr-name" value={name} onChange={(e) => setName(e.target.value)} disabled={lockParams} placeholder="홍길동" className={fieldCls} />
              </div>
              <div>
                <label htmlFor="hr-phone" className={labelCls}>휴대폰 번호</label>
                <input id="hr-phone" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={lockParams} inputMode="numeric" placeholder="01012345678" className={fieldCls} />
              </div>
            </div>
          )}
          {customerId ? <p className="mt-2 text-[12px] text-slate-500">조회 결과는 이 고객에 연결됩니다.</p> : null}
        </section>

        {/* 2 본인인증 */}
        <section aria-labelledby="hr-step2" className="min-w-0 rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <h2 id="hr-step2" className="text-[15px] font-bold text-slate-100">2. 본인인증</h2>
          <p className="mt-1 text-[13px] text-slate-500">
            {inputMode === 'customer' ? '고객이 링크에서 주민번호를 직접 입력하고 인증합니다.' : '직원이 식별번호를 입력하고 고객 휴대폰으로 인증을 요청합니다.'}
          </p>

          {/* 조회 설정 한 줄 요약 + 접힌 상세 */}
          <div className="mt-3 rounded-xl border border-[#e2e8f0] bg-[#f8fafc]">
            <button type="button" onClick={() => setSettingsOpen((v) => !v)} aria-expanded={showSettings} aria-controls="hr-settings"
              className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-[#0f172a]">{selected.short} · {periodSummary}</span>
                <span className="block text-[12px] text-[#475569]">
                  {providerLabel}{needTelecom ? `(${telecomLabel})` : ''}{optionSummary ? ` · ${optionSummary}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-[12px] font-bold text-[#8a6a1f]">조회 설정 변경</span>
              <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-[#8a6a1f] transition ${showSettings ? 'rotate-180' : ''}`} />
            </button>
            {showSettings ? (
              <div id="hr-settings" className="space-y-2.5 border-t border-[#e2e8f0] px-3 pb-3 pt-2.5">
                <div>
                  <label htmlFor="hr-product" className={labelCls}>조회 기관·상품</label>
                  <select id="hr-product" value={productKey} onChange={(e) => onProductChange(e.target.value)} className={`${fieldCls} font-semibold`}>
                    {HEALTH_PRODUCTS.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{selected.note}</p>
                </div>
                {needDate ? (
                  <div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="hr-start" className={labelCls}>조회 시작</label>
                        <input id="hr-start" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={lockParams} inputMode="numeric" maxLength={8} placeholder="YYYYMMDD" className={fieldCls} />
                      </div>
                      <div>
                        <label htmlFor="hr-end" className={labelCls}>조회 종료</label>
                        <input id="hr-end" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={lockParams} inputMode="numeric" maxLength={8} placeholder="YYYYMMDD" className={fieldCls} />
                      </div>
                    </div>
                    <p className={`mt-1 text-[12px] ${validPeriod ? 'text-slate-500' : 'font-semibold text-rose-700'}`}>
                      가능 기간 {ymd(minStart)} ~ {ymd(maxEnd)}{period.recentMonths >= 2 ? ' (최근 2개월은 공단 반영 전)' : ''}
                    </p>
                  </div>
                ) : null}
                {selected.supportsSensitive || selected.supportsChild ? (
                  <div>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {selected.supportsChild ? (
                        <label className="inline-flex min-h-[36px] items-center gap-2 text-[13px] font-semibold text-slate-300">
                          <input type="checkbox" checked={includeChild} onChange={(e) => setIncludeChild(e.target.checked)} disabled={lockParams} className="h-4 w-4 accent-[#c6982f]" />
                          자녀 정보 포함
                        </label>
                      ) : null}
                      {selected.supportsSensitive ? (
                        <label className="inline-flex min-h-[36px] items-center gap-2 text-[13px] font-semibold text-slate-300">
                          <input type="checkbox" checked={includeSensitive} onChange={(e) => setIncludeSensitive(e.target.checked)} disabled={lockParams} className="h-4 w-4 accent-[#c6982f]" />
                          민감상병 포함
                        </label>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[12px] text-slate-500">민감상병·자녀 정보를 포함하려면 고객에게 먼저 동의를 받으세요.</p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 인증 수단 (PASS 는 통신사 필요) */}
          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label htmlFor="hr-provider" className={labelCls}>간편인증 수단</label>
              <select id="hr-provider" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={lockParams} className={fieldCls}>
                {AUTH_PROVIDERS.map((p) => (
                  <option key={p.v} value={p.v}>{p.label}</option>
                ))}
              </select>
            </div>
            {needTelecom ? (
              <div>
                <label htmlFor="hr-telecom" className={labelCls}>통신사</label>
                <select id="hr-telecom" value={telecom} onChange={(e) => setTelecom(e.target.value)} disabled={lockParams} className={fieldCls}>
                  {TELECOMS.map((t) => (
                    <option key={t.v} value={t.v}>{t.label}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          {/* 직원 직접 입력(보조) — 식별번호 */}
          {inputMode === 'staff' ? (
            <div className="mt-2.5">
              {selected.idField === 'birth' ? (
                <>
                  <label htmlFor="hr-id" className={labelCls}>생년월일 (8자리)</label>
                  <input id="hr-id" value={idValue} onChange={(e) => setIdValue(e.target.value)} disabled={lockParams} inputMode="numeric" maxLength={8} placeholder="19900101" className={fieldCls} />
                </>
              ) : (
                <>
                  <label htmlFor="hr-id" className={labelCls}>주민등록번호 (13자리)</label>
                  <div className="relative">
                    <input id="hr-id" value={idValue} onChange={(e) => setIdValue(e.target.value)} disabled={lockParams} type={showRrn ? 'text' : 'password'} inputMode="numeric" maxLength={14} placeholder="앞 6자리 + 뒤 7자리" autoComplete="off"
                      className={`${fieldCls} pr-11`} />
                    <button type="button" onClick={() => setShowRrn((v) => !v)} aria-label={showRrn ? '주민번호 숨기기' : '주민번호 보기'} aria-pressed={showRrn}
                      className="absolute inset-y-0 right-0 mt-1 flex w-11 items-center justify-center text-slate-400 hover:text-slate-200">
                      {showRrn ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="mt-1 text-[12px] text-slate-500">주민번호는 보안 연결로 전송되며 화면·앱에 저장되지 않습니다.</p>
                </>
              )}
            </div>
          ) : null}

          {/* 현재 상태 + 다음 행동 하나 */}
          <div id="hr-phase" role="status" aria-live="polite" className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 ${phaseTone}`}>
            {phase === 'requesting' || phase === 'fetching' ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />}
            <div className="min-w-0">
              <div className="text-[14px] font-bold">{PHASE_TEXT[phase].title}{(phase === 'requesting' || phase === 'fetching') && busy ? ` · ${busySeconds}초` : ''}</div>
              <div className="text-[13px]">{PHASE_TEXT[phase].desc}</div>
              {phase === 'failed' && error ? <div className="mt-0.5 text-[12px] font-semibold">아래 오류 안내에서 원문을 확인할 수 있습니다.</div> : null}
            </div>
          </div>

          <div className="mt-3">
            {checkFirst ? (
              <button type="button" onClick={checkHistory} aria-describedby="hr-phase" className={`${primaryBtn} mb-2`}>
                <RefreshCw className="h-5 w-5" /> 최근 요청 확인 · 새로고침
              </button>
            ) : null}
            {phase === 'done' ? (
              <button type="button" onClick={scrollToResult} className={primaryBtn}>
                <Check className="h-5 w-5" /> 결과 보기
              </button>
            ) : inputMode === 'staff' ? (
              twoWay ? (
                <button type="button" onClick={() => void onConfirm()} disabled={Boolean(busy)} className={checkFirst ? secondaryBtn : primaryBtn}>
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />} 결과 조회
                </button>
              ) : (
                <button type="button" onClick={() => void onStart()} disabled={Boolean(busy) || !canStart} className={checkFirst ? secondaryBtn : primaryBtn}>
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />} {name.trim() ? `${name.trim()}님께 ` : ''}간편인증 요청
                </button>
              )
            ) : invite ? (
              <div className="rounded-xl border border-[#c6982f]/50 bg-[#fdf7ea] p-3">
                <div className="text-[13px] font-bold text-[#6b5216]">{invite.smsSent ? '링크 발급됨 · 문자 발송 완료' : '링크 발급됨 · 문자 미발송 — 복사하거나 카톡으로 보내세요'}</div>
                <input readOnly value={invite.url} aria-label="고객 인증 링크" className="mt-2 min-h-[40px] w-full min-w-0 rounded-lg border border-[#e2e8f0] bg-white px-2 text-[12px] text-[#334155]" />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => void copyInvite()} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-[#cbd5e1] bg-white text-[13px] font-bold text-[#0e1e3a]">
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copied ? '복사됨' : '링크 복사'}
                  </button>
                  <button type="button" onClick={shareInvite} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#FEE500] text-[13px] font-bold text-[#3c1e1e]">
                    <Share2 className="h-4 w-4" /> 카톡 보내기
                  </button>
                </div>
                <p className="mt-2 text-[12px] text-[#6b5216]">링크는 30분 동안 1회만 쓸 수 있습니다. 아직 조회 완료가 아닙니다 — 진행은 「최근 요청」에서 확인하세요.</p>
              </div>
            ) : (
              <button type="button" onClick={() => void onInvite()} disabled={inviteBusy || !canInvite} className={checkFirst ? secondaryBtn : primaryBtn}>
                {inviteBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Link2 className="h-5 w-5" />} {name.trim() ? `${name.trim()}님께 ` : ''}인증 링크 보내기
              </button>
            )}
            {phase !== 'done' && missingMsg && !(inputMode === 'staff' && twoWay) && !(inputMode === 'customer' && invite) ? (
              <p className="mt-1.5 text-[12px] text-slate-500">{missingMsg}</p>
            ) : null}

            {/* 보조 행동(작은 글자) */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
              {inputMode === 'staff' && (twoWay || phase === 'done') ? (
                <button type="button" onClick={() => void onStart()} disabled={Boolean(busy) || !canStart}
                  className="min-h-[36px] font-semibold text-slate-500 underline underline-offset-2 disabled:opacity-50">인증 다시 요청</button>
              ) : inputMode === 'customer' && (invite || phase === 'done') ? (
                <button type="button" onClick={() => void onInvite()} disabled={inviteBusy || !canInvite}
                  className="min-h-[36px] font-semibold text-slate-500 underline underline-offset-2 disabled:opacity-50">링크 다시 만들기</button>
              ) : <span />}
              <button type="button"
                onClick={() => {
                  const hadPending = dropForeground() // 입력방식 전환 — 이전 방식의 늦은 응답은 화면에 반영하지 않음
                  if (inputMode === 'customer') { setInputMode('staff'); setInvite(null); setCopied(false); setError(null) } else { setInputMode('customer'); setError(null) }
                  if (hadPending) setNotice(PREV_REQUEST_NOTE)
                }}
                className="min-h-[36px] font-semibold text-slate-500 underline underline-offset-2">
                {inputMode === 'customer' ? '직원이 직접 입력하기' : '고객 링크 방식으로 돌아가기'}
              </button>
            </div>
          </div>
        </section>
      </div>

      {result ? (
        <div id="hr-result">
          <ResultReport key={requestId ?? 'unsaved'} result={result} requestId={requestId} />
        </div>
      ) : null}

      {notice && !error ? <div className="rounded-xl border border-slate-800 bg-white px-4 py-2.5 text-[13px] font-semibold text-emerald-700">{notice}</div> : null}
      {error ? (
        <div id="hr-error" role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-800">
          <b>{errView.title}</b>
          <p className="mt-1">{errView.action}</p>
          {error.length > 80 ? (
            <details className="mt-1"><summary className="min-h-[32px] cursor-pointer text-[13px] font-semibold">오류 원문 보기</summary><p className="mt-1 break-words">{error}</p></details>
          ) : <p className="mt-1 break-words text-[13px]">오류: {error}</p>}
        </div>
      ) : null}

      {/* 최근 요청 — 완료 건은 30일간 저장되어 다시 열람 가능 */}
      <section aria-labelledby="hr-history" className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 id="hr-history" className="text-[15px] font-bold text-slate-100">최근 요청</h2>
          <button type="button" onClick={() => void refresh()} disabled={historyLoad.loading} aria-describedby="hr-history-status" className="inline-flex min-h-[44px] items-center gap-1 px-2 text-[13px] font-semibold text-slate-300 hover:text-slate-100 disabled:opacity-60">
            {historyLoad.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} 새로고침
          </button>
        </div>
        <div id="hr-history-status" role="status" aria-live="polite" className="text-[12px] text-slate-400">
          {historyLoad.loading ? '새로고침 중…' : historyLoad.failed ? null : historyLoad.lastOkAt ? `${new Date(historyLoad.lastOkAt).toLocaleTimeString('ko-KR')} 확인` : null}
        </div>
        {historyLoad.failed && !historyLoad.loading ? (
          <div role="alert" className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-[13px] text-rose-800">
            <span>목록을 불러오지 못했습니다{historyLoad.lastOkAt ? ` — 아래는 ${new Date(historyLoad.lastOkAt).toLocaleTimeString('ko-KR')} 기준 이전 목록` : ''}.</span>
            <button type="button" onClick={() => void refresh()} className="min-h-[44px] px-2 font-bold underline underline-offset-2">다시 시도</button>
          </div>
        ) : null}
        <p className="mt-0.5 text-[12px] text-slate-500">내가 조회한 건만 보입니다. 완료 결과는 {RETAIN_DAYS}일간 다시 열 수 있습니다.</p>
        <div className="relative mt-2">
          <input
            value={historyQuery}
            onChange={(e) => { onHistorySearch(e.target.value); setHistoryLimit(HISTORY_PAGE) }}
            placeholder="고객 이름으로 검색"
            aria-label="최근 요청 고객 이름 검색"
            className="min-h-[44px] w-full rounded-lg border border-slate-700 bg-white py-2 pl-8 pr-10 text-[14px] text-[#0f172a] placeholder:text-[#94a3b8] outline-none focus:border-[#c6982f]"
          />
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94a3b8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>
          {historyQuery ? <button type="button" onClick={() => { onHistorySearch(''); setHistoryLimit(HISTORY_PAGE) }} aria-label="검색어 지우기" className="absolute inset-y-0 right-0 w-10 text-[13px] font-semibold text-[#64748b]">✕</button> : null}
        </div>
        {staleSearch ? (
          <p className="mt-1 text-[13px] font-semibold text-[#6b5216]">
            {historyLoad.loading ? `'${historyQuery.trim() || '전체'}' 검색 중…` : `'${historyQuery.trim() || '전체'}' 검색 실패.`} 아래는 {historyLoad.shownQuery.trim() ? `'${historyLoad.shownQuery.trim()}' 검색` : '전체'} 목록입니다.
          </p>
        ) : null}
        {history.length === 0 ? (
          <p className="mt-2 text-[13px] text-slate-500">
            {historyLoad.lastOkAt === null
              ? (historyLoad.failed ? '아직 목록을 확인하지 못했습니다.' : '불러오는 중…')
              : historyLoad.shownQuery.trim() ? `'${historyLoad.shownQuery.trim()}' 검색 결과가 없습니다.` : '아직 요청이 없습니다.'}
          </p>
        ) : (
          <div className="mt-2 divide-y divide-slate-800">
            {visibleHistory.map((h) => {
              const age = daysSince(h.createdAt)
              const act = historyRowAction(h, age, RETAIN_DAYS)
              const canViewRow = act.canOpen
              return (
                <div key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5">
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold text-slate-200">{h.customerName || '고객 미지정'}</span>
                      <StatusBadge status={h.status} />
                    </div>
                    <div className="text-[12px] text-slate-500">{new Date(h.createdAt).toLocaleString('ko-KR')}</div>
                    <div className={`text-[13px] ${act.tone === 'error' ? 'text-rose-800' : act.tone === 'open' ? 'text-emerald-800' : act.tone === 'wait' ? 'text-[#6b5216]' : 'text-slate-400'}`}>{act.text}</div>
                    {h.status === 'failed' && h.error && h.error.length > 60 ? (
                      <details className="text-[12px] text-slate-400"><summary className="min-h-[28px] cursor-pointer">오류 원문</summary><p className="break-words">{h.error}</p></details>
                    ) : h.status === 'failed' && h.error ? <div className="break-words text-[12px] text-slate-400">오류: {h.error}</div> : null}
                  </div>
                  {canViewRow ? (
                    <button type="button" onClick={() => viewSaved(h)}
                      className="min-h-[40px] shrink-0 rounded-lg border border-slate-700 bg-white px-3 text-[13px] font-bold text-slate-200 transition hover:bg-slate-950">
                      결과 열기
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
        {hiddenCount > 0 || historyLimit > HISTORY_PAGE ? (
          <div className="mt-2 flex gap-2">
            {hiddenCount > 0 ? (
              <button type="button" onClick={() => setHistoryLimit((n) => n + HISTORY_PAGE)}
                className="min-h-[44px] flex-1 rounded-lg border border-[#cbd5e1] bg-white text-[13px] font-bold text-[#334155]">
                더보기 (남은 {hiddenCount}건)
              </button>
            ) : null}
            {historyLimit > HISTORY_PAGE ? (
              <button type="button" onClick={() => setHistoryLimit(HISTORY_PAGE)}
                className="min-h-[44px] rounded-lg px-3 text-[13px] font-semibold text-slate-500">접기</button>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}

/** 상단 단계 안내 — 1 고객 선택 → 2 본인인증 → 3 결과 확인 (표시 전용). */
function StepGuide({ current }: { current: 1 | 2 | 3 }): JSX.Element {
  const steps = ['고객 선택', '본인인증', '결과 확인']
  return (
    <ol className="mt-3 flex items-center gap-1.5" aria-label="조회 단계">
      {steps.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3
        const done = n < current || (n === 3 && current === 3)
        const active = n === current
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-1.5" aria-current={active ? 'step' : undefined}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-extrabold ${
              done ? 'bg-[#c6982f] text-[#0e1e3a]' : active ? 'bg-white text-[#0e1e3a]' : 'bg-white/15 text-white/70'}`}>
              {done ? <Check className="h-3.5 w-3.5" /> : n}
            </span>
            <span className={`truncate text-[12px] font-bold ${active || done ? 'text-white' : 'text-white/60'}`}>{label}</span>
            {i < steps.length - 1 ? <span aria-hidden className="h-px min-w-2 flex-1 bg-white/25" /> : null}
          </li>
        )
      })}
    </ol>
  )
}

type ResultTab = 'summary' | 'claims' | 'review'

/** 결과 렌더러 — 응답 안의 모든 목록을 섹션별 표로. 각 섹션은 데이터 모양으로
 *  진료(카테고리 보고서)/약품·기타(상세 표)를 자동 구분한다. */
export function ResultReport({ result, requestId }: { result: Record<string, unknown>; requestId?: string }): JSX.Element {
  const [tab, setTab] = useState<ResultTab>('summary')
  // 기본 표시 기간: 최근 3개월. 저장된 결과의 표시 필터일 뿐 새 기관 조회·인증·AI 요청을 일으키지 않는다.
  const [carePeriod, setCarePeriod] = useState<CarePeriod>('3m')
  const filteredResult = useMemo(() => filterCareResult(result, carePeriod), [result, carePeriod])
  const [underwritingContext, setUnderwritingContext] = useState<HrUnderwritingContext>({ insurers: [], guides: [], exceptions: [] })
  // 표시 전용 메타데이터 — AI 답변 초기화 의존성에 넣지 않는다(기준 내용 변경은 underwritingContext가 담당).
  const [guideStatus, setGuideStatus] = useState<GuideLoadStatus>('idle')
  const [detailView, setDetailView] = useState<'episodes' | 'disease' | 'sections' | 'raw'>('episodes')
  const [groupBy, setGroupBy] = useState<GroupBy>('year')
  const [detailOpen, setDetailOpen] = useState(false)
  const sections = useMemo(() => collectSections(filteredResult), [filteredResult])
  const raw = useMemo(() => JSON.stringify(result, null, 2), [result])
  // 자료 안내용 — 실제 기록에 포함된 날짜 범위(요청 기간 전체가 조회됐다는 뜻은 아님).
  const careSpan = useMemo(() => { const s = careListSummary(result, "all"); return s.oldest ? `${ymd(s.oldest)} ~ ${ymd(s.latest)}` : "" }, [result])
  const diseases = useMemo(() => summarizeByDisease(collectHrSections(filteredResult)), [filteredResult])
  const episodes = useMemo(() => summarizeEpisodes(collectHrSections(filteredResult)), [filteredResult])
  const careRecords = useMemo(() => buildCareRecords(filteredResult), [filteredResult])
  const userNm = useMemo(() => {
    for (const s of sections) {
      const n = userNameOf(s.rows)
      if (n) return n
    }
    return String(result?.resUserNm ?? '')
  }, [sections, result])

  // AI 요약/질문
  const [aiBusy, setAiBusy] = useState(false)
  const [aiAnswer, setAiAnswer] = useState<string | null>(null)
  const [aiErr, setAiErr] = useState<string | null>(null)
  const [aiQ, setAiQ] = useState('')
  const aiGeneration = useRef(0)
  useEffect(() => {
    ++aiGeneration.current
    setAiAnswer(null); setAiErr(null); setAiBusy(false)
    return () => { ++aiGeneration.current }
  }, [result, carePeriod, underwritingContext])
  const runAi = async (): Promise<void> => {
    const generation = ++aiGeneration.current
    setAiBusy(true)
    setAiErr(null)
    try {
      const r = await askHealthRecordAi(filteredResult, aiQ, underwritingContext)
      if (aiGeneration.current !== generation) return
      if (r.ok) setAiAnswer(r.answer ?? '')
      else { setAiAnswer(null); setAiErr(r.error ?? 'AI 요청 실패') }
    } finally {
      if (aiGeneration.current === generation) setAiBusy(false)
    }
  }

  const tabs: { id: ResultTab; label: string; hint: string; guide: string }[] = [
    { id: 'summary', label: '한눈에 요약', hint: '핵심·최근 진료', guide: '' },
    { id: 'claims', label: '청구 관리', hint: '청구 상태 확인', guide: '기록을 검색·선택해 청구 상태(수동 확인)를 저장하고 목록을 출력합니다.' },
    { id: 'review', label: '가입 검토', hint: '기준 조회·AI', guide: '건강기록과 등록된 기준을 연결해 상담 시 확인할 내용을 정리합니다.' }
  ]
  const activeTab = tabs.find((t) => t.id === tab) ?? tabs[0]
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    setTab(next.id)
    document.getElementById(`hr-tab-${next.id}`)?.focus()
  }
  const periodRange = carePeriod === 'all' ? '조회된 기록 전체' : `${ymd(periodStart(carePeriod))} ~ ${ymd(localYmd())}`
  const detailOptions: { id: typeof detailView; label: string }[] = [
    { id: 'episodes', label: `병명별 묶음${episodes.length ? ` ${episodes.length}` : ''}` },
    { id: 'disease', label: `병명별 집계${diseases.length ? ` ${diseases.length}` : ''}` },
    { id: 'sections', label: '진료순' },
    ...(Object.keys(result).length ? [{ id: 'raw' as const, label: '원자료' }] : [])
  ]

  return (
    <div className="min-w-0 rounded-2xl border border-slate-800 bg-white p-3 shadow-sm sm:p-4">
      <h2 className="break-words text-[15px] font-bold text-slate-100">
        조회 결과
        {userNm ? <span className="text-slate-400"> · {userNm}</span> : null}
      </h2>

      {/* 목적별 3탭 — 이름 + 짧은 설명, 활성 탭은 남색 바탕 + 금색 밑줄. */}
      <div role="tablist" aria-label="조회 결과 보기" className="mt-3 grid grid-cols-3 gap-1.5">
        {tabs.map((t, i) => (
          <button key={t.id} id={`hr-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id} aria-controls="hr-result-panel"
            tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)} onKeyDown={(e) => onTabKey(e, i)}
            className={`flex min-h-14 min-w-0 flex-col items-center justify-center rounded-xl border-2 px-1 py-1.5 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c6982f] ${tab === t.id ? 'border-[#0e1e3a] border-b-[#c6982f] bg-[#0e1e3a] text-white shadow-sm' : 'border-slate-800 bg-white text-slate-200 hover:bg-slate-950'}`}>
            <span className="text-[14px] font-bold leading-tight">{t.label}</span>
            <span className={`mt-0.5 text-[11px] leading-tight ${tab === t.id ? 'text-[#e6c877]' : 'text-slate-500'}`}>{t.hint}</span>
          </button>
        ))}
      </div>
      {activeTab.guide ? <p className="mt-2 text-[13px] leading-snug text-slate-400">{activeTab.guide}</p> : null}

      {/* 공통 기간 — 핵심 숫자·최근 진료·자세히 보기·청구·가입 검토·AI 입력에 같은 기간을 적용한다(저장된 결과의 표시 필터). */}
      <div className="mt-2 rounded-xl border border-[#e8d6a8] bg-[#fdf7ea]/60 px-3 py-2" role="group" aria-labelledby="hr-period-title">
        <span id="hr-period-title" className="sr-only">기간 선택</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {CARE_PERIODS.map((p) => (
            <button key={p.value} type="button" aria-pressed={carePeriod === p.value} onClick={() => setCarePeriod(p.value)}
              className={`min-h-11 rounded-full border px-3.5 text-[13px] font-bold ${carePeriod === p.value ? 'border-[#c6982f] bg-[#fdf7ea] text-[#0e1e3a] ring-1 ring-[#c6982f]' : 'border-slate-700 bg-white text-slate-300'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-slate-500" aria-live="polite">{periodRange}</p>
      </div>

      <div id="hr-result-panel" role="tabpanel" aria-labelledby={`hr-tab-${tab}`}>
        {/* 같은 위치(패널 첫 자식)에 한 번만 마운트 — 탭은 표시 모드만 바꾼다(청구 상태·검색·선택·기준 조회 유지, 저장 API 재호출 없음). */}
        <HealthRecordWorkspace result={filteredResult} requestId={requestId} period={carePeriod} mode={tab} onContextChange={setUnderwritingContext} onGuideStatusChange={setGuideStatus} />

        {tab === 'summary' ? (
          <>
            {/* 최근 진료 — 핵심 숫자와 같은 공통 기간·같은 기록으로 계산(고정 3개월 예외 없음). */}
            <RecentCareTable result={result} period={carePeriod} onShowAll={() => setCarePeriod('all')} />

            {/* 자세히 보기 — 한 개의 접힌 영역에서 보기 방식을 선택한다(기본: 병명별 묶음). 원자료는 이 안에서만. */}
            <section className="mt-3 rounded-xl border border-slate-800" aria-labelledby="hr-detail-toggle">
              <button id="hr-detail-toggle" type="button" onClick={() => setDetailOpen((v) => !v)} aria-expanded={detailOpen} aria-controls="hr-detail-body"
                className="flex min-h-12 w-full items-center gap-2 rounded-xl px-3 text-left text-[14px] font-bold text-slate-100 hover:bg-slate-950">
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${detailOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                자세히 보기
                <span className="ml-auto text-[12px] font-semibold text-slate-400">{detailOpen ? '접기' : '펼치기'}</span>
              </button>
              {detailOpen ? (
                <div id="hr-detail-body" className="border-t border-slate-800 p-3">
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="상세 기록 보기 방식">
                    {detailOptions.map((o) => (
                      <button key={o.id} type="button" aria-pressed={detailView === o.id} onClick={() => setDetailView(o.id)}
                        className={`min-h-11 rounded-lg border px-3 text-[13px] font-bold ${detailView === o.id ? 'border-[#0e1e3a] bg-[#0e1e3a] text-white' : 'border-slate-700 bg-white text-slate-300'}`}>
                        {o.label}
                      </button>
                    ))}
                    {detailView === 'sections' ? (
                      <>
                        <span className="mx-1 text-slate-300" aria-hidden="true">|</span>
                        <HrChip active={groupBy === 'year'} onClick={() => setGroupBy('year')}>연도별</HrChip>
                        <HrChip active={groupBy === 'month'} onClick={() => setGroupBy('month')}>월별</HrChip>
                      </>
                    ) : null}
                  </div>
                  {detailView === 'raw' ? (
                    <>
                      <p className="mt-2 text-[12px] text-slate-500">원자료는 기간 선택과 관계없이 조회된 전체 응답입니다.</p>
                      <pre className="mt-1 max-h-80 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 text-[12px] leading-relaxed text-slate-100">{raw}</pre>
                    </>
                  ) : sections.length === 0 ? (
                    <p className="mt-2 text-[13px] text-slate-500">선택한 기간에 조회된 기록이 없습니다.</p>
                  ) : detailView === 'episodes' ? (
                    <div className="mt-3"><EpisodeView episodes={episodes} records={careRecords} /></div>
                  ) : detailView === 'disease' ? (
                    <div className="mt-3"><DiseaseSummaryView diseases={diseases} /></div>
                  ) : (
                    <div className="mt-3 space-y-5">
                      {sections.map((s) => (
                        <div key={s.key}>
                          {sections.length > 1 ? (
                            <div className="mb-1.5 flex items-center gap-2">
                              <span className="rounded-full bg-[#0e1e3a] px-2.5 py-0.5 text-[12px] font-bold text-white">{s.label}</span>
                              <span className="text-[12px] font-semibold text-slate-400">{s.rows.length}건</span>
                            </div>
                          ) : null}
                          {SECTION_SPECS[s.key] ? (
                            <SpecTable cols={SECTION_SPECS[s.key]} records={s.rows} groupBy={groupBy} />
                          ) : isTreatmentShape(s.rows) ? (
                            <TreatmentReport records={s.rows} />
                          ) : (
                            <GenericTable records={s.rows} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            {/* 자료 안내 — 처리 방식·자료 범위 설명을 한곳에 접어 둔다. 값의 의미(추정·미확인)는 각 값 옆에 짧게 남긴다. */}
            <details className="mt-3 rounded-xl border border-slate-800 px-3 py-1">
              <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-bold text-slate-300">자료 안내</summary>
              <ul className="list-disc space-y-1 pb-2 pl-5 text-[13px] leading-relaxed text-slate-400">
                <li>기간 버튼은 이미 조회된 자료를 나눠 보여줄 뿐 새로 조회하지 않으며, 해당 기간 자료가 모두 조회됐다는 뜻이 아닙니다.{careSpan ? ` 조회된 자료의 날짜: ${careSpan}.` : ''}</li>
                <li>날짜가 확인되지 않은 기록은 ‘전체’에서만 보입니다.</li>
                <li>기록이 없거나 적다는 것이 건강 이상 없음·가입 가능·수술 없음·청구 가능을 뜻하지 않습니다. 조회 기간·기관 범위가 부족할 수 있습니다.</li>
                <li>진료기록은 조회된 기록 건수입니다(방문 횟수가 아님).</li>
                <li>입원일수는 같은 날짜·기관의 최대값을 한 번 합산한 추정치입니다. 일수가 없는 입원은 0일로 세지 않고 ‘일수 미확인’으로 따로 표시합니다.</li>
                <li>수술 추정과 처방약·병명 연결은 치료 명칭과 진료일·기관 일치로 추정한 것이며 의학적 확정이 아닙니다.</li>
                <li>최근 기록은 고지 확인용 참고이며 고지 의무·인수 여부를 확정하지 않습니다. 청구 여부는 ‘청구 관리’ 탭에서 확인하세요.</li>
              </ul>
            </details>
          </>
        ) : null}

        {tab === 'review' ? (
          <section className="mt-3 rounded-xl border border-slate-800 bg-white p-3" aria-label="AI 참고 요약">
            <h3 className="text-[14px] font-bold text-slate-100">3. AI 참고 요약</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-400">선택 기간 건강기록과 2단계에서 연결된 기준을 함께 검토합니다. 버튼을 누를 때만 AI를 호출합니다.</p>
            {(() => {
              // 기준 상태 안내 — AI 실행을 막지 않고, 실제 AI에 전송되는 검수된 기준 수만 알린다(조회 중에는 끝난 뒤 실행).
              const note = aiGuideNote(guideStatus, underwritingContext)
              return <p data-ai-guide-note className={`mt-1 text-[13px] ${note.warn ? 'text-rose-700' : 'text-[#0e1e3a]'}`}>{note.text}</p>
            })()}
            {sections.length === 0 ? (
              <p className="mt-2 text-[13px] text-slate-500">선택한 기간에 기록이 없어 AI 요약을 요청할 수 없습니다.</p>
            ) : (
              <div className="mt-2 space-y-2">
                <details className="rounded-lg border border-slate-800 px-3">
                  <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-bold text-slate-300">질문 추가 (선택){aiQ.trim() ? ' · 입력됨' : ''}</summary>
                  <input value={aiQ} onChange={(e) => setAiQ(e.target.value)} aria-label="AI에게 질문(선택)" placeholder="예: 최근 2년 입원·수술 정리해줘"
                    className="mb-2 min-h-11 w-full min-w-0 rounded-lg border border-slate-700 bg-white px-3 text-[14px] text-slate-100" />
                </details>
                <button type="button" onClick={() => void runAi()} disabled={aiBusy || guideStatus === 'loading'}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-lg bg-[#0e1e3a] px-4 text-[13px] font-bold text-white disabled:opacity-50 sm:w-auto">
                  {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4 text-[#e6c877]" aria-hidden="true" />}
                  {aiBusy ? '분석 중…' : aiErr ? '다시 시도' : aiAnswer !== null ? 'AI 요약 다시 받기' : 'AI 참고 요약 받기'}
                </button>
              </div>
            )}
            {aiBusy ? <p role="status" className="mt-2 text-[13px] text-slate-500">AI가 분석 중입니다…</p> : null}
            {aiErr && !aiBusy ? <p role="alert" className="mt-2 break-words text-[13px] font-semibold text-rose-700">AI 요약 실패: {aiErr} — ‘다시 시도’를 누르세요.</p> : null}
            {aiAnswer !== null && !aiBusy ? (
              <div className="mt-2">
                <p role="status" className="text-[12px] font-bold text-[#0e1e3a]">요약 완료 · 상담 참고용</p>
                <div className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-[13px] leading-relaxed text-slate-100">{aiAnswer || '(빈 응답)'}</div>
              </div>
            ) : null}
            <p className="mt-2 text-[12px] leading-relaxed text-slate-500">식별자는 보내지 않고 비식별 요약만 전달합니다 · 병명·수술·투약 연결은 추정이며, 보험사 최종 심사·가입 가능 여부를 확정하지 않습니다.</p>
          </section>
        ) : null}

        {/* 실손 예상(시나리오) — 청구 탭의 접힌 영역. 항상 마운트해 탭 전환에도 입력·계산 상태를 유지한다. */}
        <details className="mt-3 rounded-xl border border-slate-800 p-3" hidden={tab !== 'claims'}>
          <summary className="min-h-9 cursor-pointer py-1 text-[13px] font-bold text-slate-100">추가 확인: 실손 예상액</summary>
          <SonsonEstimator />
        </details>
      </div>
    </div>
  )
}

/** 수술 부위 일러스트 — 인체 실루엣 + 해당 부위 강조점(실제 수술 사진 아님, 부위 안내용). */
const PART_POS: Record<PartGroup, { x: number; y: number } | null> = {
  brain: { x: 24, y: 9 }, eye: { x: 24, y: 12 }, ent: { x: 24, y: 15 }, dental: { x: 24, y: 16 },
  shoulder: { x: 37, y: 24 }, chest: { x: 24, y: 28 }, heart: { x: 21, y: 29 }, breast: { x: 28, y: 30 },
  spine: { x: 24, y: 36 }, abdomen: { x: 24, y: 40 }, uro: { x: 24, y: 49 }, ob: { x: 24, y: 49 },
  hip: { x: 24, y: 53 }, hand: { x: 9, y: 45 }, knee: { x: 19, y: 67 }, foot: { x: 19, y: 83 },
  skin: { x: 30, y: 34 }, other: null
}
function SurgeryIcon({ group, className }: { group: PartGroup; className?: string }): JSX.Element {
  const pos = PART_POS[group] ?? null
  return (
    <svg viewBox="0 0 48 96" className={className} aria-hidden="true">
      <g fill="#cbd5e1">
        <circle cx="24" cy="11" r="8" />
        <rect x="14" y="21" width="20" height="30" rx="9" />
        <rect x="5" y="23" width="7" height="23" rx="3.5" />
        <rect x="36" y="23" width="7" height="23" rx="3.5" />
        <rect x="16" y="50" width="7" height="35" rx="3.5" />
        <rect x="25" y="50" width="7" height="35" rx="3.5" />
      </g>
      {pos ? (
        <>
          <circle cx={pos.x} cy={pos.y} r="8" fill="#f43f5e" opacity="0.18" />
          <circle cx={pos.x} cy={pos.y} r="4.5" fill="#f43f5e" />
        </>
      ) : null}
    </svg>
  )
}

/**
 * 수술 1회(시행) — 같은 날·기관의 수술 라인아이템을 하나로 묶은 단위.
 * 행/일러스트를 누르면 상세(큰 그림 + 부위 + 수술명별 세부 후유장해 + 보험 확인 포인트)가 펼쳐진다.
 * 단순 처치는 호출부에서 제외(isSurgery 만 묶음). 후유장해는 **일반 참고**(확정 아님).
 */
function SurgeryRow({ occ }: { occ: SurgeryOccasion }): JSX.Element {
  const [open, setOpen] = useState(false)
  const { label, seq } = sequelaeForSurgery(occ.primaryName, occ.partGroup)
  const others = occ.names.filter((n) => n !== occ.primaryName)
  return (
    <li className="overflow-hidden rounded-lg border border-[#fecdd3] bg-rose-50/40">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-2 p-1.5 text-left hover:bg-[#fff1f2]">
        <SurgeryIcon group={occ.partGroup} className="mt-0.5 h-9 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[11px] font-extrabold text-white">수술</span>
            {occ.bodyPart ? <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-bold text-amber-800">부위: {occ.bodyPart}</span> : null}
            <span className="text-[12px] font-semibold text-slate-100">{occ.primaryName}</span>
            {others.length ? <span className="text-[11px] text-slate-400">외 {others.length}건</span> : null}
          </div>
          <div className="mt-0.5 text-[12px] text-slate-500">{ymd(occ.date)}{occ.hospital ? ` · ${occ.hospital}` : ''}</div>
        </div>
        <span className="mt-0.5 shrink-0 text-[11px] font-semibold text-rose-600">{open ? '닫기' : '자세히'}</span>
      </button>

      {open ? (
        <div className="border-t border-[#ffe4e6] bg-white p-2.5">
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-lg border border-slate-800 bg-[#f8fafc] p-1.5">
              <SurgeryIcon group={occ.partGroup} className="h-20 w-11" />
            </div>
            <div className="min-w-0 flex-1 text-[12px]">
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-slate-100"><b>수술명</b> · {occ.primaryName}</span>
                {label ? <span className="rounded-full bg-[#ffe4e6] px-2 py-0.5 text-[11px] font-bold text-rose-700">{label}</span> : null}
              </div>
              <div className="mt-0.5 text-slate-300"><b>추정 부위</b> · {occ.bodyPart || '부위 추정 어려움(명칭 기반)'}</div>
              <div className="mt-0.5 text-[12px] text-slate-500">{ymd(occ.date)}{occ.hospital ? ` · ${occ.hospital}` : ''}</div>
              {others.length ? <div className="mt-0.5 text-[12px] text-slate-500">같은 날 항목: {others.join(', ')}</div> : null}
            </div>
          </div>

          <div className="mt-2 rounded-lg border border-[#fde68a] bg-amber-50 p-2">
            <div className="flex items-center gap-1 text-[12px] font-extrabold text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" /> 후유장해 가능성{label ? ` · ${label}` : ''}(일반 참고)
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-amber-900">
              {seq.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <div className="mt-1.5 rounded-md bg-white/70 px-2 py-1 text-[12px] font-semibold text-amber-800 ring-1 ring-[#fde68a]">
              💡 보험 확인: {seq.insurancePoint}
            </div>
          </div>

          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
            ※ 위 후유장해는 해당 수술에서 <b>일반적으로 거론되는 유형</b>일 뿐, 실제 발생 여부·정도는 개인·수술 범위에 따라 다릅니다. 보험상 후유장해는 <b>의료진 진단과 약관의 후유장해분류표(지급률)</b>로 확정되며, 수술명·부위도 <b>명칭 기반 추정</b>입니다. 의학적·보험적 확정이 아닙니다.
          </p>
        </div>
      ) : null}
    </li>
  )
}

function HrChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button type="button" onClick={onClick}
      className={`min-h-11 rounded-full border px-3 py-1 text-[13px] font-bold ${active ? 'border-[#c6982f] bg-[#fdf7ea] text-[#8a6a1f]' : 'border-slate-700 bg-white text-slate-400'}`}>
      {children}
    </button>
  )
}

/** 상병(병명)별 추정 묶음 — 방문수·기간·병원·수술·투약을 카드로. */
function DiseaseSummaryView({ diseases }: { diseases: DiseaseSummary[] }): JSX.Element {
  if (!diseases.length) return <p className="text-[12px] text-slate-500">상병명이 있는 진료내역이 없어 상병별 요약을 만들 수 없습니다.</p>
  const period = (a: string, b: string): string => (a && b ? `${ymd(a)} ~ ${ymd(b)}` : a ? ymd(a) : '')
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-slate-500">같은 병명(표기 기준)으로 묶은 <b>추정</b> 요약 — 수술·투약은 (진료일·기관) 일치로 연결했습니다. 표기가 다르면 같은 질환도 분리될 수 있어요(의학적 확정 아님).</p>
      <ul className="grid gap-2 lg:grid-cols-2">
        {diseases.map((d) => {
          const flags = diseaseFlags(d)
          const emphasize = flags.length > 0
          const occasions = groupSurgeryOccasions(d.surgeries)
          return (
          <li key={d.disease} className={`rounded-xl border bg-white p-3 shadow-sm ${emphasize ? 'border-rose-300 ring-1 ring-[#fecdd3]' : 'border-slate-800'}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] font-bold text-slate-100">{d.disease}</span>
              <span className="rounded-full bg-[#0e1e3a] px-2 py-0.5 text-[11px] font-bold text-white">{d.visitCount}회 방문</span>
              {d.inpatientVisits > 0 ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-extrabold text-white">입원 {d.inpatientVisits}</span> : null}
              {occasions.length ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-[#fecdd3]">수술 {occasions.length}회</span> : null}
              {d.outpatientVisits >= 7 ? <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-extrabold text-amber-800">통원 {d.outpatientVisits}회</span> : null}
            </div>
            <div className="mt-1 text-[12px] text-slate-500">
              {period(d.firstDate, d.lastDate)}
              {d.departments.length ? ` · ${d.departments.join('/')}` : ''}
              {d.selfPayTotal ? ` · 본인부담 ${won(d.selfPayTotal)}` : ''}
            </div>
            {d.hospitals.length ? <div className="mt-0.5 text-[12px] text-slate-400">병원: {d.hospitals.join(', ')}</div> : null}

            {occasions.length ? (
              <div className="mt-1.5">
                <div className="text-[11px] font-semibold text-slate-500">수술 {occasions.length}회(추정) — 누르면 부위·후유장해 안내. 단순 처치 제외, 같은 날 수술은 1회로 묶음.</div>
                <ul className="mt-1 space-y-1.5">
                  {occasions.map((occ, i) => (
                    <SurgeryRow key={i} occ={occ} />
                  ))}
                </ul>
              </div>
            ) : null}

            {d.medications.length ? (
              <div className="mt-1.5">
                <div className="text-[11px] font-semibold text-slate-500">투약(추정)</div>
                <ul className="mt-0.5 space-y-0.5">
                  {d.medications.map((x, i) => (
                    <li key={i} className="text-[12px] text-slate-300">
                      <span className="font-medium text-slate-200">{x.name}</span>
                      {x.ingredient ? <span className="ml-1 text-[12px] text-slate-500">{x.ingredient}</span> : ''}
                      {x.days ? <span className="ml-1 text-[12px] text-slate-500">· {x.days}일분</span> : ''}
                      <span className="ml-1 text-[12px] text-slate-500">· {ymd(x.date)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * 에피소드 묶음 — 같은 병명 + 비슷한 시기(약 EPISODE_GAP_DAYS일 이내)를 한 카드로.
 * 카드를 누르면 방문·수술·투약 상세가 펼쳐진다(기본 접힘 — 한눈에 보기 쉽게).
 */
function EpisodeView({ episodes, records }: { episodes: DiseaseEpisode[]; records: CareRecord[] }): JSX.Element {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  if (!episodes.length) return <p className="text-[12px] text-slate-500">상병명이 있는 진료내역이 없어 묶음을 만들 수 없습니다.</p>
  const idOf = (e: DiseaseEpisode, i: number): string => `${e.disease}|${e.firstDate}|${e.lastDate}|${i}`
  const toggle = (id: string): void =>
    setOpen((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const period = (a: string, b: string): string => (a && b ? (a === b ? ymd(a) : `${ymd(a)} ~ ${ymd(b)}`) : a ? ymd(a) : b ? ymd(b) : '날짜미상')

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-slate-500">
        같은 병명을 <b>비슷한 시기(약 {EPISODE_GAP_DAYS}일 이내)</b>로 묶었습니다. 카드를 <b>누르면</b> 방문·수술·투약 상세가 펼쳐져요. (추정 — 수술·투약은 진료일·기관 매칭, 의학적 확정 아님)
      </p>
      <ul className="space-y-2">
        {episodes.map((e, i) => {
          const id = idOf(e, i)
          const isOpen = open.has(id)
          const occasions = groupSurgeryOccasions(e.surgeries)
          const surgCount = occasions.length
          const emphasize = e.inpatient || surgCount > 0 || e.selfPayTotal >= BIG_SELFPAY_THRESHOLD
          const admission = admissionSummary(records.filter(r=>normalizeDisease(r.disease)===e.disease && e.visits.some(v=>v.date===r.date && v.hospital===r.hospital)))
          return (
            <li key={id} className={`overflow-hidden rounded-xl border bg-white shadow-sm ${emphasize ? 'border-rose-300 ring-1 ring-[#fecdd3]' : 'border-slate-800'}`}>
              <button type="button" onClick={() => toggle(id)} aria-expanded={isOpen} className="flex w-full items-start gap-2 p-3 text-left hover:bg-[#f8fafc]">
                <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-bold text-slate-100">{e.disease}</span>
                    <span className="rounded-full bg-[#0e1e3a] px-2 py-0.5 text-[11px] font-bold text-white">방문 {e.visitCount}회</span>
                    {e.inpatient ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-extrabold text-white">입원 {admission.knownDays?`${admission.knownDays}일`:'일수 확인 필요'}{admission.knownDays && admission.unknown?' + 미확인':''}</span> : null}
                    {surgCount ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-[#fecdd3]">수술 {surgCount}회</span> : null}
                    {e.selfPayTotal >= BIG_SELFPAY_THRESHOLD ? <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-extrabold text-amber-800">고액</span> : null}
                  </div>
                  <div className="mt-0.5 text-[12px] text-slate-500">
                    {period(e.firstDate, e.lastDate)}
                    {e.departments.length ? ` · ${e.departments.join('/')}` : ''}
                    {e.selfPayTotal ? ` · 본인부담 ${won(e.selfPayTotal)}` : ''}
                  </div>
                </div>
                <span className="mt-0.5 shrink-0 text-[11px] font-semibold text-slate-400">{isOpen ? '접기' : '상세'}</span>
              </button>

              {isOpen ? (
                <div className="border-t border-slate-800 px-3 pb-3 pt-2.5">
                  {e.hospitals.length ? <div className="text-[12px] text-slate-400">병원: {e.hospitals.join(', ')}</div> : null}

                  <div className="mt-1.5">
                    <div className="text-[11px] font-semibold text-slate-500">방문 내역 ({e.visitCount}회)</div>
                    <ul className="mt-1 space-y-1">
                      {e.visits.map((v, vi) => (
                        <li key={vi} className="flex flex-wrap items-center gap-1.5 text-[12px]">
                          <span className="rounded-md bg-[#eef2f7] px-2 py-0.5 text-[12px] font-bold text-[#334155] ring-1 ring-[#e2e8f0]">{ymd(v.date) || '날짜미상'}</span>
                          {v.inpatient ? (
                            <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[11px] font-extrabold text-white">입원</span>
                          ) : v.type ? (
                            <span className="rounded bg-[#eef2f7] px-1.5 py-0.5 text-[11px] font-semibold text-[#334155] ring-1 ring-[#e2e8f0]">{v.type}</span>
                          ) : null}
                          <span className="text-slate-200">{v.hospital || '-'}</span>
                          {v.selfPay ? <span className="text-[12px] text-slate-500">· {won(v.selfPay)}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {occasions.length ? (
                    <div className="mt-2">
                      <div className="text-[11px] font-semibold text-slate-500">수술 {occasions.length}회(추정) — 누르면 부위·후유장해 안내. 단순 처치 제외, 같은 날 수술은 1회로 묶음.</div>
                      <ul className="mt-1 space-y-1.5">
                        {occasions.map((occ, xi) => (
                          <SurgeryRow key={xi} occ={occ} />
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {e.medications.length ? (
                    <div className="mt-2">
                      <div className="text-[11px] font-semibold text-slate-500">투약(추정)</div>
                      <ul className="mt-0.5 space-y-0.5">
                        {e.medications.map((x, mi) => (
                          <li key={mi} className="text-[12px] text-slate-300">
                            <span className="font-medium text-slate-200">{x.name}</span>
                            {x.ingredient ? <span className="ml-1 text-[12px] text-slate-500">{x.ingredient}</span> : ''}
                            {x.days ? <span className="ml-1 text-[12px] text-slate-500">· {x.days}일분</span> : ''}
                            <span className="ml-1 text-[12px] text-slate-500">· {ymd(x.date)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** 건강보험공단 「진료받은 내용」 — 카테고리 보고서(진료형태별) + 상세 표. */
function TreatmentReport({ records }: { records: Row[] }): JSX.Element {
  const { cats, total } = useMemo(() => summarize(records), [records])
  return (
    <>
      <div className="mt-3">
        <div className="mb-1 text-[12px] font-semibold text-slate-400">카테고리 보고서 · 진료형태별</div>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-slate-950 text-slate-300">
                <th className="px-3 py-2 text-left font-semibold">진료형태</th>
                <th className="px-3 py-2 text-right font-semibold">건수</th>
                <th className="px-3 py-2 text-right font-semibold">본인부담금</th>
                <th className="px-3 py-2 text-right font-semibold">공단부담금</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {cats.map((c) => (
                <tr key={c.type}>
                  <td className="px-3 py-2 font-semibold">{c.type}</td>
                  <td className="px-3 py-2 text-right">{c.count}건</td>
                  <td className="px-3 py-2 text-right">{c.deductible.toLocaleString('ko-KR')}원</td>
                  <td className="px-3 py-2 text-right">{c.publicCharge.toLocaleString('ko-KR')}원</td>
                </tr>
              ))}
              <tr className="bg-[#fdf7ea] font-bold text-[#8a6a1f]">
                <td className="px-3 py-2">합계</td>
                <td className="px-3 py-2 text-right">{total.count}건</td>
                <td className="px-3 py-2 text-right">{total.deductible.toLocaleString('ko-KR')}원</td>
                <td className="px-3 py-2 text-right">{total.publicCharge.toLocaleString('ko-KR')}원</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 text-[12px] font-semibold text-slate-400">진료 상세 내역 · 치료/투약</div>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full whitespace-nowrap text-[12px]">
            <thead>
              <tr className="bg-slate-950 text-slate-300">
                <th className="px-3 py-2 text-left font-semibold">병의원·약국</th>
                <th className="px-3 py-2 text-left font-semibold">진료개시일</th>
                <th className="px-3 py-2 text-left font-semibold">진료형태(치료)</th>
                <th className="px-3 py-2 text-right font-semibold">처방횟수</th>
                <th className="px-3 py-2 text-right font-semibold">투약일수</th>
                <th className="px-3 py-2 text-right font-semibold">방문(입원)일수</th>
                <th className="px-3 py-2 text-right font-semibold">본인부담금</th>
                <th className="px-3 py-2 text-right font-semibold">공단부담금</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {records.map((r, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 font-medium">{String(r.resHospitalName ?? '') || '-'}</td>
                  <td className="px-3 py-2">{ymd(r.resTreatStartDate)}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-[#eef2f7] px-2 py-0.5 text-[12px] font-semibold text-[#334155] ring-1 ring-[#e2e8f0]">{String(r.resTreatType ?? '') || '-'}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{num(r.resPrescribeCnt)}회</td>
                  <td className="px-3 py-2 text-right font-semibold text-[#8a6a1f]">{num(r.resPrescribeDays)}일분</td>
                  <td className="px-3 py-2 text-right">{num(r.resVisitDays)}일</td>
                  <td className="px-3 py-2 text-right">{won(r.resDeductibleAmt)}</td>
                  <td className="px-3 py-2 text-right">{won(r.resPublicCharge)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          ※ 「진료받은 내용」(건강보험공단) 전 항목 — 진료형태(받은 치료 구분)·처방횟수·투약일수·방문(입원)일수·본인/공단 부담금. 개별 약품명은 「내가먹는약 한눈에」에서 확인하세요.
        </p>
      </div>
    </>
  )
}

/** CODEF 응답 필드 한글 라벨(알려진 것만 — 없으면 원래 키 표시). */
const FIELD_LABELS: Record<string, string> = {
  resUserNm: '성명',
  commStartDate: '조제일자',
  resPrescribeDate: '처방일자',
  resTreatDate: '처방일자',
  resPrescribeNo: '처방순번',
  resPharmacyName: '조제기관(약국)',
  resHospitalName: '처방기관(병원)',
  resTreatMeaning: '약품명',
  resDrugName: '약품명',
  resMedicineName: '약품명',
  resIngredientName: '성분명',
  resComponent: '성분',
  resPrescribeDays: '투약일수',
  resDosageDays: '투약일수',
  resOnceDosage: '1회 투약량',
  resDailyDosageCnt: '1일 투약횟수',
  resTotalDosageCnt: '총 투약횟수',
  resManufacturer: '제조사',
  resEfficacy: '효능·효과',
  resTelNo: '전화번호',
  resType: '구분',
  // 내진료정보열람(심평원) — 기관/병원·약국
  resHospitalNm: '처방기관(병원)',
  resCareInstNm: '진료기관(병원)',
  resMedicalInstNm: '의료기관',
  resPharmacyNm: '조제기관(약국)',
  resDrugInstNm: '조제기관(약국)',
  resInstitutionName: '의료기관',
  // 진료/치료·수술·상병
  resTreatName: '진료내용',
  resTreatContent: '진료내용',
  resTreatType: '진료형태',
  resOperationName: '수술명',
  resSurgeryName: '수술명',
  resSurgeryYn: '수술여부',
  resDiseaseName: '상병명',
  resSickName: '상병명',
  resDiagnosisName: '진단명',
  // 투약·방문·입원 일수
  resMedicationDays: '투약일수',
  resVisitDays: '방문/입원일수',
  resAdmissionDays: '입원일수',
  resHospitalizationDays: '입원일수',
  resHospDays: '입원일수',
  resVisitCnt: '방문횟수',
  resPrescribeCnt: '처방횟수',
  // 부담금
  resDeductibleAmt: '본인부담금',
  resPublicCharge: '공단부담금',
  resTreatStartDate: '진료개시일',
  resChildYn: '자녀구분'
}
const labelOf = (k: string): string => FIELD_LABELS[k] ?? k
const cellOf = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '-'
  if (Array.isArray(v)) return `${v.length}건`
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 약품/기타 상품 — 응답 필드를 그대로 상세 표로. 알려진 날짜/라벨은 보기 좋게. */
function GenericTable({ records }: { records: Row[] }): JSX.Element {
  const columns = useMemo(() => {
    const seen: string[] = []
    for (const r of records) for (const k of Object.keys(r)) if (!seen.includes(k)) seen.push(k)
    return seen
  }, [records])

  return (
    <div className="mt-3">
      <div className="mb-1 text-[12px] font-semibold text-slate-400">상세 내역 · 약품/투약</div>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full whitespace-nowrap text-[12px]">
          <thead>
            <tr className="bg-slate-950 text-slate-300">
              {columns.map((c) => (
                <th key={c} className="px-3 py-2 text-left font-semibold">{labelOf(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-200">
            {records.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c} className="px-3 py-2">
                    {/[Dd]ate$/.test(c) ? ymd(r[c]) : cellOf(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">※ CODEF 응답 전 항목을 표로 표시합니다. 컬럼명은 상품 스펙 확정 후 더 다듬을 수 있어요.</p>
    </div>
  )
}

/** 스펙(ColSpec[]) 기반 표 — 알려진 섹션을 보기 좋게. 금액(won) 컬럼은 합계 행을 붙인다. */
/** 날짜(YYYYMMDD) 정렬 키. 비거나 형식오류면 0(맨 뒤). */
const ymdKey = (v: unknown): number => {
  const d = String(v ?? '').replace(/[^\d]/g, '')
  return d.length === 8 ? Number(d) : 0
}
const dayLabel = (v: unknown): string => {
  const d = String(v ?? '').replace(/[^\d]/g, '')
  return d.length === 8 ? `${Number(d.slice(6, 8))}일` : ymd(v)
}

/**
 * 섹션(기본 진료내역/세부/처방) 표시 — **날짜별(월 그룹) 카드**로 모바일에서도 보기 편하게.
 * 데스크톱에서도 동일 카드 레이아웃(그리드)으로 가독성 유지. 가로 스크롤 표 대신 세로 카드.
 */
export function SpecTable({ cols, records, groupBy = 'year' }: { cols: ColSpec[]; records: Row[]; groupBy?: GroupBy }): JSX.Element {
  const dateCol = cols.find((c) => c.kind === 'date') ?? cols[0]
  const hospitalKey = cols.find((c) => c.key === 'resHospitalName')?.key
  const wonCols = cols.filter((c) => c.kind === 'won')
  // 카드 본문에 '라벨: 값' 으로 보여줄 컬럼(날짜·병의원·금액 제외).
  const fieldCols = cols.filter((c) => c !== dateCol && c.key !== hospitalKey && c.kind !== 'won')

  const fmtVal = (c: ColSpec, v: unknown): string => {
    if (c.kind === 'num') return `${num(v)}`
    return v === null || v === undefined || v === '' ? '' : String(v)
  }

  // 연(YYYY) 또는 월(YYYY.MM) 그룹 — 날짜 내림차순.
  const groups = useMemo(() => {
    const sorted = [...records].sort((a, b) => ymdKey(b[dateCol.key]) - ymdKey(a[dateCol.key]))
    const map = new Map<string, Row[]>()
    for (const r of sorted) {
      const k = groupKeyOf(String(r[dateCol.key] ?? '').replace(/[^\d]/g, ''), groupBy)
      const arr = map.get(k) ?? []
      arr.push(r)
      map.set(k, arr)
    }
    return Array.from(map.entries()).map(([ym, rows]) => ({
      ym,
      rows,
      self: rows.reduce((s, r) => s + num(r.resDeductibleAmt), 0)
    }))
  }, [records, dateCol.key, groupBy])

  const totals = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of wonCols) m[c.key] = records.reduce((s, r) => s + num(r[c.key]), 0)
    return m
  }, [wonCols, records])

  return (
    <div className="space-y-3">
      {/* 요약(금액 섹션만) */}
      {wonCols.length ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-[#fde68a] bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          <span className="font-bold">합계 {records.length}건</span>
          {wonCols.map((c) => (
            <span key={c.key}>{c.label} <b>{won(totals[c.key])}</b></span>
          ))}
        </div>
      ) : null}

      {groups.map((g) => (
        <div key={g.ym}>
          {/* 월 헤더(날짜별 정리) */}
          <div className="sticky top-0 z-[1] -mx-1 mb-1.5 flex items-center gap-2 bg-white/95 px-1 py-1 backdrop-blur">
            <span className="rounded-full bg-[#0e1e3a] px-2.5 py-0.5 text-[12px] font-bold text-white">{g.ym}</span>
            <span className="text-[12px] font-semibold text-slate-400">{g.rows.length}건</span>
            {wonCols.length && g.self ? <span className="text-[12px] text-slate-400">본인부담 {won(g.self)}</span> : null}
          </div>

          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {g.rows.map((r, i) => {
              const amounts = wonCols.filter((c) => num(r[c.key]) > 0)
              const type = String(r.resTreatType ?? '')
              const inpatient = /입원/.test(type)
              const surgeryRow = /(수술|절제|적출|성형|이식|봉합|절개)/.test(type) || /(수술|절제|적출|성형|이식|봉합|절개)/.test(String(r.resCodeName ?? r.resOperationName ?? ''))
              return (
                <li key={i} className={`rounded-xl border bg-white p-3 shadow-sm ${inpatient || surgeryRow ? 'border-rose-300 ring-1 ring-[#fecdd3]' : 'border-slate-800'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md bg-[#eef2f7] px-2 py-0.5 text-[12px] font-bold text-[#334155] ring-1 ring-[#e2e8f0]">{dayLabel(r[dateCol.key])}</span>
                    <span className="flex items-center gap-1">
                      {surgeryRow ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 ring-1 ring-[#fecdd3]">수술</span> : null}
                      {type ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${inpatient ? 'bg-rose-600 text-white' : 'border border-slate-700 text-slate-400'}`}>{type}</span> : null}
                    </span>
                  </div>
                  {hospitalKey && r[hospitalKey] ? <div className="mt-1 text-[13px] font-bold text-slate-100">{String(r[hospitalKey])}</div> : null}

                  <dl className="mt-1 space-y-0.5">
                    {fieldCols.map((c) => {
                      if (c.key === 'resTreatType') return null // 위 칩으로 표시
                      const v = fmtVal(c, r[c.key])
                      if (!v) return null
                      const emphasize = c.key === 'resDiseaseName' || c.key === 'resDrugName'
                      return (
                        <div key={c.key} className="flex gap-2 text-[12px]">
                          <dt className="shrink-0 text-slate-500">{c.label}</dt>
                          <dd className={`min-w-0 break-words ${emphasize ? 'font-semibold text-slate-200' : 'text-slate-300'}`}>{v}</dd>
                        </div>
                      )
                    })}
                  </dl>

                  {amounts.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-slate-800 pt-1.5 text-[12px]">
                      {amounts.map((c) => (
                        <span key={c.key} className="text-slate-400">{c.label} <b className="text-[#8a6a1f]">{won(r[c.key])}</b></span>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function StatusBadge({ status }: { status: HealthRecordRequest['status'] }): JSX.Element {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '작성', cls: 'bg-slate-900 text-slate-400' },
    awaiting_customer: { label: '고객 입력 대기', cls: 'bg-indigo-50 text-indigo-700' },
    awaiting_auth: { label: '고객 인증 중', cls: 'bg-amber-50 text-amber-700' },
    consented: { label: '동의', cls: 'bg-sky-50 text-sky-700' },
    fetching: { label: '조회 중', cls: 'bg-sky-50 text-sky-700' },
    completed: { label: '완료', cls: 'bg-emerald-50 text-emerald-700' },
    failed: { label: '실패', cls: 'bg-rose-50 text-rose-700' },
    expired: { label: '만료', cls: 'bg-slate-900 text-slate-400' }
  }
  const s = map[status] ?? map.draft
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.cls}`}>{s.label}</span>
}
