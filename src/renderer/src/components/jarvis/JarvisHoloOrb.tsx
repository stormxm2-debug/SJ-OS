import type { AiCoreStatus } from './JarvisAiCore'

/**
 * 자비스 홀로그램 코어 오브 — 풀스크린 자비스의 심장.
 *
 * 다층 회전 링 + 펄스 글로우 + 궤도 파티클이 상태에 따라 색·속도를 바꾼다:
 * 대기(시안 호흡) → 듣는 중(로즈 파동) → 분석/설계(고속 회전) → 실행(골드) →
 * 완료(골드 버스트) → 오류(레드 플리커).
 *
 * ⚠️ 이 앱은 Tailwind 토큰(slate + 각 액센트 100~400)이 밝은 테마로 리매핑되어
 * 있으므로, 다크 오버레이 위 색은 전부 명시적 hex/rgba로만 쓴다.
 *
 * CSS-only(키프레임 + transform) — JS 애니메이션 루프·타이머 없음. 장식 전용이라
 * pointer-events-none (클릭 먹통 사고 방지 원칙 유지).
 */

const STATUS_TEXT: Record<AiCoreStatus, string> = {
  idle: '무엇이든 말씀하세요',
  wake: '호출 대기 중',
  listening: '듣고 있습니다…',
  transcribing: '음성을 해석하는 중…',
  analyzing: '명령을 분석하는 중…',
  planning: '업무 자동화를 설계하는 중…',
  prompting: '개발 프롬프트를 생성하는 중…',
  executing: '실행하는 중…',
  speaking: '말하는 중…',
  completed: '완료되었습니다',
  failed: '문제가 발생했습니다'
}

interface Tone {
  /** 코어 구체 그라디언트 (radial). */
  core: string
  /** 글로우 색 (box-shadow rgba). */
  glow: string
  /** 링/파동 색. */
  ring: string
  /** 상태 텍스트 색. */
  text: string
  /** 회전 링 속도 계수 — 낮을수록 빠름. */
  speed: number
}

const TONES: Record<AiCoreStatus, Tone> = {
  idle: { core: 'radial-gradient(circle at 32% 28%, #9be8ff 0%, #38bdf8 35%, #0b3f74 100%)', glow: 'rgba(56,189,248,0.55)', ring: 'rgba(103,232,249,0.8)', text: '#9adcff', speed: 1 },
  wake: { core: 'radial-gradient(circle at 32% 28%, #bae6fd 0%, #38bdf8 40%, #0c4a6e 100%)', glow: 'rgba(56,189,248,0.7)', ring: 'rgba(125,211,252,0.9)', text: '#bae6fd', speed: 0.8 },
  listening: { core: 'radial-gradient(circle at 32% 28%, #ffd7dd 0%, #fb7185 40%, #7f1d3a 100%)', glow: 'rgba(251,113,133,0.75)', ring: 'rgba(251,113,133,0.9)', text: '#fda4af', speed: 0.6 },
  transcribing: { core: 'radial-gradient(circle at 32% 28%, #cffafe 0%, #22d3ee 40%, #155e75 100%)', glow: 'rgba(34,211,238,0.75)', ring: 'rgba(103,232,249,0.9)', text: '#a5f3fc', speed: 0.4 },
  analyzing: { core: 'radial-gradient(circle at 32% 28%, #c7d9ff 0%, #60a5fa 40%, #1e3a8a 100%)', glow: 'rgba(96,165,250,0.75)', ring: 'rgba(147,197,253,0.9)', text: '#bfdbfe', speed: 0.35 },
  planning: { core: 'radial-gradient(circle at 32% 28%, #e6d9ff 0%, #a78bfa 40%, #4c1d95 100%)', glow: 'rgba(167,139,250,0.75)', ring: 'rgba(196,181,253,0.9)', text: '#ddd6fe', speed: 0.35 },
  prompting: { core: 'radial-gradient(circle at 32% 28%, #ffefc2 0%, #fbbf24 40%, #92400e 100%)', glow: 'rgba(251,191,36,0.75)', ring: 'rgba(252,211,77,0.9)', text: '#fde68a', speed: 0.35 },
  executing: { core: 'radial-gradient(circle at 32% 28%, #fff2cc 0%, #e6c877 40%, #8a6a1c 100%)', glow: 'rgba(230,200,119,0.8)', ring: 'rgba(230,200,119,0.95)', text: '#e6c877', speed: 0.3 },
  speaking: { core: 'radial-gradient(circle at 32% 28%, #fff7dd 0%, #ecd28a 38%, #206b9e 100%)', glow: 'rgba(230,200,119,0.75)', ring: 'rgba(240,217,152,0.95)', text: '#f0d998', speed: 0.5 },
  completed: { core: 'radial-gradient(circle at 32% 28%, #fff7dd 0%, #e6c877 42%, #7a5c14 100%)', glow: 'rgba(230,200,119,0.85)', ring: 'rgba(230,200,119,0.95)', text: '#f0d998', speed: 1.4 },
  failed: { core: 'radial-gradient(circle at 32% 28%, #ffd0d6 0%, #f43f5e 42%, #5f1020 100%)', glow: 'rgba(244,63,94,0.75)', ring: 'rgba(251,113,133,0.9)', text: '#fda4af', speed: 1.2 }
}

const ACTIVE: AiCoreStatus[] = ['wake', 'listening', 'transcribing', 'analyzing', 'planning', 'prompting', 'executing', 'speaking']

/** 궤도 파티클 정의 — 반지름(%), 크기(px), 주기(s), 시작 각도(deg). */
const PARTICLES = [
  { r: 46, s: 5, d: 7, a: 0 },
  { r: 52, s: 4, d: 11, a: 130 },
  { r: 58, s: 3, d: 9, a: 230 },
  { r: 42, s: 3, d: 13, a: 320 }
]

export default function JarvisHoloOrb({
  status,
  compact = false,
  statusLine
}: {
  status: AiCoreStatus
  /** true면 대화 진행 중 — 오브를 작게 접어 스트림 공간을 확보. */
  compact?: boolean
  /** 상태 문구 오버라이드 (예: '녹음 중 3.2초'). */
  statusLine?: string
}): JSX.Element {
  const tone = TONES[status]
  const active = ACTIVE.includes(status)
  const size = compact ? 96 : 190

  return (
    <div className="pointer-events-none relative flex flex-col items-center" aria-hidden>
      <style>{`
        @keyframes jarvis-holo-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes jarvis-holo-rotate-rev { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes jarvis-holo-breathe { 0%,100% { transform: scale(1); opacity: .9; } 50% { transform: scale(1.06); opacity: 1; } }
        @keyframes jarvis-holo-wave { 0% { transform: scale(.55); opacity: .7; } 100% { transform: scale(1.9); opacity: 0; } }
        @keyframes jarvis-holo-burst { 0% { transform: scale(.6); opacity: .9; } 100% { transform: scale(2.6); opacity: 0; } }
        @keyframes jarvis-holo-flicker { 0%,100% { opacity: 1; } 42% { opacity: .55; } 46% { opacity: .95; } 74% { opacity: .5; } 78% { opacity: 1; } }
        @keyframes jarvis-holo-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes jarvis-holo-scan { 0% { transform: translateY(-130%); } 100% { transform: translateY(130%); } }
        .jarvis-holo-rotate { animation: jarvis-holo-rotate 60s linear infinite; }
      `}</style>

      <div
        className="relative flex items-center justify-center transition-all duration-700 ease-out"
        style={{ width: size + 90, height: size + 90 }}
      >
        {/* 뒤 글로우 */}
        <span
          className="absolute rounded-full blur-3xl transition-all duration-700"
          style={{ inset: compact ? 8 : -8, background: tone.glow, opacity: active ? 0.4 : 0.24 }}
        />

        {/* 파동 링 — 듣는 중/실행 계열에서만 방사 */}
        {active ? (
          <>
            <span className="absolute rounded-full border-2" style={{ inset: 18, borderColor: tone.ring, animation: 'jarvis-holo-wave 1.8s ease-out infinite' }} />
            <span className="absolute rounded-full border" style={{ inset: 18, borderColor: tone.ring, animation: 'jarvis-holo-wave 1.8s ease-out .6s infinite' }} />
          </>
        ) : null}
        {/* 완료 골드 버스트 */}
        {status === 'completed' ? (
          <span className="absolute rounded-full border-2" style={{ inset: 18, borderColor: tone.ring, animation: 'jarvis-holo-burst 1.1s ease-out 2' }} />
        ) : null}

        {/* 회전 링 1 — 눈금 대시 링 */}
        <span
          className="absolute rounded-full transition-all duration-700"
          style={{
            inset: 12,
            border: '1px dashed rgba(148,208,255,0.4)',
            animation: `jarvis-holo-rotate ${14 * tone.speed}s linear infinite`
          }}
        />
        {/* 회전 링 2 — 이중 아크 (conic 마스크) */}
        <span
          className="absolute rounded-full transition-all duration-700"
          style={{
            inset: 22,
            background: `conic-gradient(from 0deg, transparent 0deg, ${tone.ring} 40deg, transparent 90deg, transparent 180deg, ${tone.ring} 230deg, transparent 290deg)`,
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 2px))',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 2px))',
            animation: `jarvis-holo-rotate-rev ${9 * tone.speed}s linear infinite`
          }}
        />
        {/* 회전 링 3 — 골드 미세 아크 */}
        <span
          className="absolute rounded-full"
          style={{
            inset: 34,
            background: 'conic-gradient(from 90deg, transparent 0deg, rgba(230,200,119,0.85) 24deg, transparent 60deg)',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), black calc(100% - 1px))',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), black calc(100% - 1px))',
            animation: `jarvis-holo-rotate ${6 * tone.speed}s linear infinite`
          }}
        />

        {/* 궤도 파티클 */}
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="absolute inset-0"
            style={{ animation: `jarvis-holo-orbit ${p.d * tone.speed}s linear infinite`, transform: `rotate(${p.a}deg)` }}
          >
            <span
              className="absolute rounded-full"
              style={{
                width: p.s,
                height: p.s,
                left: '50%',
                top: `${50 - p.r / 2}%`,
                background: i === 3 ? '#e6c877' : '#9be8ff',
                boxShadow: `0 0 ${p.s * 2.5}px ${i === 3 ? 'rgba(230,200,119,0.9)' : 'rgba(103,232,249,0.9)'}`
              }}
            />
          </span>
        ))}

        {/* 코어 구체 */}
        <span
          className="relative rounded-full transition-all duration-700"
          style={{
            width: size * 0.52,
            height: size * 0.52,
            background: tone.core,
            boxShadow: `0 0 ${active ? 64 : 40}px -6px ${tone.glow}, inset 0 0 24px rgba(255,255,255,0.18)`,
            animation:
              status === 'failed'
                ? 'jarvis-holo-flicker 1.6s linear infinite'
                : `jarvis-holo-breathe ${active ? 1.6 : 4.2}s ease-in-out infinite`
          }}
        >
          {/* 스펙큘러 하이라이트 */}
          <span
            className="absolute rounded-full"
            style={{ left: '22%', top: '16%', width: '26%', height: '26%', background: 'rgba(255,255,255,0.65)', filter: 'blur(4px)' }}
          />
          {/* 스캔 라인 */}
          <span className="absolute inset-0 overflow-hidden rounded-full">
            <span
              className="absolute inset-x-0 h-1/3"
              style={{
                background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.22), transparent)',
                animation: `jarvis-holo-scan ${2.6 * tone.speed}s ease-in-out infinite`
              }}
            />
          </span>
        </span>
      </div>

      {/* 상태 문구 */}
      <div
        className="-mt-3 text-center font-semibold tracking-wide transition-colors duration-500"
        style={{ color: tone.text, fontSize: compact ? 12 : 15, textShadow: `0 0 18px ${tone.glow}` }}
      >
        {statusLine ?? STATUS_TEXT[status]}
      </div>
    </div>
  )
}
