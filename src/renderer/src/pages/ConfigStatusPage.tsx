import { useEffect, useState } from 'react'
import { ServerCog, RefreshCw, Check, X, Loader2, AlertTriangle, KeyRound } from 'lucide-react'
import { fetchConfigHealth, type ConfigHealth } from '@renderer/services/content-studio/configHealthService'

/**
 * 서버 설정 상태 — 대표·관리자 전용. 각 외부 연동 키(시크릿) 등록 여부를 한눈에 본다.
 * 키 "값"은 서버가 반환하지 않으며(등록 여부만), 등록은 Supabase 대시보드에서 직접 한다.
 */

interface FeatureRow {
  group: string
  label: string
  unlocks: string
  keys: string[]
}

const FEATURES: FeatureRow[] = [
  { group: 'claude', label: 'Claude AI', unlocks: '콘텐츠 스튜디오(글)·경영비서·청구비서·보험분석·자료브리핑·제안서요약·인수심사·건강기록 AI', keys: ['ANTHROPIC_API_KEY'] },
  { group: 'openai', label: 'OpenAI', unlocks: '상담코치·보험튜터·영수증 비전인식·미팅브리핑·일정 자연어·실시간 음성', keys: ['OPENAI_API_KEY'] },
  { group: 'messaging', label: '문자(MMS)', unlocks: '사진문자 발송', keys: ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_SENDER_PHONE'] },
  { group: 'alimtalk', label: '알림톡', unlocks: '카카오 알림톡·면책 안내 발송', keys: ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_PF_ID'] },
  { group: 'fax', label: '팩스', unlocks: '보험금 청구 팩스 발송', keys: ['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SOLAPI_FAX_SENDER'] },
  { group: 'push', label: '웹푸시 알림', unlocks: '브라우저 푸시 알림', keys: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] },
  { group: 'image', label: 'AI 이미지(힉스필드)', unlocks: '콘텐츠 스튜디오 이미지 생성', keys: ['HIGGSFIELD_API_KEY_ID', 'HIGGSFIELD_API_KEY_SECRET'] }
]

export default function ConfigStatusPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [health, setHealth] = useState<ConfigHealth | undefined>()

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    const res = await fetchConfigHealth()
    setLoading(false)
    if (!res.ok || !res.data) {
      setError(res.error ?? '불러오지 못했습니다.')
      return
    }
    setHealth(res.data)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groupOk = (f: FeatureRow): boolean => {
    if (health?.groups && f.group in health.groups) return Boolean(health.groups[f.group])
    return f.keys.every((k) => health?.present?.[k])
  }

  const readyCount = health ? FEATURES.filter((f) => groupOk(f)).length : 0

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#0e1e3a] px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-base font-extrabold text-white">
            <ServerCog className="h-5 w-5 text-[#e6c877]" /> 서버 설정 상태
          </div>
          <div className="mt-0.5 text-[12px] font-medium text-white/80">외부 연동 키(시크릿) 등록 여부 — 대표·관리자 전용</div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#c6982f]/50 bg-white/10 px-3 py-1.5 text-[12px] font-bold text-[#e6c877] disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 새로고침
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-medium text-rose-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      ) : null}

      {health ? (
        <div className="rounded-2xl border border-slate-800 bg-white p-2 shadow-sm">
          <div className="px-3 py-2 text-[12px] font-semibold text-slate-500">
            작동 준비 완료 <span className="font-extrabold text-slate-100">{readyCount}</span> / {FEATURES.length}
          </div>
          <div className="divide-y divide-slate-100">
            {FEATURES.map((f) => {
              const ok = groupOk(f)
              const missing = f.keys.filter((k) => !health.present?.[k])
              return (
                <div key={f.group} className="flex items-start gap-3 px-3 py-2.5">
                  <span className={['mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full', ok ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'].join(' ')}>
                    {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-slate-100">{f.label}</span>
                      <span className={['rounded-full px-2 py-0.5 text-[10px] font-bold', ok ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'].join(' ')}>
                        {ok ? '작동' : '미설정'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">{f.unlocks}</div>
                    {!ok && missing.length > 0 ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                        <KeyRound className="h-3 w-3" /> 누락:
                        {missing.map((k) => (
                          <code key={k} className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{k}</code>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-[#c6982f]/40 bg-[#fdf9ef] px-4 py-3 text-[12px] leading-5 text-slate-600">
        키 등록은 보안상 여기서 하지 않고 <b className="text-slate-800">Supabase 대시보드 → Edge Functions → Secrets</b> 에서 직접 추가합니다.
        이 화면은 등록 여부(있음/없음)만 보여주며, 키 값은 서버가 반환하지 않습니다.
      </div>
    </div>
  )
}
