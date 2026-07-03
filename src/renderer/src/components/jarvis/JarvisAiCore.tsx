/**
 * Jarvis AI Core — a lightweight, CSS-only energy-core visual for the fast
 * command UX. A glowing orb with pulse rings whose colour + status text reflect
 * the current command phase. No animation libraries — only Tailwind's built-in
 * animate-ping / animate-pulse utilities, so it stays cheap and always smooth.
 */

export type AiCoreStatus = 'idle' | 'analyzing' | 'planning' | 'prompting' | 'completed' | 'failed'

const STATUS_TEXT: Record<AiCoreStatus, string> = {
  idle: '자비스 대기 중',
  analyzing: '명령 분석 중',
  planning: '업무 자동화 설계 중',
  prompting: '개발 프롬프트 생성 중',
  completed: '완료',
  failed: '실패'
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
  const active = status === 'analyzing' || status === 'planning' || status === 'prompting'

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-2">
      <div className="relative flex h-24 w-24 items-center justify-center">
        {/* Outer pulse ring — only animates while actively processing */}
        <span
          className={[
            'absolute inset-0 rounded-full border-2',
            tone.ring,
            active ? 'animate-ping opacity-60' : 'opacity-25'
          ].join(' ')}
        />
        {/* Middle breathing halo */}
        <span
          className={[
            'absolute inset-3 rounded-full bg-gradient-to-br opacity-40 blur-md',
            tone.core,
            active ? 'animate-pulse' : ''
          ].join(' ')}
        />
        {/* Core orb */}
        <span
          className={[
            'relative h-12 w-12 rounded-full bg-gradient-to-br',
            tone.core,
            tone.glow,
            active ? 'animate-pulse' : ''
          ].join(' ')}
        />
      </div>
      <div className={['text-sm font-medium', tone.text].join(' ')}>{STATUS_TEXT[status]}</div>
    </div>
  )
}
