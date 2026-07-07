/**
 * SJ INVEST brand lockup — gold "SJ" monogram (누끼 PNG) + gold serif wordmark
 * + optional tagline. The monogram is the client's real mark (extracted with a
 * transparent background); the wordmark/tagline are set in gold so the lockup scales
 * cleanly. Import via `new URL(...)` so the asset path resolves in both the web build
 * (base '/') and the Electron build (base './').
 */

const SJ_MARK = new URL('../../assets/sj-mark.png', import.meta.url).href
const GOLD_TEXT = 'linear-gradient(180deg,#f0da91 0%,#d9b23f 42%,#b3861f 78%,#9a6f16 100%)'

export default function BrandLogo({
  markClassName = 'h-9',
  showWordmark = true,
  showTagline = false,
  wordmarkClassName = 'text-xl',
  className = ''
}: {
  markClassName?: string
  showWordmark?: boolean
  showTagline?: boolean
  wordmarkClassName?: string
  className?: string
}): JSX.Element {
  return (
    <div className={['flex items-center gap-2.5', className].join(' ')}>
      <img
        src={SJ_MARK}
        alt="SJ INVEST"
        draggable={false}
        className={[markClassName, 'w-auto shrink-0 select-none object-contain'].join(' ')}
      />
      {showWordmark ? (
        <div className="leading-none">
          <div
            className={['font-serif font-bold tracking-wide', wordmarkClassName].join(' ')}
            style={{ backgroundImage: GOLD_TEXT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
          >
            SJ INVEST
          </div>
          {showTagline ? (
            <div className="mt-1 text-[8.5px] font-semibold uppercase tracking-[0.22em] text-[#b0862a]">
              WEALTH · INSURANCE · FUTURE
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
