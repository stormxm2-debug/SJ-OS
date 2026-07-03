/**
 * Jarvis AI Core — a lightweight, CSS-only energy-core visual for the fast
 * command UX. A glowing orb with pulse rings whose colour + status text reflect
 * the current command phase. No animation libraries — only Tailwind's built-in
 * animate-ping / animate-pulse utilities, so it stays cheap and always smooth.
 */

export type AiCoreStatus =
  | 'idle'
  | 'wake'
  | 'listening'
  | 'transcribing'
  | 'analyzing'
  | 'planning'
  | 'prompting'
  | 'executing'
  | 'completed'
  | 'failed'

const STATUS_TEXT: Record<AiCoreStatus, string> = {
  idle: '자비스 대기 중',
  wake: '호출 대기 중',
  listening: '듣는 중',
  transcribing: '전사 중',
  analyzing: '명령 분석 중',
  planning: '업무 자동화 설계 중',
  prompting: '개발 프롬프트 생성 중',
  executing: '실행 중',
  completed: '완료',
  failed: '오류 발생'
}

interface Tone {
  core: string
  glow: string
  ring: string
  text: string
}

const TONES: Record<AiCoreStatus, Tone> = {
  idle: {
    core: 'from-slate-600 to-slate-800',
    glow: 'shadow-[0_0_30px_-4px_rgba(100,116,139,0.6)]',
    ring: 'border-slate-600/40',
    text: 'text-slate-400'
  },
  wake: {
    core: 'from-sky-500 to-blue-600',
    glow: 'shadow-[0_0_38px_-4px_rgba(56,189,248,0.6)]',
    ring: 'border-sky-400/40',
    text: 'text-sky-300'
  },
  listening: {
    core: 'from-rose-400 to-rose-600',
    glow: 'shadow-[0_0_44px_-2px_rgba(244,63,94,0.7)]',
    ring: 'border-rose-400/50',
    text: 'text-rose-300'
  },
  transcribing: {
    core: 'from-sky-400 to-cyan-600',
    glow: 'shadow-[0_0_44px_-2px_rgba(56,189,248,0.7)]',
    ring: 'border-sky-400/50',
    text: 'text-sky-300'
  },
  analyzing: {
    core: 'from-sky-400 to-indigo-600',
    glow: 'shadow-[0_0_44px_-2px_rgba(99,102,241,0.7)]',
    ring: 'border-indigo-400/50',
    text: 'text-indigo-300'
  },
  planning: {
    core: 'from-violet-400 to-fuchsia-600',
    glow: 'shadow-[0_0_44px_-2px_rgba(168,85,247,0.7)]',
    ring: 'border-violet-400/50',
    text: 'text-violet-300'
  },
  prompting: {
    core: 'from-amber-300 to-orange-600',
    glow: 'shadow-[0_0_44px_-2px_rgba(245,158,11,0.7)]',
    ring: 'border-amber-400/50',
    text: 'text-amber-300'
  },
  executing: {
    core: 'from-amber-400 to-yellow-500',
    glow: 'shadow-[0_0_46px_-2px_rgba(212,167,44,0.8)]',
    ring: 'border-amber-400/50',
    text: 'text-amber-300'
  },
  completed: {
    core: 'from-emerald-300 to-emerald-600',
    glow: 'shadow-[0_0_40px_-2px_rgba(16,185,129,0.7)]',
    ring: 'border-emerald-400/50',
    text: 'text-emerald-300'
  },
  failed: {
    core: 'from-rose-400 to-rose-700',
    glow: 'shadow-[0_0_40px_-2px_rgba(244,63,94,0.7)]',
    ring: 'border-rose-400/50',
    text: 'text-rose-300'
  }
}

export default function JarvisAiCore({ status }: { status: AiCoreStatus }): JSX.Element {
  const tone = TONES[status]
  const active =
    status === 'wake' ||
    status === 'listening' ||
    status === 'transcribing' ||
    status === 'analyzing' ||
    status === 'planning' ||
    status === 'prompting' ||
    status === 'executing'

  return (
    // Purely decorative — never captures clicks (interaction-lock safety).
    // CSS-only visuals: one slow-rotating conic aura + rings + glossy core. No
    // JS animation loop, no timers, no listeners; stays lightweight on any GPU.
    <div className="pointer-events-none flex flex-col items-center justify-center gap-3 py-4">
      <div className="relative flex h-28 w-28 items-center justify-center">
        {/* Rotating energy aura — a single cheap CSS transform (spin) */}
        <span className="absolute inset-0 rounded-full opacity-30 animate-[spin_11s_linear_infinite] [background:conic-gradient(from_0deg,#6366f1,#a78bfa,#22d3ee,#818cf8,#6366f1)]" />
        {/* Outer ring — gently pulses only while actively processing */}
        <span
          className={[
            'absolute inset-1 rounded-full border-2',
            tone.ring,
            active ? 'animate-pulse opacity-80' : 'opacity-40'
          ].join(' ')}
        />
        {/* Static mid ring for depth */}
        <span className={['absolute inset-5 rounded-full border', tone.ring, 'opacity-50'].join(' ')} />
        {/* Glossy core orb with a specular highlight + status glow */}
        <span
          className={[
            'relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br ring-1 ring-white/20',
            tone.core,
            tone.glow,
            active ? 'animate-pulse' : ''
          ].join(' ')}
        >
          <span className="absolute left-3 top-2.5 h-3.5 w-3.5 rounded-full bg-white/60" />
          <span className="absolute inset-0 rounded-full bg-gradient-to-t from-black/15 to-transparent" />
        </span>
      </div>
      <div className={['text-sm font-semibold tracking-wide', tone.text].join(' ')}>
        {STATUS_TEXT[status]}
      </div>
    </div>
  )
}
