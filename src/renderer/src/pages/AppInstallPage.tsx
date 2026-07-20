import { useEffect, useMemo, useState } from 'react'
import { Smartphone, Monitor, QrCode, Copy, Check, Share2, Download, Link2, Loader2, Save, Globe } from 'lucide-react'
import QRCode from 'qrcode'
import { useSession } from '@renderer/navigation/SessionContext'
import { isAdminRole } from '@renderer/navigation/roleAccess'
import {
  webAppUrl,
  buildInviteText,
  getAppSetting,
  setAppSetting,
  SETTING_DESKTOP_DOWNLOAD_URL
} from '@renderer/services/commercial/appDistributionService'
import { copyText } from '@renderer/services/share/clipboard'

/**
 * 앱 설치 · 배포 — 전 직원: 폰 설치(PWA)와 PC 프로그램 다운로드.
 * 관리자: 웹 링크 배포 도구(복사·QR·초대 문안 공유)와 PC 설치파일 링크 등록.
 *
 * 폰 설치는 브라우저 설치 프롬프트(beforeinstallprompt)를 잡아 원버튼으로,
 * iOS·인앱브라우저는 환경을 감지해 맞는 안내를 보여준다. PC 설치파일은 용량
 * 문제(자료실 20MB 제한)로 외부 링크(구글드라이브 등)를 관리자가 등록하는
 * 방식 — app_settings(desktop_download_url)에 저장된다.
 */

type Phone = 'android' | 'ios' | 'inapp' | 'desktop'

function detectPhone(): Phone {
  const ua = navigator.userAgent
  if (/KAKAOTALK|Instagram|NAVER|Line\//i.test(ua)) return 'inapp'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

export default function AppInstallPage(): JSX.Element {
  const { session } = useSession()
  const admin = isAdminRole(session.role)
  const url = useMemo(() => webAppUrl(), [])
  const phone = useMemo(() => detectPhone(), [])

  // 브라우저 설치 프롬프트 (Android/데스크톱 크롬·엣지)
  const [installEvt, setInstallEvt] = useState<(Event & { prompt?: () => Promise<void> }) | null>(null)
  const [installed, setInstalled] = useState(false)
  useEffect(() => {
    const onPrompt = (e: Event): void => {
      e.preventDefault()
      setInstallEvt(e as Event & { prompt?: () => Promise<void> })
    }
    const onInstalled = (): void => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    // 이미 설치되어 standalone으로 떠 있는 경우
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true)
    } catch {
      /* ignore */
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // PC 설치파일 링크 (app_settings)
  const [desktopUrl, setDesktopUrl] = useState<string | null>(null)
  const [settingsReady, setSettingsReady] = useState(true)
  useEffect(() => {
    void getAppSetting(SETTING_DESKTOP_DOWNLOAD_URL).then((r) => {
      setDesktopUrl(r.value)
      setSettingsReady(r.configured)
    })
  }, [])

  // QR (관리자 배포용 + 회원도 보이면 유용 — 폰으로 찍어 이동)
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    QRCode.toDataURL(url, { width: 512, margin: 2, color: { dark: '#0e1e3a', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(null))
  }, [url])

  const [flash, setFlash] = useState('')
  const note = (m: string): void => {
    setFlash(m)
    window.setTimeout(() => setFlash(''), 4000)
  }

  const copyUrl = async (): Promise<void> => {
    note((await copyText(url)) ? '주소를 복사했습니다.' : '복사가 차단됐습니다 — 주소를 길게 눌러 복사해 주세요.')
  }
  const shareInvite = async (): Promise<void> => {
    const text = buildInviteText(url)
    try {
      if (navigator.share) {
        await navigator.share({ text })
        note('공유창을 열었습니다.')
        return
      }
    } catch {
      note('공유가 취소되었습니다.')
      return
    }
    note((await copyText(text)) ? '초대 문안을 복사했습니다 — 카톡에 붙여넣어 보내세요.' : '복사가 차단됐습니다.')
  }
  const install = async (): Promise<void> => {
    if (!installEvt?.prompt) return
    try {
      await installEvt.prompt()
      setInstallEvt(null)
    } catch {
      /* 사용자가 닫음 */
    }
  }

  // 관리자: PC 설치파일 링크 등록
  const [editUrl, setEditUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [adminMsg, setAdminMsg] = useState('')
  useEffect(() => {
    if (desktopUrl) setEditUrl(desktopUrl)
  }, [desktopUrl])
  const saveDesktopUrl = async (): Promise<void> => {
    const v = editUrl.trim()
    if (v && !/^https?:\/\//.test(v)) {
      setAdminMsg('http(s)로 시작하는 링크를 입력해 주세요.')
      return
    }
    setSaving(true)
    const r = await setAppSetting(SETTING_DESKTOP_DOWNLOAD_URL, v)
    setSaving(false)
    if (!r.ok) {
      setAdminMsg(r.error ?? '저장 실패')
      return
    }
    setDesktopUrl(v || null)
    setAdminMsg('✓ 저장됨 — 전 직원의 [PC 프로그램 받기] 버튼에 바로 반영됩니다.')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* 히어로 */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0e1e3a] to-[#1b3a6b] p-5 text-white">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-[#e6c877]" />
          <h1 className="text-lg font-extrabold">앱 설치 · 배포</h1>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-slate-300">
          폰에는 <b className="text-[#e6c877]">홈 화면 추가(설치)</b>로, PC에는 프로그램 또는 브라우저로 —
          같은 계정으로 어디서나 이어집니다.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold">
            <Globe className="h-3.5 w-3.5 text-[#e6c877]" /> {url.replace(/^https?:\/\//, '')}
          </span>
          <button type="button" onClick={() => void copyUrl()} className="inline-flex items-center gap-1 rounded-full bg-[#c6982f] px-3 py-1 text-[12px] font-bold text-[#201603]">
            <Copy className="h-3 w-3" /> 주소 복사
          </button>
        </div>
        {flash ? <p className="mt-2 text-[11px] text-[#e6c877]">{flash}</p> : null}
      </div>

      {/* 폰 설치 (전 직원) */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
          <Smartphone className="h-4 w-4 text-[#b0821f]" /> 폰에 설치 (홈 화면 추가)
        </h2>
        {installed ? (
          <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-emerald-600">
            <Check className="h-4 w-4" /> 이미 앱으로 설치되어 있습니다.
          </p>
        ) : installEvt ? (
          <button
            type="button"
            onClick={() => void install()}
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] px-4 py-2.5 text-[13px] font-extrabold text-[#e6c877] hover:brightness-125"
          >
            <Download className="h-4 w-4" /> 홈 화면에 앱 설치
          </button>
        ) : (
          <div className="mt-2 space-y-1.5 text-[13px] leading-6 text-slate-300">
            {phone === 'ios' ? (
              <p>
                아이폰: Safari에서 이 주소를 연 뒤 <b className="text-slate-100">공유 버튼(□↑) → 홈 화면에 추가</b>를 누르세요.
              </p>
            ) : phone === 'inapp' ? (
              <p>
                카톡 등 앱 안에서 열려 있습니다 — 우측 하단 메뉴에서 <b className="text-slate-100">다른 브라우저로 열기</b> 후
                <b className="text-slate-100"> 홈 화면에 추가</b>를 누르세요.
              </p>
            ) : (
              <p>
                크롬/삼성인터넷에서 이 주소를 연 뒤 <b className="text-slate-100">브라우저 메뉴(⋮) → 홈 화면에 추가(앱 설치)</b>를 누르세요.
              </p>
            )}
            <p className="text-[11px] text-slate-500">설치하면 아이콘·전체화면·알림까지 일반 앱과 똑같이 동작합니다.</p>
          </div>
        )}
      </div>

      {/* PC 프로그램 (전 직원) */}
      <div className="rounded-2xl border border-slate-800 bg-white p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
          <Monitor className="h-4 w-4 text-[#b0821f]" /> PC 프로그램
        </h2>
        {desktopUrl ? (
          <a
            href={desktopUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0e1e3a] to-[#1b3a6b] px-4 py-2.5 text-[13px] font-extrabold text-[#e6c877] hover:brightness-125"
          >
            <Download className="h-4 w-4" /> PC 프로그램 받기 (설치파일)
          </a>
        ) : (
          <p className="mt-2 text-[13px] text-slate-500">
            설치파일 준비 중입니다 — PC에서는 브라우저(크롬/엣지)로 <b className="text-slate-300">{url.replace(/^https?:\/\//, '')}</b>를 열어
            동일하게 사용할 수 있습니다.
          </p>
        )}
      </div>

      {/* 관리자: 웹 링크 배포 */}
      {admin ? (
        <div className="rounded-2xl border border-[#c6982f]/40 bg-white p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-100">
            <QrCode className="h-4 w-4 text-[#b0821f]" /> 웹 링크 배포 <span className="text-[11px] font-normal text-slate-500">(관리자)</span>
          </h2>
          <div className="mt-3 flex flex-col items-start gap-4 sm:flex-row">
            {qr ? (
              <div className="shrink-0 text-center">
                <img src={qr} alt="웹 주소 QR" className="h-40 w-40 rounded-xl border border-slate-800 bg-white p-2" />
                <a
                  href={qr}
                  download="sj-invest-qr.png"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#b0821f] hover:underline"
                >
                  <Download className="h-3 w-3" /> QR 이미지 저장
                </a>
              </div>
            ) : null}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-[12px] leading-5 text-slate-500">
                직원 초대는 셋 중 편한 방법으로: ① QR을 보여주고 폰으로 찍게 하기 ② 초대 문안을 카톡으로 보내기 ③ 주소 복사해서 전달.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void shareInvite()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e1e3a] px-3 py-2 text-[12px] font-bold text-[#e6c877] hover:brightness-125"
                >
                  <Share2 className="h-3.5 w-3.5" /> 초대 문안 카톡 공유
                </button>
                <button
                  type="button"
                  onClick={() => void copyUrl()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-[12px] font-bold text-slate-200 hover:border-[#c6982f]/60"
                >
                  <Copy className="h-3.5 w-3.5" /> 주소 복사
                </button>
              </div>
              {/* PC 설치파일 링크 등록 */}
              <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
                <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-200">
                  <Link2 className="h-3.5 w-3.5 text-[#b0821f]" /> PC 설치파일 다운로드 링크
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  설치파일(.exe)을 구글드라이브 등에 올리고 그 공유 링크를 등록하면, 위 [PC 프로그램 받기] 버튼이 전 직원에게 열립니다.
                </p>
                {!settingsReady ? (
                  <p className="mt-1.5 text-[11px] font-semibold text-amber-600">
                    설정 저장소 준비 전 — 총괄 세션에서 APP_SETTINGS SQL 적용 후 사용할 수 있습니다.
                  </p>
                ) : null}
                <div className="mt-1.5 flex gap-1.5">
                  <input
                    value={editUrl}
                    onChange={(e) => setEditUrl(e.target.value)}
                    placeholder="https://drive.google.com/..."
                    className="w-full rounded-lg border border-slate-800 bg-white px-2.5 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-[#c6982f]"
                  />
                  <button
                    type="button"
                    disabled={saving || !settingsReady}
                    onClick={() => void saveDesktopUrl()}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#0e1e3a] px-3 py-1.5 text-[12px] font-bold text-[#e6c877] hover:brightness-125 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 저장
                  </button>
                </div>
                {adminMsg ? <p className="mt-1 text-[11px] font-medium text-slate-400">{adminMsg}</p> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
