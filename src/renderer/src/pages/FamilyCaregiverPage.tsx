import { useState } from 'react'
import { ExternalLink, HeartHandshake, RefreshCw } from 'lucide-react'

/**
 * 가족 간병인 접수 — 더헬퍼(The Helper) 접수 사이트로 연결.
 *
 * API 연동이 아니라 "사이트 열기"만 제공한다(공식 API 문서 미확보 — 추측 구현하지 않음).
 * 기본은 '새 창으로 열기'다. 더헬퍼가 iframe 임베드를 차단하는 경우가 많아, 앱 안 미리보기는
 * 사용자가 눌렀을 때만 띄워 빈 화면이 깨진 것처럼 보이지 않게 한다.
 *
 * 접속 주소는 환경변수 VITE_THEHELPER_URL 로 바꿀 수 있다(기본: 더헬퍼 메인).
 * 정확한 '가족 간병인 접수' 페이지 경로가 확인되면 그 값만 바꿔 넣으면 된다.
 */

const HELPER_URL: string =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_THEHELPER_URL || '').trim() ||
  'https://www.thehelper.io/'

export default function FamilyCaregiverPage(): JSX.Element {
  const [showEmbed, setShowEmbed] = useState(false)
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
        <button
          type="button"
          onClick={openExternal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#0e1e3a] transition hover:opacity-90"
        >
          <ExternalLink className="h-3.5 w-3.5" /> 새 창으로 열기
        </button>
      </div>

      {/* 열기 중심 카드 */}
      <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-slate-800 bg-white px-6 py-10 text-center shadow-sm">
        <HeartHandshake className="h-10 w-10 text-[#0e1e3a]" />
        <h2 className="mt-3 text-base font-extrabold text-slate-100">더헬퍼 가족 간병인 접수</h2>
        <p className="mt-1 max-w-md text-[13px] leading-relaxed text-slate-500">
          아래 버튼을 누르면 더헬퍼(The Helper) 가족 간병인 접수 사이트가 새 창으로 열립니다. 거기서 바로 접수하세요.
        </p>

        <button
          type="button"
          onClick={openExternal}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#0e1e3a] px-5 py-3 text-[14px] font-bold text-white transition hover:opacity-90"
        >
          <ExternalLink className="h-4 w-4" /> 더헬퍼 접수 사이트 열기
        </button>

        {!showEmbed ? (
          <button
            type="button"
            onClick={() => setShowEmbed(true)}
            className="mt-3 text-[12px] font-semibold text-slate-400 underline-offset-2 hover:underline"
          >
            앱 안에서 바로 보기(미리보기)
          </button>
        ) : (
          <p className="mt-3 max-w-md text-[11px] text-slate-400">
            아래 미리보기가 비어 있으면 더헬퍼 사이트가 앱 내 표시를 차단한 것입니다. 위 <b className="font-semibold text-slate-200">접수 사이트 열기</b>로 진행하세요.
          </p>
        )}
      </div>

      {/* 선택적 앱 내 미리보기 — 사용자가 눌렀을 때만 */}
      {showEmbed ? (
        <div className="flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-slate-300">앱 안 미리보기</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setNonce((n) => n + 1)}
                title="다시 불러오기"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-950"
              >
                <RefreshCw className="h-3.5 w-3.5" /> 새로고침
              </button>
              <button
                type="button"
                onClick={() => setShowEmbed(false)}
                className="inline-flex items-center rounded-lg border border-slate-700 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-950"
              >
                미리보기 닫기
              </button>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-white shadow-sm">
            <iframe
              key={nonce}
              src={HELPER_URL}
              title="더헬퍼 가족 간병인 접수"
              className="h-full min-h-[60vh] w-full"
              referrerPolicy="no-referrer-when-downgrade"
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-top-navigation-by-user-activation"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
