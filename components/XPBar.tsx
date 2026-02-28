interface Props {
  totalXp: number
  xpToday: number
  level: number
  xpIntoLevel: number
  xpForNextLevel: number
}

export default function XPBar({ totalXp, xpToday, level, xpIntoLevel, xpForNextLevel }: Props) {
  const pct = Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100))

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest">Level</span>
          <span className="ml-2 text-xl font-bold text-[var(--text)]">{level}</span>
        </div>
        <div className="text-right">
          <span className="text-xs font-mono text-[#00FF85]">+{xpToday} today</span>
          <span className="ml-2 text-xs font-mono text-[var(--text-muted)]">{totalXp} total</span>
        </div>
      </div>
      <div className="h-2 bg-[var(--border)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#00FF85] rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] font-mono text-[var(--text-muted)] mt-1 text-right">
        {xpIntoLevel} / {xpForNextLevel} XP
      </p>
    </div>
  )
}
