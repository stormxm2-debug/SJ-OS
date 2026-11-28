import { useRef } from 'react'

/**
 * 자리수 고정 분할 입력 (대표 지시: "딱 맞춰서 입력 + 칸 자동 이동").
 *
 * - 연락처: [010]-[9945]-[8675] 세 칸 (3-4-4), 주민번호: [000000]-[0000000] 두 칸 (6-7).
 * - 숫자만 허용, 칸이 다 차면 다음 칸으로 자동 포커스, 빈 칸에서 백스페이스 → 이전 칸.
 * - 각 칸은 서로 독립적이다: 앞 칸을 지우거나 고쳐도 뒤 칸 숫자가 당겨오지 않는다.
 *   (값을 숫자로 뭉쳐 폭대로 다시 자르던 과거 방식이 "데이터가 땡겨오던" 원인이라 제거함.)
 * - 전체 번호를 한 칸에 붙여넣으면(onPaste) 그 칸부터 칸별로 자동 분배된다.
 * - 부모에게는 기존과 같은 하이픈 문자열("010-9945-8675")로 전달 — 저장/검증 로직 무변경.
 *   (편집 도중 앞 칸이 덜 찬 상태도 자리값을 지켜 "01-1234-5678"처럼 그대로 전달.)
 */

interface SegmentSpec {
  max: number
  widthClass: string
  placeholder: string
}

function digitsOf(v: string): string {
  return v.replace(/\D/g, '')
}

/** 하이픈 문자열 → 칸별 숫자 배열. 각 칸을 독립적으로 유지(폭대로 재분배하지 않음). */
function splitValue(value: string, specs: SegmentSpec[]): string[] {
  const raw = value.split('-')
  return specs.map((s, i) => digitsOf(raw[i] ?? '').slice(0, s.max))
}

/** 칸 배열 → 하이픈 문자열. 뒤쪽 빈 칸만 잘라내고, 중간·앞 빈 칸은 자리값으로 보존. */
function joinSegments(parts: string[]): string {
  let last = parts.length - 1
  while (last >= 0 && !parts[last]) last--
  if (last < 0) return ''
  return parts.slice(0, last + 1).join('-')
}

function SegmentedDigits({
  value,
  onChange,
  specs,
  ariaLabel,
  compact
}: {
  value: string
  onChange: (v: string) => void
  specs: SegmentSpec[]
  ariaLabel: string
  compact?: boolean
}): JSX.Element {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const parts = splitValue(value, specs)

  /** 한 칸 입력(타이핑·삭제) — 이 칸만 바꾼다. maxLength로 넘침이 없어 당겨오지 않는다. */
  const handleChange = (i: number, raw: string): void => {
    const d = digitsOf(raw).slice(0, specs[i].max)
    const next = [...parts]
    next[i] = d
    onChange(joinSegments(next))
    if (d.length >= specs[i].max && i < specs.length - 1) refs.current[i + 1]?.focus()
  }

  /** 붙여넣기 — 이 칸부터 칸별로 분배(전체 번호를 한 칸에 붙여도 쪼개짐). */
  const handlePaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>): void => {
    const pasted = digitsOf(e.clipboardData.getData('text'))
    if (!pasted) return
    e.preventDefault()
    const next = [...parts]
    let rest = pasted
    let lastFilled = i
    for (let j = i; j < specs.length && rest.length > 0; j++) {
      next[j] = rest.slice(0, specs[j].max)
      rest = rest.slice(specs[j].max)
      lastFilled = j
    }
    onChange(joinSegments(next))
    refs.current[lastFilled]?.focus()
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Backspace' && !parts[i] && i > 0) {
      e.preventDefault()
      refs.current[i - 1]?.focus()
    }
  }

  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label={ariaLabel}>
      {specs.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 ? <span className="text-slate-500">-</span> : null}
          <input
            ref={(el) => {
              refs.current[i] = el
            }}
            value={parts[i]}
            onChange={(e) => handleChange(i, e.target.value)}
            onPaste={(e) => handlePaste(i, e)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            inputMode="numeric"
            maxLength={s.max}
            autoComplete="off"
            placeholder={s.placeholder}
            aria-label={`${ariaLabel} ${i + 1}번째 칸`}
            className={[
              s.widthClass,
              'rounded-xl border border-slate-800 bg-white text-center tracking-wider text-slate-100 focus:border-indigo-400 focus:outline-none',
              compact ? 'px-1 py-1.5 text-[12px]' : 'px-1 py-2.5 text-sm'
            ].join(' ')}
          />
        </span>
      ))}
    </span>
  )
}

/** 휴대폰 번호: 3-4-4 세 칸. 값은 "010-9945-8675" 형식으로 전달. */
export function PhoneSegments({ value, onChange, compact }: { value: string; onChange: (v: string) => void; compact?: boolean }): JSX.Element {
  return (
    <SegmentedDigits
      value={value}
      onChange={onChange}
      ariaLabel="연락처"
      compact={compact}
      specs={[
        { max: 3, widthClass: 'w-14', placeholder: '010' },
        { max: 4, widthClass: 'w-[4.5rem]', placeholder: '0000' },
        { max: 4, widthClass: 'w-[4.5rem]', placeholder: '0000' }
      ]}
    />
  )
}

/** 주민등록번호: 6-7 두 칸. 값은 "000000-0000000" 형식으로 전달. */
export function RrnSegments({ value, onChange, compact }: { value: string; onChange: (v: string) => void; compact?: boolean }): JSX.Element {
  return (
    <SegmentedDigits
      value={value}
      onChange={onChange}
      ariaLabel="주민등록번호"
      compact={compact}
      specs={[
        { max: 6, widthClass: 'w-[5.2rem]', placeholder: '000000' },
        { max: 7, widthClass: 'w-[5.8rem]', placeholder: '0000000' }
      ]}
    />
  )
}
