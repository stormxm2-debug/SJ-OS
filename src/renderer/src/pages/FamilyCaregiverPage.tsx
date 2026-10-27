import { useEffect, useState } from 'react'
import { ExternalLink, HeartHandshake, RefreshCw } from 'lucide-react'
import { getSupabaseClientOrNull, initSupabaseClient } from '@renderer/services/commercial/supabaseClient'

/**
 * 가족 간병인 접수 — 더헬퍼(The Helper) 접수 폼으로 연결.
 *
 * 더헬퍼 폼은 다른 사이트(cross-origin)라 우리 앱이 그쪽 입력칸에 자동 타이핑하는 것은
 * 브라우저 보안상 불가능하다. 그래서 "폼 열기 + 공유 로그인 복사 + 고객 안내문 복사" 방식으로 돕는다.
 *
 * 공유 로그인(아이디/비번)은 앱 소스·깃·번들에 넣지 않는다 — Supabase(app_shared_logins,
 * 로그인한 직원만 조회)에서 불러온다. 값 변경은 관리자가 DB에서 수정한다.
 */

const FORM_URL_FALLBACK = 'https://docs.thehelper.io/app/form'

interface SharedLogin {
  url: string | null
  login_id: string | null
  password: string | null
}

type MaybeDb = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: SharedLogin | null }> }
    }
  }
} | null

const DEFAULT_MESSAGE = `[가족 간병인 접수 안내]

안녕하세요, 가족 간병인 신청을 도와드립니다.
아래 링크에서 접수해 주세요.
▶ 접수: ${FORM_URL_FALLBACK}

접수 시 아래 정보가 필요합니다.

[환자]
• 환자 성함
• 환자 연락처 (없을 경우 보호자 연락처 가능)
• 환자 주민번호
• 입원 병원명
• 간병 시작 날짜

[간병인]
• 간병인 이름
• 간병인 연락처
• 간병인 주민번호
• 간병인 계좌번호 / 은행명

접수 후 담당 간병 매니저가 연락드립니다.
문의: (담당 FC 성함 / 연락처)`

export default function FamilyCaregiverPage(): JSX.Element {
  const [login, setLogin] = useState<SharedLogin | null>(null)
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [showEmbed, setShowEmbed] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        await initSupabaseClient()
        const db = getSupabaseClientOrNull() as MaybeDb
        if (!db) return
        const { data } = await db.from('app_shared_logins').select('url, login_id, password').eq('key', 'thehelper').maybeSingle()
        if (alive && data) setLogin(data)
      } catch {
        /* 로그인 정보를 못 불러오면 폼 열기만 제공 */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const url = (login?.url || '').trim() || FORM_URL_FALLBACK
  const openExternal = (): void => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const copy = async (tag: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(tag)
      window.setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500)
    } catch {
      /* 클립보드 차단 시 조용히 무시 — 값은 화면에 보이므로 직접 입력 가능 */
    }
  }

  let host = url
  try {
    host = new URL(url).host
  } catch {
    /* keep raw */
  }

  const bigCopyBtn = (tag: string, value: string): JSX.Element => (
    <button
      type="button"
      onClick={() => void copy(tag, value)}
      className="shrink-0 rounded-lg bg-[#0e1e3a] px-4 py-3 text-[14px] font-bold text-white transition hover:opacity-90"
    >
      {copied === tag ? '복사됨' : '복사'}
    </button>
  )

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
          <ExternalLink className="h-3.5 w-3.5" /> 폼 열기
        </button>
      </div>

      <div className="grid flex-1 gap-3 lg:grid-cols-2">
        {/* 왼쪽: 폼 열기 + 로그인 정보 */}
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-white px-6 py-8 text-center shadow-sm">
          <HeartHandshake className="h-10 w-10 text-[#0e1e3a]" />
          <h2 className="mt-3 text-base font-extrabold text-slate-100">더헬퍼 가족 간병인 접수</h2>
          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-slate-500">
            버튼을 누르면 접수 폼이 새 창으로 열립니다. 로그인 정보는 아래에서 복사해 붙여넣으세요.
          </p>

          <button
            type="button"
            onClick={openExternal}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#0e1e3a] px-5 py-3 text-[14px] font-bold text-white transition hover:opacity-90"
          >
            <ExternalLink className="h-4 w-4" /> 접수 폼 열기
          </button>

          {/* 공유 로그인 정보 — 눈에 확 보이게 크게 */}
          <div className="mt-6 w-full max-w-lg rounded-2xl border-2 border-[#e6c877] bg-slate-950 p-5 text-left shadow-md">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[15px] font-extrabold text-[#e6c877]">접수 폼 로그인</span>
              <span className="text-[12px] font-semibold text-slate-400">복사해서 입력</span>
            </div>
            {login?.login_id || login?.password ? (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-[13px] font-bold text-slate-400">아이디</div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 select-all rounded-lg border border-slate-700 bg-white px-3 py-3 text-[22px] font-extrabold tracking-wide text-slate-100">{login?.login_id || '-'}</code>
                    {bigCopyBtn('id', login?.login_id || '')}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[13px] font-bold text-slate-400">비밀번호</div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 select-all rounded-lg border border-slate-700 bg-white px-3 py-3 text-[22px] font-extrabold tracking-wide text-slate-100">{login?.password || '-'}</code>
                    {bigCopyBtn('pw', login?.password || '')}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-slate-500">로그인 정보를 불러오는 중… (로그인 후 표시됩니다)</p>
            )}
            <p className="mt-3 text-[12px] leading-relaxed text-slate-500">
              보안상 다른 사이트 입력칸은 자동 입력이 안 됩니다. 폼을 연 뒤 위 값을 복사해 로그인하세요.
            </p>
          </div>

          {!showEmbed ? (
            <button
              type="button"
              onClick={() => setShowEmbed(true)}
              className="mt-3 text-[12px] font-semibold text-slate-400 underline-offset-2 hover:underline"
            >
              앱 안에서 바로 보기(미리보기)
            </button>
          ) : null}
        </div>

        {/* 오른쪽: 고객에게 보낼 안내 메시지 */}
        <div className="flex flex-col rounded-2xl border border-slate-800 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-100">고객에게 보낼 안내</h2>
            <button
              type="button"
              onClick={() => void copy('msg', message)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0e1e3a] px-3 py-1.5 text-[12px] font-bold text-white transition hover:opacity-90"
            >
              {copied === 'msg' ? '복사됨' : '전체 복사'}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            고객에게 그대로 복사해 보낼 수 있는 접수 안내입니다. (괄호 부분은 고객·담당자에 맞게 수정)
          </p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            spellCheck={false}
            className="mt-2 min-h-[320px] flex-1 resize-none rounded-xl border border-slate-800 bg-slate-950 p-3 text-[12.5px] leading-relaxed text-slate-100 outline-none focus:border-slate-600"
          />
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMessage(DEFAULT_MESSAGE)}
              className="text-[11px] font-semibold text-slate-400 underline-offset-2 hover:underline"
            >
              기본 안내문으로 되돌리기
            </button>
            <span className="text-[11px] text-slate-500">{message.length}자</span>
          </div>
        </div>
      </div>

      {/* 선택적 앱 내 미리보기 */}
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
              src={url}
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
