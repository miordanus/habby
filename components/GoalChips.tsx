interface Evaluation {
  metric_key: string
  met: boolean
  actual_number: number | null
  actual_bool: boolean | null
  target_number: number | null
  target_bool: boolean | null
}

const METRIC_LABEL: Record<string, string> = {
  caffeine_cups:  "☕",
  nicotine_count: "🚬",
  water_ml:       "💧",
  protein_g:      "🥩",
  calories:       "🍽",
  alcohol_yes:    "🍺",
  vitamins_adam:  "💊",
  magnesium:      "🧲",
  l_theanine:     "🍵",
}

function fmt(e: Evaluation): string {
  if (e.actual_number != null) {
    const unit = e.metric_key === "water_ml" ? "ml" : e.metric_key === "calories" ? "kcal" : ""
    return `${e.actual_number}${unit}`
  }
  if (e.actual_bool != null) return e.actual_bool ? "✓" : "✗"
  return "—"
}

interface Props {
  evaluations: Evaluation[]
}

export default function GoalChips({ evaluations }: Props) {
  if (!evaluations.length) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {evaluations.map((e) => (
        <div
          key={e.metric_key}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono border ${
            e.met
              ? "border-[#00FF85] text-[#00FF85] bg-[rgba(0,255,133,0.08)]"
              : "border-[var(--border)] text-[var(--text-muted)]"
          }`}
        >
          <span>{METRIC_LABEL[e.metric_key] ?? e.metric_key}</span>
          <span>{fmt(e)}</span>
        </div>
      ))}
    </div>
  )
}
