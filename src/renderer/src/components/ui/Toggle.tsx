interface ToggleProps {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
}

/** A small on/off switch (controlled). */
export default function Toggle({
  checked,
  onChange,
  label
}: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition',
        checked ? 'bg-indigo-600' : 'bg-slate-700'
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-4 w-4 transform rounded-full bg-white transition',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        ].join(' ')}
      />
    </button>
  )
}
