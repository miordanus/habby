"use client"

interface Props {
  type: "energy" | "focus" | "stress"
  value: number | null
  onChange: (value: number) => void
  disabled?: boolean
}

const CONFIG = {
  energy: {
    label: "⚡ Энергия",
    emojis: ["😴", "😐", "🙂", "😄", "⚡"],
  },
  focus: {
    label: "🎯 Фокус",
    emojis: ["🌫️", "😶", "🧐", "🎯", "🔥"],
  },
  stress: {
    label: "😰 Стресс",
    emojis: ["😌", "😐", "😤", "😰", "🤯"],
  },
}

export default function RatingBar({ type, value, onChange, disabled }: Props) {
  const cfg = CONFIG[type]

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-mono text-[var(--text-muted)]">{cfg.label}</span>
      <div className="flex gap-1">
        {cfg.emojis.map((emoji, i) => {
          const rating = i + 1
          const isSelected = value === rating
          return (
            <button
              key={rating}
              onClick={() => onChange(rating)}
              disabled={disabled}
              className={[
                "flex-1 py-2 rounded-lg text-base transition-all active:scale-95",
                isSelected
                  ? "bg-[#00FF85] text-black scale-105"
                  : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text)] hover:border-[#00FF85]",
                disabled ? "opacity-50 cursor-not-allowed" : "",
              ].join(" ")}
              aria-label={`${cfg.label} ${rating}`}
            >
              {emoji}
            </button>
          )
        })}
      </div>
    </div>
  )
}
