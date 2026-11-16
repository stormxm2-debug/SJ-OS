import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Copy, Info } from 'lucide-react'
import {
  GUIDE_CAUTIONS,
  GUIDE_INTRO,
  GUIDE_PREREQS,
  GUIDE_PROMPTS,
  GUIDE_STEPS,
  GUIDE_TROUBLE,
  type GuideCommand
} from '@renderer/services/aiTeamGuide/guideContent'

/**
 * AI 드림팀 연결 가이드. 명령은 실행하지 않고 복사만 한다.
 * 체크 상태와 펼침 상태는 이 기기에만 기억한다(개인 편의용, 서버 저장 없음).
 * 색은 명시 값 사용(앱 slate 반전 회피).
 */

const NAVY = '#0e1e3a'
const MUTED = '#64748b'
const LINE = '#cbd5e1'
const SOFT = '#f8fafc'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 클립보드 API가 막힌 환경: 임시 입력칸으로 복사 시도
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

function CopyRow({ cmd }: { cmd: GuideCommand }): JSX.Element {
  const [done, setDone] = useState<'idle' | 'ok' | 'fail'>('idle')
  const onCopy = async (): Promise<void> => {
    const ok = await copyText(cmd.text)
    setDone(ok ? 'ok' : 'fail')
    window.setTimeout(() => setDone('idle'), 2000)
  }
  return (
    <div className="rounded-lg border p-2.5" style={{ borderColor: LINE, backgroundColor: '#ffffff' }}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold" style={{ color: NAVY }}>
          {cmd.label}
        </span>
        <button
          type="button"
          onClick={() => void onCopy()}
          aria-label={`${cmd.label} 복사`}
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-bold text-white"
          style={{ backgroundColor: NAVY }}
        >
          {done === 'ok' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {done === 'ok' ? '복사됨' : done === 'fail' ? '복사 실패' : '복사'}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-all rounded-md p-2 text-[12px] leading-relaxed" style={{ backgroundColor: SOFT, color: NAVY }}>
        {cmd.text}
      </pre>
      {cmd.note ? (
        <p className="mt-1 text-[12px] leading-relaxed" style={{ color: MUTED }}>
          {cmd.note}
        </p>
      ) : null}
    </div>
  )
}

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }): JSX.Element {
  const [open, setOpen] = useState(Boolean(defaultOpen))
  return (
    <section className="rounded-2xl border bg-white" style={{ borderColor: LINE }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left"
      >
        <span className="text-[15px] font-bold" style={{ color: NAVY }}>
          {title}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? 'rotate-180' : ''}`} style={{ color: MUTED }} />
      </button>
      {open ? <div className="space-y-2.5 px-3.5 pb-3.5">{children}</div> : null}
    </section>
  )
}

const CHECK_KEY = 'sj-ai-team-guide-checks-v1'

function loadChecks(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(CHECK_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

export default function AiTeamGuidePage(): JSX.Element {
  const [checks, setChecks] = useState<Record<string, boolean>>(() => loadChecks())
  const toggle = (id: string): void => {
    setChecks((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try {
        window.localStorage.setItem(CHECK_KEY, JSON.stringify(next))
      } catch {
        /* 저장 불가 환경은 이번 화면 동안만 유지 */
      }
      return next
    })
  }

  const CHECK_ITEMS = ['node', 'codex', 'agy']
  const CHECK_LABELS: Record<string, string> = {
    node: 'Node.js 18.18 이상 설치 확인',
    codex: '코덱스(GPT) 연결 시험 CODEX_OK 확인',
    agy: '안티그래비티(제미나이) 연결 시험 AGY_OK 확인'
  }
  const doneCount = CHECK_ITEMS.filter((k) => checks[k]).length

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 p-3 sm:p-4">
      <header className="space-y-1.5">
        <h1 className="text-lg font-bold" style={{ color: NAVY }}>
          AI 드림팀 연결 가이드
        </h1>
        <p className="text-[13px] leading-relaxed" style={{ color: MUTED }}>
          {GUIDE_INTRO}
        </p>
      </header>

      <Section title="준비물" defaultOpen>
        <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed" style={{ color: NAVY }}>
          {GUIDE_PREREQS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </Section>

      <Section title={`연결 진행 체크 (${doneCount}/${CHECK_ITEMS.length})`} defaultOpen>
        <p className="text-[12px]" style={{ color: MUTED }}>
          각 단계를 마치면 체크하세요. 이 기기에만 저장됩니다.
        </p>
        {CHECK_ITEMS.map((k) => (
          <label key={k} className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5" style={{ borderColor: LINE }}>
            <input type="checkbox" checked={!!checks[k]} onChange={() => toggle(k)} className="h-4 w-4" style={{ accentColor: NAVY }} />
            <span className="text-[13px] font-semibold" style={{ color: checks[k] ? MUTED : NAVY }}>
              {CHECK_LABELS[k]}
            </span>
          </label>
        ))}
      </Section>

      {GUIDE_STEPS.map((step, idx) => (
        <Section key={step.id} title={step.title} defaultOpen={idx === 0}>
          <p className="text-[13px] leading-relaxed" style={{ color: NAVY }}>
            {step.summary}
          </p>
          {step.commands.map((c) => (
            <CopyRow key={c.id} cmd={c} />
          ))}
        </Section>
      ))}

      <Section title="바로 쓰는 지시 문장 10개">
        <p className="text-[12px]" style={{ color: MUTED }}>
          클로드 Code 탭에 붙여넣고 괄호 안만 바꾸세요.
        </p>
        {GUIDE_PROMPTS.map((p) => (
          <CopyRow key={p.id} cmd={p} />
        ))}
      </Section>

      <Section title="막혔을 때">
        {GUIDE_TROUBLE.map((t) => (
          <div key={t.q} className="rounded-lg border px-3 py-2.5" style={{ borderColor: LINE }}>
            <p className="text-[13px] font-semibold" style={{ color: NAVY }}>
              {t.q}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: MUTED }}>
              {t.a}
            </p>
          </div>
        ))}
      </Section>

      <section className="space-y-2 rounded-2xl border p-3.5" style={{ borderColor: '#fde68a', backgroundColor: '#fffbeb' }}>
        <div className="flex items-center gap-1.5 text-[13px] font-bold" style={{ color: '#92400e' }}>
          <AlertTriangle className="h-4 w-4" /> 꼭 알아 두세요
        </div>
        <ul className="list-disc space-y-1 pl-5 text-[12px] leading-relaxed" style={{ color: '#78350f' }}>
          {GUIDE_CAUTIONS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="flex items-start gap-1.5 text-[12px]" style={{ color: MUTED }}>
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> 설치 명령과 버전은 각 공식 안내와 함께 확인하세요.
        </p>
      </section>
    </div>
  )
}
