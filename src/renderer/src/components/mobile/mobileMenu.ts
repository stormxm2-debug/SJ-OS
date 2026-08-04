import type { LucideIcon } from 'lucide-react'
import {
  Clock,
  CalendarDays,
  UserRound,
  ClipboardList,
  FileText,
  BookOpen,
  Bot,
  BarChart3,
  Megaphone,
  UsersRound,
  LayoutList,
  ClipboardCheck,
  Share2,
  Stethoscope,
  ShieldQuestion,
  ListChecks,
  Phone,
  FolderOpen,
  Cake,
  TrendingUp,
  UserPlus,
  PhoneCall,
  Hourglass,
  FileSearch,
  Calculator,
  HeartPulse,
  ExternalLink,
  FileSignature,
  Clapperboard,
  UserCog,
  LayoutDashboard,
  Sparkles,
  ShieldCheck,
  Download,
  KeyRound,
  BookMarked
} from 'lucide-react'
import type { View } from '@renderer/navigation/types'

/**
 * 모바일 전체 메뉴 레지스트리 + 즐겨찾기 저장소.
 *
 * - 메뉴 항목은 여기 한 곳에만 정의하고, 전체 메뉴 화면(MobileMenuPage)과 홈 화면
 *   즐겨찾기 줄(MobileHome)이 같은 정의를 공유한다.
 * - 즐겨찾기는 기기별 localStorage에 저장(계정 공용 아님)하고, 변경 시 구독자에게
 *   즉시 알린다 — 메뉴에서 별을 누르면 홈 화면이 바로 갱신된다.
 */

export interface MobileMenuItem {
  key: string
  label: string
  icon: LucideIcon
  view?: View
  action?: 'jarvis' | 'birthday-gate' | 'password-gate'
  /** 외부 사이트 바로가기 — 새 탭(웹)/기본 브라우저(데스크톱)로 연다. */
  href?: string
  adminOnly?: boolean
}

export interface MobileMenuCategory {
  title: string
  items: MobileMenuItem[]
}

export const MOBILE_MENU: MobileMenuCategory[] = [
  {
    title: '기본 업무',
    items: [
      { key: 'attendance', label: '출퇴근', icon: Clock, view: { name: 'attendance' } },
      { key: 'schedule', label: '일정', icon: CalendarDays, view: { name: 'schedule' } },
      { key: 'today-contacts', label: '오늘의 접촉', icon: PhoneCall, view: { name: 'today-contacts' } },
      { key: 'customer', label: '고객', icon: UserRound, view: { name: 'customer' } },
      { key: 'birthdays', label: '생일 챙기기', icon: Cake, view: { name: 'birthdays' } },
      { key: 'consultation', label: '상담기록', icon: ClipboardList, view: { name: 'consultation' } },
      { key: 'files', label: '자료실', icon: FolderOpen, view: { name: 'files' } },
      { key: 'app-install', label: '앱 설치', icon: Download, view: { name: 'app-install' } }
    ]
  },
  {
    title: '영업 도구',
    items: [
      { key: 'referrals', label: '소개 영업', icon: UserPlus, view: { name: 'referrals' } },
      { key: 'content-studio', label: 'AI 콘텐츠 스튜디오', icon: Clapperboard, view: { name: 'content-studio' } },
      { key: 'knowledge', label: '자료 브리핑', icon: BookMarked, view: { name: 'knowledge' } },
      { key: 'plan-request', label: '설계 요청서', icon: FileSignature, view: { name: 'plan-request' } },
      { key: 'insurance-analysis', label: '보험분석', icon: FileSearch, view: { name: 'insurance-analysis' } },
      { key: 'bojang114', label: '한장보험료 비교', icon: ExternalLink, href: 'https://samsung.bojang114.com/index.html' },
      { key: 'claim-assistant', label: '보험금 청구비서', icon: FileText, view: { name: 'claim-assistant' } },
      { key: 'exemptions', label: '면책기간 알람', icon: Hourglass, view: { name: 'exemptions' } },
      { key: 'wiki', label: '보험 백과사전', icon: BookOpen, view: { name: 'wiki' } },
      { key: 'underwriting', label: '인수 가이드', icon: Stethoscope, view: { name: 'underwriting' } },
      { key: 'pre-underwriting', label: 'AI 사전심사', icon: ShieldQuestion, view: { name: 'pre-underwriting' } },
      { key: 'disease-exceptions', label: '유병자 예외질환', icon: HeartPulse, view: { name: 'disease-exceptions' } },
      { key: 'leads', label: 'DB 배정', icon: ListChecks, view: { name: 'leads' } },
      { key: 'contacts', label: '매니저 연락처', icon: Phone, view: { name: 'contacts' } },
      { key: 'jarvis', label: '자비스', icon: Bot, action: 'jarvis' }
    ]
  },
  {
    title: '실적·공지',
    items: [
      { key: 'performance', label: '매출현황', icon: BarChart3, view: { name: 'performance' } },
      { key: 'salary', label: '급여 계산기', icon: Calculator, view: { name: 'salary' } },
      { key: 'stats-report', label: '통계 리포트', icon: TrendingUp, view: { name: 'stats-report' } },
      { key: 'notice', label: '공지사항', icon: Megaphone, view: { name: 'notice' } },
      // 인사 기록 게이트 재열기 액션 — ⚠ 라벨에 생일/복지 금지 (서프라이즈 유지, FamilyBirthdayGate 참고)
      { key: 'my-birthday', label: '내 인사 정보', icon: ClipboardList, action: 'birthday-gate' },
      { key: 'my-password', label: '비밀번호 변경', icon: KeyRound, action: 'password-gate' }
    ]
  },
  {
    title: '관리자 메뉴',
    items: [
      { key: 'shared-schedule', label: '공유 일정 (전 직원)', icon: Share2, view: { name: 'shared-schedule' }, adminOnly: true },
      { key: 'staff-overview', label: '직원 현황', icon: UsersRound, view: { name: 'staff-overview' }, adminOnly: true },
      { key: 'family-birthdays', label: '직원 생일 복지', icon: Cake, view: { name: 'family-birthdays' }, adminOnly: true },
      { key: 'staff-table', label: '전 직원 정리표', icon: LayoutList, view: { name: 'staff-table' }, adminOnly: true },
      { key: 'registration-admin', label: '고객등록 관리', icon: ClipboardCheck, view: { name: 'registration-admin' }, adminOnly: true },
      { key: 'staff-login', label: '직원 추가·로그인', icon: UserCog, view: { name: 'staff-login' }, adminOnly: true },
      // 폰 대표 모드 (2026-07-20 대표 지정 4종)
      { key: 'dashboard', label: 'CEO 대시보드', icon: LayoutDashboard, view: { name: 'dashboard' }, adminOnly: true },
      { key: 'assistant', label: '경영 비서', icon: Sparkles, view: { name: 'assistant' }, adminOnly: true },
      { key: 'announcements', label: '공지사항 관리', icon: Megaphone, view: { name: 'announcements' }, adminOnly: true },
      { key: 'approvals', label: '승인 센터', icon: ShieldCheck, view: { name: 'approvals' }, adminOnly: true }
    ]
  }
]

export function findMenuItem(key: string): MobileMenuItem | undefined {
  for (const cat of MOBILE_MENU) {
    const hit = cat.items.find((i) => i.key === key)
    if (hit) return hit
  }
  return undefined
}

// ---------- 즐겨찾기 (기기별 localStorage) ----------

const FAV_KEY = 'sj-mobile-favorites-v1'
type FavListener = () => void
const favListeners = new Set<FavListener>()

export function listFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAV_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    // 저장소에 같은 키가 중복으로 들어와도(외부 오염 등) 그대로 돌려주면 홈
    // 즐겨찾기 줄이 React key 충돌("same key" 경고)을 일으키므로 중복을 제거한다.
    // toggleFavorite도 이 결과로 다시 저장하므로 다음 토글 때 저장소도 정리된다.
    const valid = arr.filter((k): k is string => typeof k === 'string' && Boolean(findMenuItem(k)))
    return valid.filter((k, i) => valid.indexOf(k) === i)
  } catch {
    return []
  }
}

export function toggleFavorite(key: string): string[] {
  const cur = listFavorites()
  const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
  try {
    window.localStorage.setItem(FAV_KEY, JSON.stringify(next))
  } catch {
    /* 저장 실패(사파리 프라이빗 등)여도 앱은 계속 동작 */
  }
  favListeners.forEach((fn) => fn())
  return next
}

export function subscribeFavorites(fn: FavListener): () => void {
  favListeners.add(fn)
  return () => {
    favListeners.delete(fn)
  }
}

/** 즐겨찾기 순서 이동 — 홈 화면 즐겨찾기 줄이 이 배열 순서 그대로 그려진다. */
export function moveFavorite(key: string, dir: -1 | 1): void {
  const cur = listFavorites()
  const idx = cur.indexOf(key)
  const to = idx + dir
  if (idx < 0 || to < 0 || to >= cur.length) return
  const next = [...cur]
  next.splice(idx, 1)
  next.splice(to, 0, key)
  try {
    window.localStorage.setItem(FAV_KEY, JSON.stringify(next))
  } catch {
    /* 저장 실패여도 앱은 계속 동작 */
  }
  favListeners.forEach((fn) => fn())
}

// ---------- 회원별 메뉴 순서·숨김 (기기별 localStorage — 즐겨찾기와 같은 원칙) ----------

const PREFS_KEY = 'sj-mobile-menu-prefs-v1'

export interface MenuPrefs {
  /** 카테고리 제목 → 항목 key 순서. 저장에 없는 항목(신규 메뉴)은 기본 순서로 뒤에 붙는다. */
  order: Record<string, string[]>
  /** 전체 메뉴에서 숨길 항목 key — 표시만 숨기며 접근권한·즐겨찾기와 무관. */
  hidden: string[]
}

const prefListeners = new Set<FavListener>()

export function loadMenuPrefs(): MenuPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    const p: unknown = raw ? JSON.parse(raw) : null
    const rawOrder =
      p && typeof p === 'object' && 'order' in p && p.order && typeof (p as { order: unknown }).order === 'object'
        ? ((p as { order: Record<string, unknown> }).order)
        : {}
    const rawHidden = p && typeof p === 'object' && 'hidden' in p ? (p as { hidden: unknown }).hidden : []
    const order: Record<string, string[]> = {}
    for (const cat of MOBILE_MENU) {
      const saved = Array.isArray(rawOrder[cat.title]) ? (rawOrder[cat.title] as unknown[]) : []
      order[cat.title] = saved.filter((k): k is string => typeof k === 'string' && cat.items.some((i) => i.key === k))
    }
    const hidden = Array.isArray(rawHidden)
      ? rawHidden.filter((k): k is string => typeof k === 'string' && Boolean(findMenuItem(k)))
      : []
    return { order, hidden }
  } catch {
    return { order: {}, hidden: [] }
  }
}

function saveMenuPrefs(p: MenuPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* 저장 실패여도 앱은 계속 동작 */
  }
  prefListeners.forEach((fn) => fn())
}

export function subscribeMenuPrefs(fn: FavListener): () => void {
  prefListeners.add(fn)
  return () => {
    prefListeners.delete(fn)
  }
}

/** 카테고리 항목을 회원이 저장한 순서로 정렬 (미저장·신규 항목은 기본 순서로 뒤에). */
export function orderedItems(cat: MobileMenuCategory, prefs: MenuPrefs = loadMenuPrefs()): MobileMenuItem[] {
  const saved = prefs.order[cat.title] ?? []
  if (saved.length === 0) return cat.items
  const inSaved = cat.items
    .filter((i) => saved.includes(i.key))
    .sort((a, b) => saved.indexOf(a.key) - saved.indexOf(b.key))
  const rest = cat.items.filter((i) => !saved.includes(i.key))
  return [...inSaved, ...rest]
}

/** 항목을 카테고리 안에서 위/아래로 이동. orderedKeys = 화면에 그려진 현재 순서 전체. */
export function moveMenuItem(catTitle: string, orderedKeys: string[], key: string, dir: -1 | 1): void {
  const idx = orderedKeys.indexOf(key)
  const to = idx + dir
  if (idx < 0 || to < 0 || to >= orderedKeys.length) return
  const next = [...orderedKeys]
  next.splice(idx, 1)
  next.splice(to, 0, key)
  const prefs = loadMenuPrefs()
  prefs.order[catTitle] = next
  saveMenuPrefs(prefs)
}

export function toggleMenuItemHidden(key: string): void {
  const prefs = loadMenuPrefs()
  prefs.hidden = prefs.hidden.includes(key) ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key]
  saveMenuPrefs(prefs)
}

/** 순서·숨김을 기본값으로 복원 (즐겨찾기는 건드리지 않음). */
export function resetMenuPrefs(): void {
  try {
    window.localStorage.removeItem(PREFS_KEY)
  } catch {
    /* ignore */
  }
  prefListeners.forEach((fn) => fn())
}
