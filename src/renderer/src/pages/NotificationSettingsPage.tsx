import { useEffect, useState } from 'react'
import { Bell, BellRing, CheckCircle2, AlertTriangle, Loader2, Monitor, Smartphone, Send } from 'lucide-react'
import Card from '@renderer/components/ui/Card'
import { isElectronRuntime, useIsMobile } from '@renderer/navigation/appTarget'
import { ensureWebPushSubscription, sendTestPush, webPushSupported } from '@renderer/services/push/webPush'

/**
 * 알림 설정 — 알림 켜기 + 알림 테스트 + 기기별(PC·폰) 알림 켜는 방법.
 *
 *  · 알림 켜기: OS 알림 권한 요청 → 허용되면 이 기기를 서버 알림(웹 푸시) 대상으로 등록.
 *  · 알림 테스트: ① 이 화면에서 바로 OS 알림을 띄워 "이 기기에서 알림이 보이는지" 확인
 *                 ② 서버를 거쳐 내 계정에 등록된 모든 기기(폰·PC 브라우저)로 시험 발송.
 *  · PC 앱(Electron)은 웹 푸시를 받을 수 없어, 앱이 켜져 있는 동안만 알림이 뜬다.
 *    앱을 닫아도 받으려면 크롬/엣지에서 사이트를 열고 알림을 켜야 한다 — 화면에서 안내.
 */

type Perm = NotificationPermission | 'unsupported'

function readPerm(): Perm {
  try {
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  } catch {
    return 'unsupported'
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

/** 이 기기에서 바로 OS 알림을 띄운다 (안드로이드 크롬은 서비스워커로만 띄울 수 있다). */
async function showLocalTest(): Promise<boolean> {
  const title = 'SJ 알림 테스트 (이 기기)'
  const body = '이 알림이 보이면 이 기기에서 알림이 정상입니다.'
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg) {
        await reg.showNotification(title, { body, tag: `local-test-${Date.now()}`, icon: '/sj-icon-512.png' })
        return true
      }
    }
    new Notification(title, { body })
    return true
  } catch {
    return false
  }
}

export default function NotificationSettingsPage(): JSX.Element {
  const electron = isElectronRuntime()
  const mobile = useIsMobile()
  const ios = isIOS()
  const [perm, setPerm] = useState<Perm>(() => readPerm())
  const [busy, setBusy] = useState<'enable' | 'test' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // 다른 탭/설정에서 권한을 바꾸고 돌아오면 반영
  useEffect(() => {
    const onFocus = (): void => setPerm(readPerm())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const canWebPush = !electron && webPushSupported()

  const enable = async (): Promise<void> => {
    setBusy('enable')
    setMsg(null)
    try {
      const p = typeof Notification === 'undefined' ? 'unsupported' : await Notification.requestPermission()
      setPerm(p)
      if (p !== 'granted') {
        setMsg({
          ok: false,
          text: p === 'denied' ? '알림이 차단돼 있습니다. 아래 "알림 켜는 방법"대로 차단을 풀어 주세요.' : '이 기기·브라우저는 알림을 지원하지 않습니다.'
        })
        return
      }
      if (canWebPush) {
        const r = await ensureWebPushSubscription()
        setMsg(
          r.ok
            ? { ok: true, text: '알림이 켜졌습니다. 이제 [알림 테스트]를 눌러 확인해 보세요.' }
            : { ok: false, text: '알림 권한은 켜졌지만 서버 등록에 실패했습니다. 로그인 상태를 확인하고 다시 눌러 주세요.' }
        )
      } else {
        setMsg({ ok: true, text: '알림이 켜졌습니다. [알림 테스트]로 확인해 보세요.' })
      }
    } finally {
      setBusy(null)
    }
  }

  const test = async (): Promise<void> => {
    setBusy('test')
    setMsg(null)
    try {
      if (readPerm() !== 'granted') {
        setMsg({ ok: false, text: '먼저 [알림 켜기]를 눌러 알림을 허용해 주세요.' })
        return
      }
      const local = await showLocalTest()
      if (!canWebPush) {
        setMsg(
          local
            ? {
                ok: true,
                text: 'PC 앱 알림을 띄웠습니다. 화면 오른쪽 아래에 알림이 보이면 정상입니다. (PC 앱은 켜져 있을 때만 알림이 옵니다)'
              }
            : { ok: false, text: '알림을 띄우지 못했습니다. 아래 "윈도우 알림 설정"을 확인해 주세요.' }
        )
        return
      }
      await ensureWebPushSubscription()
      const r = await sendTestPush()
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? '시험 알림 요청에 실패했습니다.' })
        return
      }
      if (r.devices === 0) {
        setMsg({ ok: false, text: '이 계정에 등록된 기기가 없습니다. [알림 켜기]를 다시 눌러 주세요.' })
        return
      }
      setMsg({
        ok: true,
        text: `이 기기에 바로 1개, 서버를 거쳐 내 기기 ${r.devices}대 중 ${r.sent}대로 시험 알림을 보냈습니다. 몇 초 안에 "SJ 알림 테스트 🔔"가 오면 정상입니다.`
      })
    } finally {
      setBusy(null)
    }
  }

  const permLabel =
    perm === 'granted' ? '켜짐' : perm === 'denied' ? '차단됨' : perm === 'default' ? '아직 설정 안 함' : '지원 안 됨'
  const permTone =
    perm === 'granted' ? 'bg-emerald-50 text-emerald-700' : perm === 'denied' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
  const deviceLabel = electron ? 'PC 앱' : mobile ? (ios ? (isStandalone() ? '아이폰 앱(홈 화면)' : '아이폰 사파리') : '폰 브라우저/앱') : 'PC 브라우저'

  return (
    <div className="space-y-4">
      <Card title="알림 설정" icon={<Bell className="h-4 w-4 text-indigo-600" />}>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-slate-400">이 기기</span>
          <span className="rounded-full bg-slate-950 px-2.5 py-0.5 text-[12px] font-bold text-slate-200">{deviceLabel}</span>
          <span className="text-slate-400">알림</span>
          <span className={['rounded-full px-2.5 py-0.5 text-[12px] font-bold', permTone].join(' ')}>{permLabel}</span>
        </div>

        {ios && !isStandalone() ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            아이폰은 사파리 창에서는 알림을 받을 수 없습니다. 아래 &quot;아이폰&quot; 방법대로 홈 화면에 추가한 뒤, 그 아이콘으로 열어서 알림을 켜 주세요.
          </p>
        ) : null}
        {electron ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12px] text-indigo-800">
            <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            PC 앱은 켜져 있는 동안 알림이 뜹니다. 앱을 꺼 두어도 알림을 받으려면 크롬이나 엣지에서 SJ 사이트를 열고 거기서 알림을 켜 주세요.
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void enable()}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
          >
            {busy === 'enable' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            알림 켜기
          </button>
          <button
            type="button"
            onClick={() => void test()}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-white px-4 py-2.5 text-sm font-bold text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-60"
          >
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            알림 테스트
          </button>
        </div>

        {msg ? (
          <p
            className={[
              'mt-3 flex items-start gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium',
              msg.ok ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-rose-200 bg-rose-50 text-rose-700'
            ].join(' ')}
          >
            {msg.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {msg.text}
          </p>
        ) : null}

        <p className="mt-3 text-[11px] text-slate-500">
          앱을 닫아도 오는 알림: 고객등록 새 요청 · 총무 메모 · 완료 · 반려. 그 밖의 알림(DB 배정, 면책 종료 등)은 앱이 켜져 있을 때 뜹니다.
        </p>
      </Card>

      <Card title="컴퓨터(PC) 알림 켜는 방법" icon={<Monitor className="h-4 w-4 text-indigo-600" />}>
        <Guide
          title="① 크롬·엣지에서 SJ 사이트를 쓸 때 (앱을 닫아도 알림 받기)"
          steps={[
            '크롬 또는 엣지로 SJ 사이트에 로그인합니다.',
            '이 화면의 [알림 켜기]를 누르고, 주소창 아래 뜨는 창에서 [허용]을 누릅니다.',
            '차단했었다면: 주소창 왼쪽 자물쇠(또는 설정) 아이콘 → 사이트 설정 → 알림 → [허용]으로 바꾸고 새로고침합니다.',
            '브라우저를 닫아도 받으려면: 크롬 설정 → 시스템 → "Google Chrome이 종료되어도 백그라운드 앱 계속 실행" 켜기 (엣지: 설정 → 시스템 및 성능 → "Microsoft Edge가 닫힌 후에도 백그라운드 확장 및 앱 계속 실행" 켜기).',
            '[알림 테스트]를 눌러 화면 오른쪽 아래에 알림이 뜨는지 확인합니다.'
          ]}
        />
        <Guide
          title="② SJ INVEST PC 앱을 쓸 때"
          steps={[
            'PC 앱은 켜져 있는 동안 알림이 뜹니다 (작업 표시줄에 최소화해 둬도 됩니다).',
            '[알림 테스트]를 눌러 화면 오른쪽 아래에 알림이 뜨는지 확인합니다.',
            '안 뜨면 아래 ③ 윈도우 알림 설정을 확인하고, 앱을 최신 버전으로 업데이트해 주세요.'
          ]}
        />
        <Guide
          title="③ 윈도우 알림 설정 (알림이 안 뜰 때)"
          steps={[
            '시작 → 설정 → 시스템 → 알림 으로 들어갑니다.',
            '맨 위 "알림"을 [켬]으로 둡니다.',
            '아래 앱 목록에서 Google Chrome / Microsoft Edge / SJ INVEST 를 [켬]으로 둡니다.',
            '"방해 금지"(윈도우 10은 "집중 지원")가 켜져 있으면 끕니다.'
          ]}
        />
        <Guide
          title="맥(Mac)"
          steps={['시스템 설정 → 알림 → Google Chrome(또는 사용하는 브라우저) → 알림 허용을 켭니다.', '"집중 모드"가 켜져 있으면 끕니다.']}
        />
      </Card>

      <Card title="폰 알림 켜는 방법" icon={<Smartphone className="h-4 w-4 text-indigo-600" />}>
        <Guide
          title="안드로이드(갤럭시 등)"
          steps={[
            '크롬으로 SJ 사이트에 로그인합니다 (홈 화면에 추가해 앱처럼 써도 됩니다).',
            '[알림 켜기] → [허용]을 누릅니다.',
            '차단했었다면: 폰 설정 → 애플리케이션 → Chrome → 알림 → 허용, 그리고 크롬 주소창 자물쇠 → 권한 → 알림 허용.',
            '[알림 테스트]로 확인합니다.'
          ]}
        />
        <Guide
          title="아이폰"
          steps={[
            '사파리로 SJ 사이트를 엽니다.',
            '아래 가운데 [공유] 버튼 → [홈 화면에 추가]를 누릅니다.',
            '홈 화면에 생긴 SJ 아이콘으로 앱을 열고 로그인합니다 (사파리 창에서는 알림이 안 옵니다).',
            '[알림 켜기] → [허용] 후 [알림 테스트]로 확인합니다.',
            '안 오면: 아이폰 설정 → 알림 → SJ → 알림 허용 켜기.'
          ]}
        />
      </Card>
    </div>
  )
}

function Guide({ title, steps }: { title: string; steps: string[] }): JSX.Element {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-[13px] font-bold text-slate-200">{title}</div>
      <ol className="list-decimal space-y-0.5 pl-5 text-[12px] leading-5 text-slate-400">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  )
}
