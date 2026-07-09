import { useEffect, useRef } from 'react'
import type { AiCoreStatus } from './JarvisAiCore'

/**
 * 자비스 홀로그램 코어 오브 v3 — "이그제큐티브" 럭셔리 + 파티클 성운.
 *
 * 캔버스 파티클 스웜 수천 개(소용돌이 은하 디스크) + 3D 자이로스코프 링 3개 +
 * 평면 정밀 링 6종 + 회전 광택 코어. 상태에 따라 색·속도가 바뀌고, 답변 타이핑/
 * 발화 중에는 pulsing으로 코어·파티클이 심장처럼 맥동한다.
 *
 * ⚠️ 이 앱은 Tailwind 토큰(slate + 액센트 100~400)이 밝은 테마로 리매핑되어
 * 있으므로, 다크 오버레이 위 색은 전부 명시적 hex/rgba로만 쓴다.
 *
 * 파티클만 canvas(rAF) — 나머지는 CSS transform. 장식 전용이라 전부
 * pointer-events-none (클릭 먹통 사고 방지 원칙 유지). 언마운트 시 rAF 정리.
 */

/** 파티클 팔레트 — 골드/아이스/플래티넘 (additive 합성으로 성운 글로우). */
const PARTICLE_COLORS = ['rgba(230,200,119,', 'rgba(155,232,255,', 'rgba(219,231,245,']

/**
 * 캔버스 파티클 성운을 그린다. 반환값은 정리 함수. 성능: additive 합성 +
 * 색상 3패스(패스당 fillStyle 1회)로 수천 개도 60fps 유지. 트윙클은 크기 변조로
 * (문자열 alloc 회피). pulsing이 true면 energyRef가 상승해 스웜이 맥동한다.
 */
function runNebula(
  canvas: HTMLCanvasElement,
  count: number,
  pulsingRef: { current: boolean },
  opts: { wide?: boolean } = {}
): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
  const cssW = canvas.clientWidth || 260
  const cssH = canvas.clientHeight || 260
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  ctx.scale(dpr, dpr)
  const cx = cssW / 2
  const cy = cssH / 2
  // wide(풀스크린 배경): 성운이 화면 구석까지 뻗도록 대각선 기준 + 덜 눕힘.
  const wide = Boolean(opts.wide)
  const maxR = wide ? Math.hypot(cx, cy) * 0.82 : Math.min(cx, cy) * 0.98
  const squash = wide ? 0.72 : 0.5

  // 사전 계산 — 프레임마다 각도만 전진시켜 그린다.
  const N = count
  const rad = new Float32Array(N)
  const ang = new Float32Array(N)
  const spd = new Float32Array(N)
  const siz = new Float32Array(N)
  const twk = new Float32Array(N)
  const col = new Uint8Array(N)
  for (let i = 0; i < N; i += 1) {
    // 중간 반경에 밀집(은하 디스크 느낌) — sqrt 분포 + 코어 근처 공백.
    const t = Math.sqrt((i + 1) / N)
    rad[i] = maxR * (0.16 + 0.84 * t) * (0.85 + 0.3 * fract(i * 0.61803398875))
    ang[i] = fract(i * 0.7548776662) * Math.PI * 2
    // 안쪽이 빠르게(케플러식 느낌) — 방향은 동일.
    spd[i] = (0.14 + 0.5 * (1 - t)) * (0.7 + 0.6 * fract(i * 0.9))
    siz[i] = 0.6 + 1.7 * fract(i * 0.312) * (1 - 0.4 * t)
    twk[i] = fract(i * 0.271) * Math.PI * 2
    col[i] = i % 7 === 0 ? 2 : i % 3 === 0 ? 0 : 1 // 골드/플래티넘 소수, 대부분 아이스
  }

  let energy = 0 // 0..1, pulsing에 따라 완만히 추종
  let raf = 0
  let running = true
  const start = performance.now()
  let last = start

  const frame = (now: number): void => {
    if (!running) return
    const t = (now - start) / 1000
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    // energy: pulsing이면 1로, 아니면 0으로 완만히 이동.
    const target = pulsingRef.current ? 1 : 0
    energy += (target - energy) * Math.min(1, dt * 6)
    // 맥동(하트비트) — pulsing 중 강한 이중 박동, 평시 은은한 호흡.
    const beat = energy > 0.02 ? Math.pow(Math.max(0, Math.sin(t * 5.4)), 3) : 0
    const breathe = 0.5 + 0.5 * Math.sin(t * 0.8)
    const swell = 1 + energy * (0.12 + 0.16 * beat) + (1 - energy) * 0.02 * breathe
    const bright = 0.55 + energy * (0.25 + 0.45 * beat) + (1 - energy) * 0.08 * breathe

    ctx.clearRect(0, 0, cssW, cssH)
    ctx.globalCompositeOperation = 'lighter'
    // 색상 3패스 — 패스당 fillStyle 1회.
    for (let c = 0; c < 3; c += 1) {
      // 골드를 조금 더 밝게(럭셔리 강조), 아이스/플래티넘은 표준.
      const mul = c === 0 ? 0.72 : 0.6
      ctx.fillStyle = `${PARTICLE_COLORS[c]}${(mul * bright).toFixed(3)})`
      for (let i = 0; i < N; i += 1) {
        if (col[i] !== c) continue
        const a = ang[i] + t * spd[i]
        const r = rad[i] * swell
        const x = cx + Math.cos(a) * r
        // 디스크를 살짝 눕혀 3D 느낌 (y 압축).
        const y = cy + Math.sin(a) * r * squash
        const s = siz[i] * (0.75 + 0.25 * Math.sin(t * 2.4 + twk[i])) * (0.9 + 0.3 * energy * beat)
        ctx.fillRect(x - s / 2, y - s / 2, s, s)
      }
    }
    ctx.globalCompositeOperation = 'source-over'
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  return () => {
    running = false
    cancelAnimationFrame(raf)
  }
}

/** 결정적 유사난수 — 시드 재현성(랜덤 API 불필요). */
function fract(x: number): number {
  return x - Math.floor(x)
}

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
// 링을 더 역동적으로 (대표 지시: 동그라미 선이 움직였으면). 모든 링이 회전,
// 인접 링은 방향을 번갈아 반대로 돌려 살아있는 자이로 느낌.
const FLAT_RINGS: { inset: number; kind: 'dash' | 'hair' | 'arc' | 'goldarc' | 'dot' | 'halo'; dur: number; rev?: boolean }[] = [
  { inset: 0, kind: 'halo', dur: 48 },
  { inset: 4, kind: 'dash', dur: 15, rev: true },
  { inset: 9, kind: 'dot', dur: 20 },
  { inset: 14, kind: 'arc', dur: 6, rev: true },
  { inset: 20, kind: 'hair', dur: 26 },
  { inset: 25, kind: 'goldarc', dur: 4 }
]

/** 3D 자이로 링 — 고정 축 회전 + 지속 스핀 (키프레임 이름과 1:1). */
const GYRO_RINGS: { anim: string; dur: number; color: string; width: number }[] = [
  { anim: 'jarvis-gyro-a', dur: 7, color: `${GOLD_SOFT}0.75)`, width: 1.5 },
  { anim: 'jarvis-gyro-b', dur: 11, color: `${ICE}0.7)`, width: 1 },
  { anim: 'jarvis-gyro-c', dur: 9, color: `${PLATINUM}0.55)`, width: 1 }
]

/** 오브 키프레임 — 일반/풀스크린 두 렌더가 공유. */
const ORB_KEYFRAMES = `
  @keyframes jarvis-holo-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes jarvis-holo-rotate-rev { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
  @keyframes jarvis-holo-breathe { 0%,100% { transform: scale(1); opacity: .92; } 50% { transform: scale(1.05); opacity: 1; } }
  @keyframes jarvis-holo-heartbeat { 0% { transform: scale(1); } 14% { transform: scale(1.13); } 28% { transform: scale(1.02); } 42% { transform: scale(1.1); } 60%,100% { transform: scale(1); } }
  @keyframes jarvis-holo-wave { 0% { transform: scale(.55); opacity: .7; } 100% { transform: scale(1.9); opacity: 0; } }
  @keyframes jarvis-holo-burst { 0% { transform: scale(.6); opacity: .9; } 100% { transform: scale(2.6); opacity: 0; } }
  @keyframes jarvis-holo-flicker { 0%,100% { opacity: 1; } 42% { opacity: .55; } 46% { opacity: .95; } 74% { opacity: .5; } 78% { opacity: 1; } }
  @keyframes jarvis-holo-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes jarvis-holo-scan { 0% { transform: translateY(-130%); } 100% { transform: translateY(130%); } }
  @keyframes jarvis-gyro-a { from { transform: rotateX(72deg) rotateZ(0deg); } to { transform: rotateX(72deg) rotateZ(360deg); } }
  @keyframes jarvis-gyro-b { from { transform: rotateX(64deg) rotateY(28deg) rotateZ(360deg); } to { transform: rotateX(64deg) rotateY(28deg) rotateZ(0deg); } }
  @keyframes jarvis-gyro-c { from { transform: rotateY(72deg) rotateZ(0deg); } to { transform: rotateY(72deg) rotateZ(360deg); } }
  .jarvis-holo-rotate { animation: jarvis-holo-rotate 60s linear infinite; }
`

export default function JarvisHoloOrb({
  status,
  compact = false,
  statusLine,
  pulsing = false,
  fullscreen = false
}: {
  status: AiCoreStatus
  /** true면 대화 진행 중 — 오브를 작게 접어 스트림 공간을 확보. */
  compact?: boolean
  /** 상태 문구 오버라이드 (예: '녹음 중 3.2초'). */
  statusLine?: string
  /** 답변 타이핑/발화 중 — 코어·파티클이 심장처럼 맥동. */
  pulsing?: boolean
  /** 화면 전체 코어 배경 모드 — 뷰포트 전체 성운 + 중앙 거대 코어(상태문구 없음). */
  fullscreen?: boolean
}): JSX.Element {
  const tone = TONES[status]
  const active = ACTIVE.includes(status)
  const size = compact ? 108 : 230
  const box = size + (compact ? 70 : 120)

  // 파티클 성운 (canvas). pulsing은 ref로 전달해 rAF 재시작 없이 맥동만 반영.
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pulsingRef = useRef(pulsing)
  useEffect(() => {
    pulsingRef.current = pulsing
  }, [pulsing])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const count = fullscreen
      ? reduce
        ? 1600
        : 5000
      : reduce
        ? compact
          ? 400
          : 900
        : compact
          ? 2000
          : 4600
    let cleanup = runNebula(canvas, count, pulsingRef, { wide: fullscreen })
    if (!fullscreen) return cleanup
    // 풀스크린은 뷰포트가 바뀌면 성운을 다시 맞춘다 (디바운스 재초기화).
    let t = 0
    const onResize = (): void => {
      window.clearTimeout(t)
      t = window.setTimeout(() => {
        cleanup()
        cleanup = runNebula(canvas, count, pulsingRef, { wide: true })
      }, 200)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', onResize)
      cleanup()
    }
  }, [compact, fullscreen])

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

  // 코어 조립체 (글로우·파동·정밀 링·자이로 링·코어 구체) — coreDim만 달리해
  // 일반/풀스크린 두 렌더가 공유한다. 캔버스는 각 렌더가 별도로 배치.
  const coreAssembly = (coreDim: string | number, glowInset: string | number): JSX.Element => (
    <>
      {/* 뒤 글로우 */}
      <span
        className="absolute rounded-full blur-3xl transition-all duration-700"
        style={{ inset: glowInset, background: tone.glow, opacity: active || pulsing ? 0.42 : 0.25 }}
      />
      {/* 파동 링 — 활성 상태에서 방사 */}
      {active ? (
        <>
          <span className="absolute rounded-full border-2" style={{ inset: '12%', borderColor: tone.ring, animation: 'jarvis-holo-wave 1.8s ease-out infinite' }} />
          <span className="absolute rounded-full border" style={{ inset: '12%', borderColor: tone.ring, animation: 'jarvis-holo-wave 1.8s ease-out .6s infinite' }} />
        </>
      ) : null}
      {status === 'completed' ? (
        <span className="absolute rounded-full border-2" style={{ inset: '12%', borderColor: tone.ring, animation: 'jarvis-holo-burst 1.1s ease-out 2' }} />
      ) : null}

      {/* 평면 정밀 링 6종 */}
      {FLAT_RINGS.map((r) => (
        <span key={r.kind + r.inset} className="absolute rounded-full" style={{ inset: `${r.inset}%`, ...flatRingStyle(r.kind, r.dur, r.rev) }} />
      ))}

      {/* 3D 자이로스코프 링 3개 */}
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

      {/* 아크 리액터 코어 — 하우징 링 + 회전 세그먼트 코일 + 골드 링 +
          트라이스포크 + 화이트핫 허브. pulsing 중엔 하트비트로 맥동. */}
      <span
        className="relative rounded-full transition-all duration-700"
        style={{
          width: coreDim,
          height: coreDim,
          boxShadow: `0 0 ${active || pulsing ? 60 : 36}px -8px ${tone.glow}`,
          animation:
            status === 'failed'
              ? 'jarvis-holo-flicker 1.6s linear infinite'
              : pulsing
                ? 'jarvis-holo-heartbeat 1.15s ease-in-out infinite'
                : `jarvis-holo-breathe ${active ? 1.5 : 4.4}s ease-in-out infinite`
        }}
      >
        {/* 하우징 링 (리액터 외벽) */}
        <span
          className="absolute inset-0 rounded-full"
          style={{
            border: '2px solid rgba(219,231,245,0.55)',
            background: 'radial-gradient(circle at 50% 50%, rgba(8,20,42,0.35) 60%, rgba(6,14,30,0.75) 100%)',
            boxShadow: `inset 0 0 26px -6px ${tone.glow}, 0 0 20px -8px ${tone.glow}`
          }}
        />
        {/* 회전 세그먼트 코일 밴드 (아크 리액터 코일) */}
        <span
          className="absolute rounded-full"
          style={{
            inset: '11%',
            background: `repeating-conic-gradient(from 0deg, ${tone.ring} 0deg 6deg, rgba(255,255,255,0.05) 6deg 20deg)`,
            WebkitMask: 'radial-gradient(farthest-side, transparent 58%, black 60%, black 90%, transparent 92%)',
            mask: 'radial-gradient(farthest-side, transparent 58%, black 60%, black 90%, transparent 92%)',
            animation: `jarvis-holo-rotate ${8 * tone.speed}s linear infinite`
          }}
        />
        {/* 골드 정밀 링 */}
        <span
          className="absolute rounded-full"
          style={{ inset: '30%', border: '1px solid rgba(230,200,119,0.75)', boxShadow: 'inset 0 0 12px -2px rgba(230,200,119,0.4)' }}
        />
        {/* 트라이스포크 (삼각 코일 지지대) — 천천히 회전 */}
        <span className="absolute inset-0" style={{ animation: `jarvis-holo-rotate-rev ${14 * tone.speed}s linear infinite` }}>
          {[0, 120, 240].map((a) => (
            <span
              key={a}
              className="absolute"
              style={{
                left: '50%',
                top: 'calc(50% - 1px)',
                width: '38%',
                height: 2,
                transformOrigin: 'left center',
                transform: `rotate(${a}deg)`,
                background: 'linear-gradient(90deg, rgba(255,255,255,0.1), rgba(219,231,245,0.7))'
              }}
            />
          ))}
        </span>
        {/* 화이트핫 허브 (중심 발광) */}
        <span
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: '32%',
            height: '32%',
            background: `radial-gradient(circle at 50% 42%, #ffffff 0%, ${tone.text} 52%, rgba(6,14,30,0.6) 100%)`,
            boxShadow: `0 0 26px -2px ${tone.glow}, 0 0 10px rgba(255,255,255,0.5)`
          }}
        />
      </span>
    </>
  )

  // 풀스크린: 뷰포트 전체 성운 + 중앙 거대 코어 (상태문구는 패널이 표시).
  if (fullscreen) {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <style>{ORB_KEYFRAMES}</style>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ mixBlendMode: 'screen' }} />
        <div
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          style={{ width: 'min(94vmin, 1040px)', height: 'min(94vmin, 1040px)', perspective: 1600 }}
        >
          {coreAssembly('min(30vmin, 340px)', '18%')}
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none relative flex flex-col items-center" aria-hidden>
      <style>{ORB_KEYFRAMES}</style>
      <div className="relative flex items-center justify-center transition-all duration-700 ease-out" style={{ width: box, height: box, perspective: 900 }}>
        {/* 파티클 성운 (canvas 수천 개 소용돌이) — 링·코어 뒤 레이어 */}
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ mixBlendMode: 'screen' }} />
        {coreAssembly(size * 0.46, compact ? 6 : -10)}
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
