interface Props {
  streak: number
  shieldActive: boolean
}

export default function StreakBadge({ streak, shieldActive }: Props) {
  return (
    <div className="flex items-center gap-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-3 py-2">
      <span className="text-xl" aria-label="fire">🔥</span>
      <div>
        <span className="text-xl font-bold text-[var(--text)]">{streak}</span>
        <span className="text-xs font-mono text-[var(--text-muted)] ml-1">day streak</span>
      </div>
      {shieldActive && (
        <span className="ml-1 text-base" title="Shield active — 1 miss forgiven this week">🛡️</span>
      )}
    </div>
  )
}
