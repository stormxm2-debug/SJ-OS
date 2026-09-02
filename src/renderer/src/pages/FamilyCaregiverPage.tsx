import { useState } from 'react'
import { ExternalLink, HeartHandshake, RefreshCw } from 'lucide-react'

/**
 * 가족 간병인 접수 — 더헬퍼(The Helper) 접수 사이트로 연결.
 *
 * API 연동이 아니라 "사이트 진입"만 제공한다(공식 API 문서 미확보 상태).
 * 앱 안 iframe 임베드를 우선 시도하고, 사이트가 임베드를 차단하면(X-Frame-Options 등)
 * '새 창으로 열기' 버튼으로 브라우저에서 접수한다.
 *
 * 접속 주소는 환경변수 VITE_THEHELPER_URL 로 바꿀 수 있다(기본: 더헬퍼 메인).
 * 정확한 '가족 간병인 접수' 페이지 경로가 확인되면 그 값만 바꿔 넣으면 된다.
 */

const HELPER_URL: string =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_THEHELPER_URL || '').trim() ||
  'https://www.thehelper.io/'

export default function FamilyCaregiverPage(): JSX.Element {
  const [nonce, setNonce] = useState(0)

  const openExternal = (): void => {
    window.open(HELPER_URL, '_blank', 'noopener,noreferrer')
  }

  let host = HELPER_URL
  try {
    host = new URL(HELPER_URL).host
  } catch {
    /* keep raw */
  }

  return (
    <div className="flex h-full flex-col space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-[#0e1e3a] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <HeartHandshake className="h-4 w-4 text-[#e6c877]" />
          <h1 className="text-sm font-extrabold text-white">가족 간병인 접수</h1>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">더헬퍼 · {host}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            title="다시 불러오기"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/10"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 새로고침
          </button>
          <button
            type="button"
            onClick={openExternal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#0e1e3a] transition hover:opacity-90"
          >
            <ExternalLink className="h-3.5 w-3.5" /> 새 창으로 열기
          </button>
        </div>
      </div>

      {/* 안내 */}
      <div className="rounded-xl border border-slate-800 bg-white px-4 py-2.5 text-[12px] text-slate-500">
        더헬퍼(The Helper) 가족 간병인 접수 사이트입니다. 아래 화면에서 바로 접수하시고, 앱 안에서 화면이 보이지 않으면
        (사이트 정책상 임베드 차단) 오른쪽 위 <b className="font-semibold text-slate-200">새 창으로 열기</b>를 눌러 브라우저에서 진행하세요.
      </div>

      {/* 임베드 */}
      <div className="relative flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-white shadow-sm">
        <iframe
          key={nonce}
          src={HELPER_URL}
          title="더헬퍼 가족 간병인 접수"
          className="h-full min-h-[62vh] w-full"
          referrerPolicy="no-referrer-when-downgrade"
          sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-top-navigation-by-user-activation"
        />
      </div>

      {/* 하단 폴백 버튼 */}
      <div className="flex items-center justify-center">
        <button
          type="button"
          onClick={openExternal}
          className="inline-flex items-center gap-2 rounded-xl bg-[#0e1e3a] px-4 py-2.5 text-[13px] font-bold text-white transition hover:opacity-90"
        >
          <ExternalLink className="h-4 w-4" /> 더헬퍼 접수 사이트 새 창으로 열기
        </button>
      </div>
    </div>
  )
}
