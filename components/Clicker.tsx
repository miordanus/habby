interface Props {
  label: string
  value: number
  unit?: string
  increments: number[]   // e.g. [1] or [250, 500]
  onAdd: (n: number) => void
  onSub?: () => void
  minValue?: number
}

const BTN = "h-10 px-3 rounded-lg border border-[var(--border)] font-mono text-sm transition-colors active:scale-95 hover:border-[#444] text-[var(--text)]"

export default function Clicker({ label, value, unit, increments, onAdd, onSub, minValue = 0 }: Props) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <div className="flex items-baseline gap-1.5 min-w-[90px]">
        <span className="text-lg">{label}</span>
        <span className="text-base font-bold font-mono tabular-nums text-[var(--text)]">{value}</span>
        {unit && <span className="text-xs text-[var(--text-muted)] font-mono">{unit}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        {onSub && (
          <button
            onClick={onSub}
            disabled={value <= minValue}
            className={`${BTN} px-2.5 disabled:opacity-30`}
            aria-label={`Decrease ${label}`}
          >
            −
          </button>
        )}
        {increments.map((n) => (
          <button
            key={n}
            onClick={() => onAdd(n)}
            className={`${BTN}`}
            aria-label={`Add ${n} to ${label}`}
          >
            +{n}
          </button>
        ))}
      </div>
    </div>
  )
}
