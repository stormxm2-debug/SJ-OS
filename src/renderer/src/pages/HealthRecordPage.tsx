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
import { shareMeetingText } from '@renderer/services/share/meetingShare'
import {
  collectHrSections,
  summarizeByDisease,
  summarizeEpisodes,
  buildHighlights,
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
import { askHealthRecordAi } from '@renderer/services/health-record/healthRecordAiService'
import HealthRecordWorkspace from '@renderer/components/health-record/HealthRecordWorkspace'
import SonsonEstimator from '@renderer/components/health-record/SonsonEstimator'
import { admissionSummary, buildCareRecords, calendarMonthsAgo, filterCareResult, healthErrorHelp, validCareDate, type CarePeriod, type CareRecord, type HrUnderwritingContext } from '@renderer/services/health-record/careWorkspace'

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
  const [productKey, setProductKey] = useState(HEALTH_PRODUCTS[0].key)
  const selected = HEALTH_PRODUCTS.find((p) => p.key === productKey) ?? HEALTH_PRODUCTS[0]

  const [name, setName] = useState('')
  const [idValue, setIdValue] = useState('') // 생년월일(8) 또는 주민번호(13) — 상품에 따라
  const [showRrn, setShowRrn] = useState(false) // 주민번호 화면 표시 여부(기본 가림)
  const [phone, setPhone] = useState('')
  const [provider, setProvider] = useState('1') // loginTypeLevel (기본: 카카오톡)
  const [telecom, setTelecom] = useState('0') // telecom (통신사인증서일 때만)
  const [startDate, setStartDate] = useState(monthsAgoStr(14))
  const [endDate, setEndDate] = useState(monthsAgoStr(2))
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
  const [error, setError] = useState<string | null>(null)
  const [configNote, setConfigNote] = useState<string | null>(null)

  const [requestId, setRequestId] = useState<string | undefined>(undefined)
  const [twoWay, setTwoWay] = useState<TwoWayInfo | undefined>(undefined)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [history, setHistory] = useState<HealthRecordRequest[]>([])

  // 주민번호 입력 주체: 직원 직접 / 고객에게 링크
  const [inputMode, setInputMode] = useState<'staff' | 'customer'>('customer')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [invite, setInvite] = useState<{ url: string; smsSent: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  const needTelecom = provider === '5'
  const needDate = selected.dateMode === 'range'
  const idLen = selected.idField === 'birth' ? 8 : 13

  const refresh = async (): Promise<void> => {
    const r = await listHealthRecords()
    if (r.ok) setHistory(r.items)
  }
  useEffect(() => {
    void refresh()
  }, [])

  // 상품을 바꾸면 진행 중이던 세션/결과를 비운다(요청변수가 달라지므로).
  const onProductChange = (key: string): void => {
    setProductKey(key)
    setIdValue('')
    setTwoWay(undefined)
    setRequestId(undefined)
    setResult(null)
    setError(null)
    setNotice(null)
    setConfigNote(null)
    // 상품별 조회기간 창에 맞춰 기본 날짜를 다시 설정(요청변수가 달라지므로).
    const p = HEALTH_PRODUCTS.find((x) => x.key === key) ?? HEALTH_PRODUCTS[0]
    const win = p.periodWindow ?? { backMonths: 14, recentMonths: 2 }
    setStartDate(monthsAgoStr(win.backMonths))
    setEndDate(monthsAgoStr(win.recentMonths))
    setIncludeSensitive(false)
    setIncludeChild(false)
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
      return
    }
    setBusy('고객 휴대폰으로 간편인증을 요청하는 중…')
    try {
      const r = await startHealthRecord({
        customerName: name.trim(),
        product: selected.url,
        param: buildParam(),
        encryptFields: selected.encrypt
      })
      if (r.disabled) {
        setConfigNote(r.error ?? 'CODEF 연동이 아직 설정되지 않았습니다. 키·상품 URL을 등록하면 바로 동작합니다.')
        return
      }
      if (!r.ok && r.status !== 'awaiting_auth') {
        setError(r.error ?? '요청에 실패했습니다.')
        return
      }
      setRequestId(r.requestId)
      setTwoWay(r.twoWay)
      if (r.status === 'completed' && r.result) setResult(r.result)
      setNotice(r.message ?? '고객님 휴대폰에서 간편인증을 승인해 주세요. 승인 후 아래 「결과 조회」를 누르세요.')
      void refresh()
    } catch {
      setError('요청 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  const onConfirm = async (): Promise<void> => {
    setError(null)
    if (!twoWay) {
      setError('먼저 간편인증을 요청하세요.')
      return
    }
    setBusy('고객 건강기록을 불러오는 중…')
    try {
      const r = await confirmHealthRecord({
        requestId,
        product: selected.url,
        param: buildParam(),
        twoWay,
        encryptFields: selected.encrypt
      })
      if (r.disabled) {
        setConfigNote(r.error ?? 'CODEF 연동이 아직 설정되지 않았습니다.')
        return
      }
      if (!r.ok) {
        const deadSession = r.code === 'CF-00025' || /완료된 요청|만료|CF-00025/.test(r.error ?? '')
        if (deadSession) {
          setTwoWay(undefined)
          setRequestId(undefined)
          setError('인증 세션이 끝났습니다(1회용). 「간편인증 요청」부터 다시 하세요 — 요청 → 승인 → 결과 조회를 한 번씩만.')
        } else {
          setError(r.error ?? '아직 승인 전이거나 조회에 실패했습니다. 고객 승인 후 다시 시도해주세요.')
        }
        return
      }
      setResult(r.result ?? {})
      setRequestId(r.requestId ?? requestId)
      setTwoWay(undefined) // 2-way 세션은 1회용 — 성공 후 재조회 방지(새 조회는 다시 요청).
      setNotice('건강기록을 받아왔습니다.')
      void refresh()
    } catch {
      setError('조회 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  // 고객 링크(주민번호 고객 직접 입력) 발급 — 주민번호는 보내지 않고 템플릿만.
  const canInvite = Boolean(name.trim()) && digits(phone).length >= 10 && validPeriod
  const onInvite = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    setConfigNote(null)
    setInvite(null)
    if (!canInvite) {
      setError('고객 성함·휴대폰 번호를 확인해주세요.')
      return
    }
    setInviteBusy(true)
    try {
      const template = buildParam() as Record<string, unknown>
      delete template.identity
      const r = await inviteCustomerLink({
        customerName: name.trim(),
        phone,
        product: selected.url,
        paramTemplate: template,
        encryptFields: selected.encrypt,
        idField: selected.idField,
        idLen,
        appOrigin: window.location.origin
      })
      if (r.disabled) {
        setConfigNote(r.error ?? '링크 발급 서버(엣지함수)가 아직 배포되지 않았습니다.')
        return
      }
      if (!r.ok || !r.url) {
        setError(r.error ?? '링크 생성에 실패했습니다.')
        return
      }
      setInvite({ url: r.url, smsSent: Boolean(r.smsSent) })
      setNotice(r.smsSent ? '고객에게 문자로 링크를 보냈습니다. 고객이 입력하면 아래 「최근 요청」에 결과가 표시됩니다.' : '링크를 생성했습니다. 아래에서 복사하거나 카톡으로 보내세요.')
      void refresh()
    } finally {
      setInviteBusy(false)
    }
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
    setError(null)
    setConfigNote(null)
    setTwoWay(undefined)
    setRequestId(h.id)
    setResult(h.result)
    setNotice(`저장된 결과를 불러왔습니다 — ${h.customerName || '고객'} · ${new Date(h.createdAt).toLocaleDateString('ko-KR')}`)
    setTimeout(() => document.getElementById('hr-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-sm font-extrabold text-white">고객 건강기록 조회</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">{selected.short} · 간편인증(CODEF)</span>
        </div>
        <p className="mt-1 text-[11px] text-white/60">
          고객 동의 하에 간편인증으로 건강기록을 확인합니다. 조회 결과는 접근 권한(RLS)으로 보호되며 {RETAIN_DAYS}일 후 자동 만료됩니다.
        </p>
      </div>

      {configNote ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b className="font-bold">CODEF 연동 설정 필요</b> — {configNote}
            <div className="mt-1 text-[11px] text-amber-700">
              Supabase 시크릿에 CODEF_CLIENT_ID / CODEF_CLIENT_SECRET / CODEF_PUBLIC_KEY 를 등록하면 즉시 동작합니다.
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 입력 + 요청 */}
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-100">① 조회 상품 · 고객 정보</h2>
          {/* 주민번호 입력 주체 토글 */}
          <div className="mt-2 inline-flex rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-0.5 text-[12px] font-bold">
            <button type="button" onClick={() => { setInputMode('staff'); setInvite(null) }}
              className={`rounded-lg px-3 py-1.5 ${inputMode === 'staff' ? 'bg-[#0e1e3a] text-white' : 'text-[#475569]'}`}>직원 직접 입력</button>
            <button type="button" onClick={() => { setInputMode('customer'); setError(null) }}
              className={`rounded-lg px-3 py-1.5 ${inputMode === 'customer' ? 'bg-[#0e1e3a] text-white' : 'text-[#475569]'}`}>고객에게 링크</button>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            {inputMode === 'staff' ? '직원이 고객 주민번호를 직접 입력해 조회합니다.' : '고객이 링크에서 본인 주민번호를 직접 입력·인증합니다(직원은 주민번호를 입력하지 않음).'}
          </p>
          <div className="mt-3 space-y-2.5">
            <div>
              <label className="text-[11px] font-semibold text-slate-400">조회 상품</label>
              <select value={productKey} onChange={(e) => onProductChange(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] font-semibold text-slate-100 outline-none focus:border-[#c6982f]">
                {HEALTH_PRODUCTS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
              <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{selected.note}</p>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-400">고객 성함</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
            </div>
            <div className="flex gap-2">
              {inputMode === 'staff' ? (
                <div className="flex-1">
                  {selected.idField === 'birth' ? (
                    <>
                      <label className="text-[11px] font-semibold text-slate-400">생년월일 (YYYYMMDD · 8자리)</label>
                      <input value={idValue} onChange={(e) => setIdValue(e.target.value)} inputMode="numeric" maxLength={8} placeholder="19900101"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
                    </>
                  ) : (
                    <>
                      <label className="text-[11px] font-semibold text-slate-400">주민등록번호 (13자리)</label>
                      <div className="relative mt-1">
                        <input value={idValue} onChange={(e) => setIdValue(e.target.value)} type={showRrn ? 'text' : 'password'} inputMode="numeric" maxLength={14} placeholder="앞 6자리 + 뒤 7자리" autoComplete="off"
                          className="w-full rounded-lg border border-slate-700 bg-white px-3 py-2 pr-9 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
                        <button type="button" onClick={() => setShowRrn((v) => !v)} aria-label={showRrn ? '주민번호 숨기기' : '주민번호 보기'} tabIndex={-1}
                          className="absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400 hover:text-slate-200">
                          {showRrn ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
              <div className="flex-1">
                <label className="text-[11px] font-semibold text-slate-400">휴대폰 번호{inputMode === 'customer' ? ' (고객 — 링크 발송·인증)' : ''}</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="01012345678"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
              </div>
            </div>
            {inputMode === 'staff' && selected.idField === 'rrn' ? (
              <p className="-mt-1 text-[10px] text-slate-500">※ 주민번호는 보안 연결(HTTPS)로 전송되며 화면·앱에 저장되지 않습니다.</p>
            ) : null}
            <div className="flex gap-2">
              <div className={needTelecom ? 'flex-1' : 'w-full'}>
                <label className="text-[11px] font-semibold text-slate-400">간편인증 수단</label>
                <select value={provider} onChange={(e) => setProvider(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]">
                  {AUTH_PROVIDERS.map((p) => (
                    <option key={p.v} value={p.v}>{p.label}</option>
                  ))}
                </select>
              </div>
              {needTelecom ? (
                <div className="w-40">
                  <label className="text-[11px] font-semibold text-slate-400">통신사</label>
                  <select value={telecom} onChange={(e) => setTelecom(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-2 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]">
                    {TELECOMS.map((t) => (
                      <option key={t.v} value={t.v}>{t.label}</option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
            {needDate ? (
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-slate-400">조회 시작 (YYYYMMDD)</label>
                  <input value={startDate} onChange={(e) => setStartDate(e.target.value)} inputMode="numeric" maxLength={8}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-semibold text-slate-400">조회 종료 (YYYYMMDD)</label>
                  <input value={endDate} onChange={(e) => setEndDate(e.target.value)} inputMode="numeric" maxLength={8}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-white px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[#c6982f]" />
                </div>
              </div>
            ) : null}
            {selected.supportsSensitive || selected.supportsChild ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-0.5">
                {selected.supportsChild ? (
                  <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-300">
                    <input type="checkbox" checked={includeChild} onChange={(e) => setIncludeChild(e.target.checked)} className="h-3.5 w-3.5 accent-[#c6982f]" />
                    자녀 정보 포함
                  </label>
                ) : null}
                {selected.supportsSensitive ? (
                  <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-300">
                    <input type="checkbox" checked={includeSensitive} onChange={(e) => setIncludeSensitive(e.target.checked)} className="h-3.5 w-3.5 accent-[#c6982f]" />
                    민감상병 포함
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>

          {inputMode === 'staff' ? (
            <>
              <button type="button" onClick={() => void onStart()} disabled={Boolean(busy) || !canStart}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#0e1e3a] px-4 py-2.5 text-[13px] font-bold text-white transition hover:opacity-90 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                간편인증 요청
              </button>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                순서: <b className="text-slate-300">간편인증 요청 → 고객 휴대폰 인증앱(카카오/네이버/통신사PASS 등)에서 승인 → 결과 조회</b>. 각 단계는 한 번씩만 — 결과 조회가 안 되면 「간편인증 요청」부터 다시 하세요.
                {needDate ? <> 조회 가능 기간은 <b className="text-slate-300">{ymd(minStart)} ~ {ymd(maxEnd)}</b>{period.recentMonths >= 2 ? '(최근 2개월은 공단 반영 전)' : ''}이라 기본값을 그 창으로 설정했습니다.</> : <> 이 상품은 <b className="text-slate-300">최근 1년치</b>를 자동 조회합니다.</>}
              </p>
            </>
          ) : (
            <>
              <button type="button" onClick={() => void onInvite()} disabled={inviteBusy || !canInvite}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 px-4 py-2.5 text-[13px] font-bold text-white transition hover:brightness-110 disabled:opacity-50">
                {inviteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                고객에게 링크 생성·전송
              </button>
              {invite ? (
                <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                  <div className="text-[11px] font-bold text-indigo-700">{invite.smsSent ? '문자로 링크를 보냈습니다' : '링크가 생성되었습니다 (문자 미설정 — 복사/공유)'}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input readOnly value={invite.url} className="min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-[11px] text-indigo-700" />
                    <button type="button" onClick={() => void copyInvite()} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-indigo-600">
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? '복사됨' : '복사'}
                    </button>
                    <button type="button" onClick={shareInvite} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-[#FEE500] px-2.5 py-1.5 text-[11px] font-bold text-[#3c1e1e]">
                      <Share2 className="h-3.5 w-3.5" /> 카톡
                    </button>
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-indigo-700/70">고객이 링크에서 본인확인을 마치면 아래 「최근 요청」에 결과가 자동 표시됩니다(링크 30분 1회용).</p>
                </div>
              ) : null}
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                직원은 주민번호를 입력하지 않습니다. 상품·간편인증 수단{needDate ? '·조회기간' : ''}을 고르고 고객 휴대폰 번호만 입력한 뒤 링크를 보내세요.
              </p>
            </>
          )}
        </div>

        {/* 승인 대기 + 결과 조회 */}
        <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-slate-100">② 고객 승인 → 결과 조회</h2>
          {inputMode === 'customer' ? (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-[12px] text-indigo-700">
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
              <span>고객이 <b>링크에서 본인확인</b>을 진행합니다. 완료되면 아래 「최근 요청」에 결과가 <b>자동 표시</b>됩니다(직원 조작 불필요).</span>
            </div>
          ) : (
            <>
              {twoWay ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#c6982f] bg-[#fdf7ea] px-3 py-2.5 text-[12px] text-[#8a6a1f]">
                  <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>고객님 휴대폰에서 <b>간편인증을 승인</b>한 뒤 아래 「결과 조회」를 눌러주세요.</span>
                </div>
              ) : (
                <p className="mt-3 text-[12px] text-slate-500">먼저 왼쪽에서 간편인증을 요청하세요.</p>
              )}

              <button type="button" onClick={() => void onConfirm()} disabled={Boolean(busy) || !twoWay}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-200 transition hover:bg-slate-950 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                결과 조회
              </button>

              {result ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12px] font-semibold text-emerald-700">
                  조회가 완료됐습니다. 아래 <b>「조회 결과」</b>에서 상세 내역을 확인하세요.
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {result ? (
        <div id="hr-result">
          <ResultReport key={requestId ?? 'unsaved'} result={result} requestId={requestId} />
        </div>
      ) : null}

      {notice ? <div className="rounded-xl border border-slate-800 bg-white px-4 py-2.5 text-[12px] font-semibold text-emerald-700">{notice}</div> : null}
      {busy ? <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800"><Loader2 className="h-4 w-4 shrink-0 animate-spin"/><div><b>{busy}</b> · {busySeconds}초 경과<p className="mt-1 text-[11px]">기관 응답 대기 중입니다. 진행률을 임의로 표시하지 않습니다. 시간이 초과되면 아래 최근 요청을 먼저 확인하세요.</p></div></div> : null}
      {error ? <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-700"><b>{healthErrorHelp(error).title}</b><p className="mt-1">{error}</p><p className="mt-1 text-[11px]">{healthErrorHelp(error).action}</p></div> : null}

      {/* 최근 요청 — 완료 건은 30일간 저장되어 다시 열람 가능 */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-100">최근 요청</h2>
          <button type="button" onClick={() => void refresh()} className="text-[11px] font-semibold text-slate-400 hover:text-slate-200">새로고침</button>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500">완료된 조회 결과는 <b className="text-slate-300">{RETAIN_DAYS}일간 보관</b>되어 다시 열람할 수 있고, 이후 자동 만료됩니다.</p>
        {history.length === 0 ? (
          <p className="mt-2 text-[12px] text-slate-500">아직 요청이 없습니다.</p>
        ) : (
          <div className="mt-2 divide-y divide-slate-800">
            {history.map((h) => {
              const age = daysSince(h.createdAt)
              const canViewRow = h.status === 'completed' && !!h.result && age <= RETAIN_DAYS
              const daysLeft = Math.max(0, RETAIN_DAYS - age)
              return (
                <div key={h.id} className="flex items-center gap-2 py-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold text-slate-200">{h.customerName || '고객 미지정'}</span>
                    {h.staffName ? <span className="ml-1 rounded-full bg-[#eef2f7] px-1.5 py-0.5 text-[10px] font-bold text-[#334155]">FC {h.staffName}</span> : null}
                  </span>
                  <span className="shrink-0 text-slate-500">{new Date(h.createdAt).toLocaleString('ko-KR')}</span>
                  {canViewRow ? <span className="shrink-0 text-[10px] font-semibold text-slate-400">{daysLeft}일 남음</span> : null}
                  <StatusBadge status={h.status} />
                  {h.status === 'failed' && h.error ? <span title={healthErrorHelp(h.error).action} className="max-w-44 truncate text-[10px] text-rose-600">{healthErrorHelp(h.error).title}</span> : null}
                  {canViewRow ? (
                    <button type="button" onClick={() => viewSaved(h)}
                      className="shrink-0 rounded-lg border border-slate-700 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-200 transition hover:bg-slate-950">
                      결과 보기
                    </button>
                  ) : (
                    <span className="w-[52px] shrink-0 text-right text-[10px] text-slate-400">{h.status === 'completed' ? '보관 만료' : ''}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** 결과 렌더러 — 응답 안의 모든 목록을 섹션별 표로. 각 섹션은 데이터 모양으로
 *  진료(카테고리 보고서)/약품·기타(상세 표)를 자동 구분한다. */
export function ResultReport({ result, requestId }: { result: Record<string, unknown>; requestId?: string }): JSX.Element {
  const [showRaw, setShowRaw] = useState(false)
  const [carePeriod, setCarePeriod] = useState<CarePeriod>('all')
  const filteredResult = useMemo(() => filterCareResult(result, carePeriod), [result, carePeriod])
  const [underwritingContext, setUnderwritingContext] = useState<HrUnderwritingContext>({ insurers: [], guides: [], exceptions: [] })
  const [view, setView] = useState<'episode' | 'sections' | 'disease'>('episode')
  const [groupBy, setGroupBy] = useState<GroupBy>('year')
  const sections = useMemo(() => collectSections(filteredResult), [filteredResult])
  const raw = useMemo(() => JSON.stringify(result, null, 2), [result])
  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0)
  const diseases = useMemo(() => summarizeByDisease(collectHrSections(filteredResult)), [filteredResult])
  const episodes = useMemo(() => summarizeEpisodes(collectHrSections(filteredResult)), [filteredResult])
  const highlights = useMemo(() => buildHighlights(collectHrSections(filteredResult)), [filteredResult])
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

  return (
    <div className="rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-100">
          조회 결과
          {userNm ? <span className="text-slate-400"> · {userNm}</span> : null}
          {totalRows ? <span className="text-slate-400"> · 총 {totalRows}건</span> : null}
        </h2>
        {Object.keys(result).length ? (
          <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-[11px] font-semibold text-slate-400 hover:text-slate-200">
            {showRaw ? '표로 보기' : '원본(JSON) 보기'}
          </button>
        ) : null}
      </div>

      {!showRaw ? <HealthRecordWorkspace result={filteredResult} requestId={requestId} period={carePeriod} onPeriodChange={setCarePeriod} onContextChange={setUnderwritingContext} /> : null}

      {/* 실손 예상(시나리오) — 수동 입력 기반, 세대 규칙 적용. 금액을 임의로 지어내지 않는다. */}
      {!showRaw ? <SonsonEstimator /> : null}

      {/* 주목 신호 하이라이트(입원·수술·통원 7회↑·고액) */}
      {sections.length && !showRaw && highlights.hasAny ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span className="text-[11px] font-bold text-rose-700">주목</span>
          {highlights.inpatientVisits > 0 ? <BigChip tone="rose">입원 {highlights.inpatientVisits}건</BigChip> : null}
          {highlights.surgeryCount > 0 ? <BigChip tone="rose">수술 {highlights.surgeryCount}건</BigChip> : null}
          {highlights.frequentOutpatient.map((d) => (
            <BigChip key={d.disease} tone="amber">통원 {d.outpatientVisits}회 · {d.disease}</BigChip>
          ))}
          {highlights.bigSelfPay.map((d) => (
            <BigChip key={`sp-${d.disease}`} tone="amber">고액 {won(d.selfPayTotal)} · {d.disease}</BigChip>
          ))}
          <span className="w-full text-[10px] text-rose-700/70">보험 상담 시 확인 권장 신호(추정). 입원·수술·잦은 통원·고액 진료는 담보 해당 여부를 약관으로 확인하세요.</span>
        </div>
      ) : null}

      {/* 보기 전환 + 그룹(연/월) + AI */}
      {sections.length && !showRaw ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <HrChip active={view === 'episode'} onClick={() => setView('episode')}>묶음 보기{episodes.length ? ` ${episodes.length}` : ''}</HrChip>
          <HrChip active={view === 'disease'} onClick={() => setView('disease')}>상병별 요약{diseases.length ? ` ${diseases.length}` : ''}</HrChip>
          <HrChip active={view === 'sections'} onClick={() => setView('sections')}>진료순(전체)</HrChip>
          {view === 'sections' ? (
            <>
              <span className="mx-1 text-slate-300">|</span>
              <HrChip active={groupBy === 'year'} onClick={() => setGroupBy('year')}>연도별</HrChip>
              <HrChip active={groupBy === 'month'} onClick={() => setGroupBy('month')}>월별</HrChip>
            </>
          ) : null}
          <button type="button" onClick={() => void runAi()} disabled={aiBusy}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[#0e1e3a] px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50">
            {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 text-[#e6c877]" />}
            AI 통합 인수 요약
          </button>
        </div>
      ) : null}

      {/* AI 패널 */}
      {sections.length && !showRaw && (aiAnswer || aiErr || aiBusy) ? (
        <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input value={aiQ} onChange={(e) => setAiQ(e.target.value)} placeholder="AI에게 질문(선택) — 예: 최근 2년 입원·수술 정리해줘"
              className="min-w-0 flex-1 rounded border border-slate-700 bg-white px-2 py-1 text-[12px] text-slate-100" />
            <button type="button" onClick={() => void runAi()} disabled={aiBusy}
              className="rounded border border-slate-700 bg-white px-2 py-1 text-[11px] font-bold text-slate-200 disabled:opacity-50">{aiBusy ? '분석 중…' : '질문'}</button>
          </div>
          {aiErr ? <p className="mt-2 text-[12px] text-rose-400">{aiErr}</p> : null}
          {aiAnswer ? <div className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-100">{aiAnswer}</div> : null}
          <p className="mt-2 text-[10px] text-slate-500">※ 이름·주민번호 등 식별자는 보내지 않고 비식별 요약만 AI에 전달합니다. 병명·수술·투약 연결은 (진료일·기관) 매칭 기반 추정이며 의학적 확정이 아닙니다.</p>
        </div>
      ) : null}

      {showRaw ? (
        <pre className="mt-2 max-h-80 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">{raw}</pre>
      ) : sections.length === 0 ? (
        <p className="mt-3 text-[12px] text-slate-500">선택한 기간에 표시할 기록이 없습니다. ‘조회 전체’ 또는 원본 보기를 확인하세요.</p>
      ) : view === 'episode' ? (
        <div className="mt-3">
          <EpisodeView episodes={episodes} records={careRecords} />
        </div>
      ) : view === 'disease' ? (
        <div className="mt-3">
          <DiseaseSummaryView diseases={diseases} />
        </div>
      ) : (
        <div className="mt-3 space-y-5">
          {sections.map((s) => (
            <div key={s.key}>
              {sections.length > 1 ? (
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="rounded-full bg-[#0e1e3a] px-2.5 py-0.5 text-[11px] font-bold text-white">{s.label}</span>
                  <span className="text-[11px] font-semibold text-slate-400">{s.rows.length}건</span>
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
  )
}

function BigChip({ tone, children }: { tone: 'rose' | 'amber' | 'slate'; children: React.ReactNode }): JSX.Element {
  const cls = tone === 'rose'
    ? 'border-rose-300 bg-white text-rose-700'
    : tone === 'amber'
      ? 'border-amber-300 bg-amber-100 text-amber-800'
      : 'border-slate-300 bg-white text-slate-600'
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>
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
    <li className="overflow-hidden rounded-lg border border-rose-200 bg-rose-50/40">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-2 p-1.5 text-left hover:bg-[#fff1f2]">
        <SurgeryIcon group={occ.partGroup} className="mt-0.5 h-9 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">수술</span>
            {occ.bodyPart ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">부위: {occ.bodyPart}</span> : null}
            <span className="text-[12px] font-semibold text-slate-100">{occ.primaryName}</span>
            {others.length ? <span className="text-[10px] text-slate-400">외 {others.length}건</span> : null}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">{ymd(occ.date)}{occ.hospital ? ` · ${occ.hospital}` : ''}</div>
        </div>
        <span className="mt-0.5 shrink-0 text-[10px] font-semibold text-rose-600">{open ? '닫기' : '자세히'}</span>
      </button>

      {open ? (
        <div className="border-t border-rose-100 bg-white p-2.5">
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-lg border border-slate-100 bg-[#f8fafc] p-1.5">
              <SurgeryIcon group={occ.partGroup} className="h-20 w-11" />
            </div>
            <div className="min-w-0 flex-1 text-[12px]">
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-slate-100"><b>수술명</b> · {occ.primaryName}</span>
                {label ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">{label}</span> : null}
              </div>
              <div className="mt-0.5 text-slate-300"><b>추정 부위</b> · {occ.bodyPart || '부위 추정 어려움(명칭 기반)'}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">{ymd(occ.date)}{occ.hospital ? ` · ${occ.hospital}` : ''}</div>
              {others.length ? <div className="mt-0.5 text-[11px] text-slate-500">같은 날 항목: {others.join(', ')}</div> : null}
            </div>
          </div>

          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
            <div className="flex items-center gap-1 text-[11px] font-extrabold text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" /> 후유장해 가능성{label ? ` · ${label}` : ''}(일반 참고)
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-amber-900">
              {seq.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <div className="mt-1.5 rounded-md bg-white/70 px-2 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
              💡 보험 확인: {seq.insurancePoint}
            </div>
          </div>

          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
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
      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${active ? 'border-[#c6982f] bg-[#fdf7ea] text-[#8a6a1f]' : 'border-slate-700 bg-white text-slate-400'}`}>
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
      <p className="text-[11px] text-slate-500">같은 병명(표기 기준)으로 묶은 <b>추정</b> 요약 — 수술·투약은 (진료일·기관) 일치로 연결했습니다. 표기가 다르면 같은 질환도 분리될 수 있어요(의학적 확정 아님).</p>
      <ul className="grid gap-2 lg:grid-cols-2">
        {diseases.map((d) => {
          const flags = diseaseFlags(d)
          const emphasize = flags.length > 0
          const occasions = groupSurgeryOccasions(d.surgeries)
          return (
          <li key={d.disease} className={`rounded-xl border bg-white p-3 shadow-sm ${emphasize ? 'border-rose-300 ring-1 ring-rose-200' : 'border-slate-800'}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] font-bold text-slate-100">{d.disease}</span>
              <span className="rounded-full bg-[#0e1e3a] px-2 py-0.5 text-[10px] font-bold text-white">{d.visitCount}회 방문</span>
              {d.inpatientVisits > 0 ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-extrabold text-white">입원 {d.inpatientVisits}</span> : null}
              {occasions.length ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200">수술 {occasions.length}회</span> : null}
              {d.outpatientVisits >= 7 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">통원 {d.outpatientVisits}회</span> : null}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {period(d.firstDate, d.lastDate)}
              {d.departments.length ? ` · ${d.departments.join('/')}` : ''}
              {d.selfPayTotal ? ` · 본인부담 ${won(d.selfPayTotal)}` : ''}
            </div>
            {d.hospitals.length ? <div className="mt-0.5 text-[11px] text-slate-400">병원: {d.hospitals.join(', ')}</div> : null}

            {occasions.length ? (
              <div className="mt-1.5">
                <div className="text-[10px] font-semibold text-slate-500">수술 {occasions.length}회(추정) — 누르면 부위·후유장해 안내. 단순 처치 제외, 같은 날 수술은 1회로 묶음.</div>
                <ul className="mt-1 space-y-1.5">
                  {occasions.map((occ, i) => (
                    <SurgeryRow key={i} occ={occ} />
                  ))}
                </ul>
              </div>
            ) : null}

            {d.medications.length ? (
              <div className="mt-1.5">
                <div className="text-[10px] font-semibold text-slate-500">투약(추정)</div>
                <ul className="mt-0.5 space-y-0.5">
                  {d.medications.map((x, i) => (
                    <li key={i} className="text-[12px] text-slate-300">
                      <span className="font-medium text-slate-200">{x.name}</span>
                      {x.ingredient ? <span className="ml-1 text-[11px] text-slate-500">{x.ingredient}</span> : ''}
                      {x.days ? <span className="ml-1 text-[11px] text-slate-500">· {x.days}일분</span> : ''}
                      <span className="ml-1 text-[11px] text-slate-500">· {ymd(x.date)}</span>
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
      <p className="text-[11px] text-slate-500">
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
            <li key={id} className={`overflow-hidden rounded-xl border bg-white shadow-sm ${emphasize ? 'border-rose-300 ring-1 ring-rose-200' : 'border-slate-800'}`}>
              <button type="button" onClick={() => toggle(id)} aria-expanded={isOpen} className="flex w-full items-start gap-2 p-3 text-left hover:bg-[#f8fafc]">
                <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-bold text-slate-100">{e.disease}</span>
                    <span className="rounded-full bg-[#0e1e3a] px-2 py-0.5 text-[10px] font-bold text-white">방문 {e.visitCount}회</span>
                    {e.inpatient ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-extrabold text-white">입원 {admission.knownDays?`${admission.knownDays}일`:'일수 확인 필요'}{admission.knownDays && admission.unknown?' + 미확인':''}</span> : null}
                    {surgCount ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200">수술 {surgCount}회</span> : null}
                    {e.selfPayTotal >= BIG_SELFPAY_THRESHOLD ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">고액</span> : null}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {period(e.firstDate, e.lastDate)}
                    {e.departments.length ? ` · ${e.departments.join('/')}` : ''}
                    {e.selfPayTotal ? ` · 본인부담 ${won(e.selfPayTotal)}` : ''}
                  </div>
                </div>
                <span className="mt-0.5 shrink-0 text-[10px] font-semibold text-slate-400">{isOpen ? '접기' : '상세'}</span>
              </button>

              {isOpen ? (
                <div className="border-t border-slate-100 px-3 pb-3 pt-2.5">
                  {e.hospitals.length ? <div className="text-[11px] text-slate-400">병원: {e.hospitals.join(', ')}</div> : null}

                  <div className="mt-1.5">
                    <div className="text-[10px] font-semibold text-slate-500">방문 내역 ({e.visitCount}회)</div>
                    <ul className="mt-1 space-y-1">
                      {e.visits.map((v, vi) => (
                        <li key={vi} className="flex flex-wrap items-center gap-1.5 text-[12px]">
                          <span className="rounded-md bg-[#eef2f7] px-2 py-0.5 text-[11px] font-bold text-[#334155] ring-1 ring-[#e2e8f0]">{ymd(v.date) || '날짜미상'}</span>
                          {v.inpatient ? (
                            <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">입원</span>
                          ) : v.type ? (
                            <span className="rounded bg-[#eef2f7] px-1.5 py-0.5 text-[10px] font-semibold text-[#334155] ring-1 ring-[#e2e8f0]">{v.type}</span>
                          ) : null}
                          <span className="text-slate-200">{v.hospital || '-'}</span>
                          {v.selfPay ? <span className="text-[11px] text-slate-500">· {won(v.selfPay)}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {occasions.length ? (
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold text-slate-500">수술 {occasions.length}회(추정) — 누르면 부위·후유장해 안내. 단순 처치 제외, 같은 날 수술은 1회로 묶음.</div>
                      <ul className="mt-1 space-y-1.5">
                        {occasions.map((occ, xi) => (
                          <SurgeryRow key={xi} occ={occ} />
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {e.medications.length ? (
                    <div className="mt-2">
                      <div className="text-[10px] font-semibold text-slate-500">투약(추정)</div>
                      <ul className="mt-0.5 space-y-0.5">
                        {e.medications.map((x, mi) => (
                          <li key={mi} className="text-[12px] text-slate-300">
                            <span className="font-medium text-slate-200">{x.name}</span>
                            {x.ingredient ? <span className="ml-1 text-[11px] text-slate-500">{x.ingredient}</span> : ''}
                            {x.days ? <span className="ml-1 text-[11px] text-slate-500">· {x.days}일분</span> : ''}
                            <span className="ml-1 text-[11px] text-slate-500">· {ymd(x.date)}</span>
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
        <div className="mb-1 text-[11px] font-semibold text-slate-400">카테고리 보고서 · 진료형태별</div>
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
        <div className="mb-1 text-[11px] font-semibold text-slate-400">진료 상세 내역 · 치료/투약</div>
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
                    <span className="rounded-full bg-[#eef2f7] px-2 py-0.5 text-[11px] font-semibold text-[#334155] ring-1 ring-[#e2e8f0]">{String(r.resTreatType ?? '') || '-'}</span>
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
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
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
      <div className="mb-1 text-[11px] font-semibold text-slate-400">상세 내역 · 약품/투약</div>
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
      <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">※ CODEF 응답 전 항목을 표로 표시합니다. 컬럼명은 상품 스펙 확정 후 더 다듬을 수 있어요.</p>
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
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
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
            <span className="rounded-full bg-[#0e1e3a] px-2.5 py-0.5 text-[11px] font-bold text-white">{g.ym}</span>
            <span className="text-[11px] font-semibold text-slate-400">{g.rows.length}건</span>
            {wonCols.length && g.self ? <span className="text-[11px] text-slate-400">본인부담 {won(g.self)}</span> : null}
          </div>

          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {g.rows.map((r, i) => {
              const amounts = wonCols.filter((c) => num(r[c.key]) > 0)
              const type = String(r.resTreatType ?? '')
              const inpatient = /입원/.test(type)
              const surgeryRow = /(수술|절제|적출|성형|이식|봉합|절개)/.test(type) || /(수술|절제|적출|성형|이식|봉합|절개)/.test(String(r.resCodeName ?? r.resOperationName ?? ''))
              return (
                <li key={i} className={`rounded-xl border bg-white p-3 shadow-sm ${inpatient || surgeryRow ? 'border-rose-300 ring-1 ring-rose-200' : 'border-slate-800'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md bg-[#eef2f7] px-2 py-0.5 text-[11px] font-bold text-[#334155] ring-1 ring-[#e2e8f0]">{dayLabel(r[dateCol.key])}</span>
                    <span className="flex items-center gap-1">
                      {surgeryRow ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200">수술</span> : null}
                      {type ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${inpatient ? 'bg-rose-600 text-white' : 'border border-slate-700 text-slate-400'}`}>{type}</span> : null}
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
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-slate-800 pt-1.5 text-[11px]">
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
