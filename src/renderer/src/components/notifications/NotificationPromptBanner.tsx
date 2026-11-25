import { useEffect, useState } from 'react'
import { BellRing, X, Loader2 } from 'lucide-react'
import { useSession } from '@renderer/navigation/SessionContext'
import { useNavigation } from '@renderer/navigation/NavigationContext'
import { getBackendConfig } from '@renderer/services/commercial/backendConfig'
import { ensureWebPushSubscription } from '@renderer/services/push/webPush'

/**
 * 알림 켜기 안내 줄 — 이 기기에서 알림이 꺼져 있으면 로그인한 모든 직원 화면 맨 위에 뜬다.
 * 브라우저·폰은 본인이 직접 [허용]을 눌러야만 알림을 켤 수 있어(원격으로 대신 켤 수 없음),
 * 각자 한 번만 누르면 되도록 버튼을 눈앞에 둔다. [오늘은 그만]은 그날 하루만 숨긴다.
 */

const SNOOZE_KEY = 'sj-notify-prompt-snooze'

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function snoozedToday(): boolean {
  try {
    return window.localStorage.getItem(SNOOZE_KEY) === today()
  } catch {
    return false
  }
}

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

/** 지금 이 기기에서 안내가 필요한지: 알림 미허용, 또는 아이폰 사파리 창(홈 화면 앱이 아니면 알림 불가). */
function needsPrompt(): boolean {
  try {
    if (isIOS() && !isStandalone()) return true
    if (typeof Notification === 'undefined') return false // 지원 안 되는 브라우저는 괜히 띄우지 않는다
    return Notification.permission !== 'granted'
  } catch {
    return false
  }
}

export default function NotificationPromptBanner(): JSX.Element | null {
  const { session } = useSession()
  const { navigate } = useNavigation()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!session.isLoggedIn || getBackendConfig().mode !== 'supabase') {
      setShow(false)
      return
    }
    setShow(needsPrompt() && !snoozedToday())
  }, [session.isLoggedIn])

  if (!show) return null

  const iosBrowser = isIOS() && !isStandalone()
  const denied = typeof Notification !== 'undefined' && Notification.permission === 'denied'

  const enable = async (): Promise<void> => {
    if (iosBrowser || denied) {
      navigate({ name: 'notification-settings' })
      return
    }
    setBusy(true)
    try {
      const p = await Notification.requestPermission()
      if (p === 'granted') {
        await ensureWebPushSubscription()
        setShow(false)
      } else {
        navigate({ name: 'notification-settings' })
      }
    } catch {
      navigate({ name: 'notification-settings' })
    } finally {
      setBusy(false)
    }
  }

  const snooze = (): void => {
    try {
      window.localStorage.setItem(SNOOZE_KEY, today())
    } catch {
      /* 저장 실패해도 이번 화면에서는 닫는다 */
    }
    setShow(false)
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-[#c6982f]/50 bg-[#fdf7ea] px-3 py-2.5 shadow-sm">
      <BellRing className="h-4 w-4 shrink-0 text-[#b0821f]" />
      <span className="min-w-0 flex-1 text-[12px] font-semibold text-[#6b5216]">
        {iosBrowser
          ? '아이폰은 홈 화면에 추가한 SJ 앱에서만 알림을 받을 수 있어요.'
          : denied
            ? '이 기기에서 알림이 차단돼 있어요. 고객등록 요청·메모를 바로 받으려면 차단을 풀어 주세요.'
            : '알림이 꺼져 있어요. 고객등록 요청·총무 메모를 바로 받으려면 알림을 켜 주세요.'}
      </span>
      <button
        type="button"
        onClick={() => void enable()}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-lg bg-[#0e1e3a] px-3 py-1.5 text-[12px] font-bold text-white transition hover:bg-[#1e3a5f] disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {iosBrowser || denied ? '방법 보기' : '알림 켜기'}
      </button>
      <button type="button" onClick={snooze} className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-[#8a6a1e] hover:bg-[#f4ecd6]">
        <X className="h-3 w-3" /> 오늘은 그만
      </button>
    </div>
  )
}
