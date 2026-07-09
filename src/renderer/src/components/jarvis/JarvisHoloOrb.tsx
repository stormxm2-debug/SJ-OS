import type { AiCoreStatus } from './JarvisAiCore'

/**
 * 자비스 홀로그램 코어 오브 v2 — "이그제큐티브" 럭셔리 에디션.
 *
 * 3D 자이로스코프 링 3개(서로 다른 축·방향·속도) + 평면 정밀 링 6개(대시·헤어라인·
 * 이중 아크·골드 아크) + 궤도 파티클 6개 + 회전 광택 코어. 상태에 따라 색·속도가
 * 바뀐다: 대기(아이스 블루 호흡) → 듣는 중(로즈 파동) → 분석(가속 회전) →
 * 실행(샴페인 골드) → 말하는 중(골드 진동) → 완료(골드 버스트) → 오류(플리커).
 *
 * ⚠️ 이 앱은 Tailwind 토큰(slate + 액센트 100~400)이 밝은 테마로 리매핑되어
 * 있으므로, 다크 오버레이 위 색은 전부 명시적 hex/rgba로만 쓴다.
 *
 * CSS-only(키프레임 + transform, GPU 합성) — JS 애니메이션 루프·타이머 없음.
 * 장식 전용이라 pointer-events-none (클릭 먹통 사고 방지 원칙 유지).
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
  /** 글로우 색 (rgba). */
  glow: string
  /** 주 링/파동 색. */
  ring: string
  /** 상태 텍스트 색. */
  text: string
  /** 회전 속도 계수 — 낮을수록 빠름. */
  speed: number
}

const GOLD = '#e6c877'
const GOLD_SOFT = 'rgba(230,200,119,'
const ICE = 'rgba(155,232,255,'
const PLATINUM = 'rgba(219,231,245,'

const TONES: Record<AiCoreStatus, Tone> = {
  idle: { core: 'radial-gradient(circle at 32% 28%, #cfeeff 0%, #38bdf8 38%, #0a2c52 100%)', glow: 'rgba(56,189,248,0.55)', ring: `${ICE}0.85)`, text: '#b8e6ff', speed: 1 },
  wake: { core: 'radial-gradient(circle at 32% 28%, #dff3ff 0%, #38bdf8 42%, #0c4a6e 100%)', glow: 'rgba(56,189,248,0.7)', ring: `${ICE}0.95)`, text: '#cfeeff', speed: 0.8 },
  listening: { core: 'radial-gradient(circle at 32% 28%, #ffe2e7 0%, #fb7185 42%, #6e1830 100%)', glow: 'rgba(251,113,133,0.75)', ring: 'rgba(251,113,133,0.95)', text: '#ffc2cb', speed: 0.55 },
  transcribing: { core: 'radial-gradient(circle at 32% 28%, #dffbff 0%, #22d3ee 42%, #114e63 100%)', glow: 'rgba(34,211,238,0.75)', ring: `${ICE}0.95)`, text: '#bdf3ff', speed: 0.4 },
  analyzing: { core: 'radial-gradient(circle at 32% 28%, #d9e7ff 0%, #60a5fa 42%, #16346e 100%)', glow: 'rgba(96,165,250,0.75)', ring: 'rgba(147,197,253,0.95)', text: '#cfe2ff', speed: 0.32 },
  planning: { core: 'radial-gradient(circle at 32% 28%, #ece2ff 0%, #a78bfa 42%, #3b1a75 100%)', glow: 'rgba(167,139,250,0.75)', ring: 'rgba(196,181,253,0.95)', text: '#e4dbff', speed: 0.32 },
  prompting: { core: 'radial-gradient(circle at 32% 28%, #fff3cf 0%, #fbbf24 42%, #7a4a0c 100%)', glow: 'rgba(251,191,36,0.75)', ring: 'rgba(252,211,77,0.95)', text: '#ffe9a8', speed: 0.32 },
  executing: { core: 'radial-gradient(circle at 32% 28%, #fff6d8 0%, #e6c877 42%, #6e5312 100%)', glow: `${GOLD_SOFT}0.85)`, ring: `${GOLD_SOFT}0.98)`, text: GOLD, speed: 0.28 },
  speaking: { core: 'radial-gradient(circle at 32% 28%, #fff9e4 0%, #ecd28a 38%, #1c5f8f 100%)', glow: `${GOLD_SOFT}0.8)`, ring: `${GOLD_SOFT}0.95)`, text: '#f4dfa4', speed: 0.45 },
  completed: { core: 'radial-gradient(circle at 32% 28%, #fffbe8 0%, #e6c877 44%, #5c470f 100%)', glow: `${GOLD_SOFT}0.9)`, ring: `${GOLD_SOFT}0.98)`, text: '#f6e7ba', speed: 1.3 },
  failed: { core: 'radial-gradient(circle at 32% 28%, #ffd9de 0%, #f43f5e 44%, #4d0d1b 100%)', glow: 'rgba(244,63,94,0.75)', ring: 'rgba(251,113,133,0.95)', text: '#ffb9c2', speed: 1.1 }
}

const ACTIVE: AiCoreStatus[] = ['wake', 'listening', 'transcribing', 'analyzing', 'planning', 'prompting', 'executing', 'speaking']

/**
 * 평면 정밀 링 6종 — inset 비율(%), 스타일, 회전 주기(s), 방향.
 * kind: dash(눈금 대시) · hair(헤어라인) · arc(이중 시안 아크) · goldarc(골드 아크)
 *      · dot(미세 점선) · halo(외곽 광륜)
 */
const FLAT_RINGS: { inset: number; kind: 'dash' | 'hair' | 'arc' | 'goldarc' | 'dot' | 'halo'; dur: number; rev?: boolean }[] = [
  { inset: 0, kind: 'halo', dur: 90 },
  { inset: 4, kind: 'dash', dur: 26 },
  { inset: 9, kind: 'dot', dur: 34, rev: true },
  { inset: 14, kind: 'arc', dur: 9, rev: true },
  { inset: 20, kind: 'hair', dur: 0 },
  { inset: 25, kind: 'goldarc', dur: 6 }
]

/** 궤도 파티클 — 반지름(%), 크기(px), 주기(s), 시작 각도(deg), 골드 여부. */
const PARTICLES = [
  { r: 47, s: 5, d: 8, a: 0, gold: false },
  { r: 53, s: 3, d: 12, a: 70, gold: true },
  { r: 58, s: 4, d: 10, a: 140, gold: false },
  { r: 44, s: 3, d: 14, a: 210, gold: true },
  { r: 50, s: 2.5, d: 9, a: 280, gold: false },
  { r: 61, s: 2.5, d: 16, a: 330, gold: true }
]

/** 3D 자이로 링 — 고정 축 회전 + 지속 스핀 (키프레임 이름과 1:1). */
const GYRO_RINGS: { anim: string; dur: number; color: string; width: number }[] = [
  { anim: 'jarvis-gyro-a', dur: 7, color: `${GOLD_SOFT}0.75)`, width: 1.5 },
  { anim: 'jarvis-gyro-b', dur: 11, color: `${ICE}0.7)`, width: 1 },
  { anim: 'jarvis-gyro-c', dur: 9, color: `${PLATINUM}0.55)`, width: 1 }
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
  const size = compact ? 108 : 230
  const box = size + (compact ? 70 : 120)

  const flatRingStyle = (kind: string, dur: number, rev?: boolean): React.CSSProperties => {
    const spin = dur > 0 ? { animation: `${rev ? 'jarvis-holo-rotate-rev' : 'jarvis-holo-rotate'} ${dur * tone.speed}s linear infinite` } : {}
    switch (kind) {
      case 'halo':
        return { border: `1px solid ${GOLD_SOFT}0.18)`, boxShadow: `0 0 24px -8px ${GOLD_SOFT}0.35), inset 0 0 24px -12px ${GOLD_SOFT}0.3)`, ...spin }
      case 'dash':
        return { border: `1px dashed ${ICE}0.4)`, ...spin }
      case 'dot':
        return { border: `1px dotted ${PLATINUM}0.45)`, ...spin }
      case 'hair':
        return { border: `1px solid ${ICE}0.22)` }
      case 'arc':
        return {
          background: `conic-gradient(from 0deg, transparent 0deg, ${tone.ring} 38deg, transparent 86deg, transparent 178deg, ${tone.ring} 224deg, transparent 286deg)`,
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 2px))',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 2px))',
          ...spin
        }
      case 'goldarc':
        return {
          background: `conic-gradient(from 90deg, transparent 0deg, ${GOLD_SOFT}0.9) 26deg, transparent 64deg, transparent 200deg, ${GOLD_SOFT}0.5) 226deg, transparent 250deg)`,
          WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), black calc(100% - 1px))',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 2px), black calc(100% - 1px))',
          ...spin
        }
      default:
        return {}
    }
  }

  return (
    <div className="pointer-events-none relative flex flex-col items-center" aria-hidden>
      <style>{`
        @keyframes jarvis-holo-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes jarvis-holo-rotate-rev { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes jarvis-holo-breathe { 0%,100% { transform: scale(1); opacity: .92; } 50% { transform: scale(1.05); opacity: 1; } }
        @keyframes jarvis-holo-wave { 0% { transform: scale(.55); opacity: .7; } 100% { transform: scale(1.9); opacity: 0; } }
        @keyframes jarvis-holo-burst { 0% { transform: scale(.6); opacity: .9; } 100% { transform: scale(2.6); opacity: 0; } }
        @keyframes jarvis-holo-flicker { 0%,100% { opacity: 1; } 42% { opacity: .55; } 46% { opacity: .95; } 74% { opacity: .5; } 78% { opacity: 1; } }
        @keyframes jarvis-holo-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes jarvis-holo-scan { 0% { transform: translateY(-130%); } 100% { transform: translateY(130%); } }
        @keyframes jarvis-gyro-a { from { transform: rotateX(72deg) rotateZ(0deg); } to { transform: rotateX(72deg) rotateZ(360deg); } }
        @keyframes jarvis-gyro-b { from { transform: rotateX(64deg) rotateY(28deg) rotateZ(360deg); } to { transform: rotateX(64deg) rotateY(28deg) rotateZ(0deg); } }
        @keyframes jarvis-gyro-c { from { transform: rotateY(72deg) rotateZ(0deg); } to { transform: rotateY(72deg) rotateZ(360deg); } }
        .jarvis-holo-rotate { animation: jarvis-holo-rotate 60s linear infinite; }
      `}</style>

      <div
        className="relative flex items-center justify-center transition-all duration-700 ease-out"
        style={{ width: box, height: box, perspective: 900 }}
      >
        {/* 뒤 글로우 */}
        <span
          className="absolute rounded-full blur-3xl transition-all duration-700"
          style={{ inset: compact ? 6 : -10, background: tone.glow, opacity: active ? 0.42 : 0.25 }}
        />

        {/* 파동 링 — 활성 상태에서 방사 */}
        {active ? (
          <>
            <span className="absolute rounded-full border-2" style={{ inset: '12%', borderColor: tone.ring, animation: 'jarvis-holo-wave 1.8s ease-out infinite' }} />
            <span className="absolute rounded-full border" style={{ inset: '12%', borderColor: tone.ring, animation: 'jarvis-holo-wave 1.8s ease-out .6s infinite' }} />
          </>
        ) : null}
        {/* 완료 골드 버스트 */}
        {status === 'completed' ? (
          <span className="absolute rounded-full border-2" style={{ inset: '12%', borderColor: tone.ring, animation: 'jarvis-holo-burst 1.1s ease-out 2' }} />
        ) : null}

        {/* 평면 정밀 링 6종 */}
        {FLAT_RINGS.map((r) => (
          <span key={r.kind + r.inset} className="absolute rounded-full" style={{ inset: `${r.inset}%`, ...flatRingStyle(r.kind, r.dur, r.rev) }} />
        ))}

        {/* 3D 자이로스코프 링 3개 — 서로 다른 축으로 입체 회전 */}
        <span className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
          {GYRO_RINGS.map((g) => (
            <span
              key={g.anim}
              className="absolute rounded-full"
              style={{
                inset: '16%',
                border: `${g.width}px solid ${g.color}`,
                boxShadow: `0 0 12px -4px ${g.color}`,
                animation: `${g.anim} ${g.dur * tone.speed}s linear infinite`
              }}
            />
          ))}
        </span>

        {/* 궤도 파티클 6개 (골드·아이스 교차) */}
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
                background: p.gold ? GOLD : '#9be8ff',
                boxShadow: `0 0 ${p.s * 3}px ${p.gold ? `${GOLD_SOFT}0.95)` : `${ICE}0.95)`}`
              }}
            />
          </span>
        ))}

        {/* 코어 구체 */}
        <span
          className="relative rounded-full transition-all duration-700"
          style={{
            width: size * 0.46,
            height: size * 0.46,
            background: tone.core,
            boxShadow: `0 0 ${active ? 70 : 44}px -6px ${tone.glow}, inset 0 0 26px rgba(255,255,255,0.18)`,
            animation:
              status === 'failed'
                ? 'jarvis-holo-flicker 1.6s linear infinite'
                : `jarvis-holo-breathe ${active ? 1.5 : 4.4}s ease-in-out infinite`
          }}
        >
          {/* 회전 광택 시트 */}
          <span
            className="absolute inset-0 overflow-hidden rounded-full"
            style={{ animation: `jarvis-holo-rotate ${11 * tone.speed}s linear infinite` }}
          >
            <span className="absolute inset-0" style={{ background: `conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.16) 40deg, transparent 90deg)` }} />
          </span>
          {/* 스펙큘러 하이라이트 */}
          <span
            className="absolute rounded-full"
            style={{ left: '22%', top: '15%', width: '26%', height: '26%', background: 'rgba(255,255,255,0.68)', filter: 'blur(4px)' }}
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
        className="-mt-3 text-center font-semibold tracking-[0.14em] transition-colors duration-500"
        style={{ color: tone.text, fontSize: compact ? 12 : 15, textShadow: `0 0 20px ${tone.glow}` }}
      >
        {statusLine ?? STATUS_TEXT[status]}
      </div>
    </div>
  )
}
