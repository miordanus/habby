"use client"

import type { Quest, QuestProgress } from "@/types/database"

interface Props {
  quest: Quest
  progress: QuestProgress
  onComplete?: (questId: string) => void
}

const QUEST_TYPE_EMOJI: Record<Quest["quest_type"], string> = {
  daily:   "📅",
  weekly:  "📆",
  monthly: "🗓",
}

export default function QuestCard({ quest, progress, onComplete }: Props) {
  const isCompleted = quest.status === "completed"
  const isExpired = quest.status === "expired"
  const pct = Math.min(1, progress.pct)
  const pctDisplay = Math.round(pct * 100)

  return (
    <div
      className={[
        "bg-[var(--bg-card)] border rounded-xl px-4 py-3 transition-all",
        isCompleted ? "border-[#00FF85] opacity-80" : "border-[var(--border)]",
        isExpired ? "opacity-40" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs font-mono text-[var(--text-muted)]">{QUEST_TYPE_EMOJI[quest.quest_type]}</span>
            <span
              className={[
                "text-sm font-semibold leading-tight",
                isCompleted ? "line-through text-[var(--text-muted)]" : "text-[var(--text)]",
              ].join(" ")}
            >
              {quest.title}
            </span>
          </div>
          <p className="text-xs font-mono text-[var(--text-muted)] leading-snug">{quest.description}</p>
        </div>

        {/* Completion button / status */}
        {isCompleted ? (
          <span className="text-[#00FF85] text-lg flex-shrink-0">✓</span>
        ) : !isExpired && onComplete ? (
          <button
            onClick={() => onComplete(quest.id)}
            className="flex-shrink-0 w-6 h-6 rounded-full border-2 border-[var(--border)] hover:border-[#00FF85] transition-colors"
            aria-label="Mark complete"
          />
        ) : null}
      </div>

      {/* Progress bar */}
      {!isCompleted && !isExpired && (
        <div className="mt-2">
          <div className="flex justify-between text-xs font-mono text-[var(--text-muted)] mb-1">
            {quest.operator === "<=" ? (
              <span>{progress.current} / {progress.target} макс</span>
            ) : (
              <span>{progress.current} / {progress.target}</span>
            )}
            <span>{pctDisplay}%</span>
          </div>
          <div className="h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pctDisplay}%`,
                backgroundColor: pct >= 1 ? "#00FF85" : "var(--accent, #00FF85)",
                opacity: pct >= 1 ? 1 : 0.6,
              }}
            />
          </div>
        </div>
      )}

      {isCompleted && (
        <div className="mt-1 text-xs font-mono text-[#00FF85]">+{quest.xp_reward} XP</div>
      )}
    </div>
  )
}
