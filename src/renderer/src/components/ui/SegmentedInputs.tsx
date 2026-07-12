import { useRef } from 'react'

/**
 * 자리수 고정 분할 입력 (대표 지시: "딱 맞춰서 입력 + 칸 자동 이동").
 *
 * - 연락처: [010]-[9945]-[8675] 세 칸 (3-4-4), 주민번호: [000000]-[0000000] 두 칸 (6-7).
 * - 숫자만 허용, 칸이 다 차면 다음 칸으로 자동 포커스, 빈 칸에서 백스페이스 → 이전 칸.
 * - 전체 번호를 한 칸에 붙여넣어도 칸별로 자동 분배된다.
 * - 부모에게는 기존과 같은 하이픈 문자열("010-9945-8675")로 전달 — 저장/검증 로직 무변경.
 */

interface SegmentSpec {
  max: number
  widthClass: string
  placeholder: string
}

function digitsOf(v: string): string {
  return v.replace(/\D/g, '')
}

/** 전체 자릿수 문자열 → 세그먼트 배열로 분할. */
function splitDigits(digits: string, specs: SegmentSpec[]): string[] {
  const out: string[] = []
  let pos = 0
  for (const s of specs) {
    out.push(digits.slice(pos, pos + s.max))
    pos += s.max
  }
  return out
}

/** 세그먼트 배열 → 진행형 하이픈 문자열 (채워진 데까지만 하이픈). */
function joinSegments(parts: string[]): string {
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) break
    out += (i > 0 ? '-' : '') + parts[i]
  }
  return out
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
  const totalMax = specs.reduce((a, s) => a + s.max, 0)
  const parts = splitDigits(digitsOf(value), specs)

  const handleChange = (i: number, raw: string): void => {
    // 이 칸의 새 입력(붙여넣기 포함)을 앞뒤 칸과 합쳐 전체 자릿수로 재구성 → 재분배
    const before = parts.slice(0, i).join('')
    const after = parts.slice(i + 1).join('')
    const all = (before + digitsOf(raw) + after).slice(0, totalMax)
    onChange(joinSegments(splitDigits(all, specs)))
    // 이 칸이 다 찼으면 다음 칸으로
    const newParts = splitDigits(all, specs)
    if (newParts[i].length >= specs[i].max && i < specs.length - 1) {
      refs.current[i + 1]?.focus()
    }
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
            onKeyDown={(e) => handleKeyDown(i, e)}
            inputMode="numeric"
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
