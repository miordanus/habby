import type { Phase } from "@/types/database"

export type { Phase }

/**
 * Returns the current phase based on UTC time minus 5h (logical day offset).
 * morning: 05:00–11:59 (UTC 00:00–06:59 after offset)
 * day:     12:00–17:59 (UTC 07:00–12:59 after offset)
 * evening: 18:00–04:59 (UTC 13:00–23:59 after offset, wraps)
 */
export function getCurrentPhase(): Phase {
  const now = new Date(Date.now() - 5 * 60 * 60 * 1000)
  const hour = now.getUTCHours()
  if (hour >= 5 && hour < 12) return "morning"
  if (hour >= 12 && hour < 18) return "day"
  return "evening"
}

export function getPhaseLabel(phase: Phase): string {
  switch (phase) {
    case "morning": return "MORNING"
    case "day":     return "DAY"
    case "evening": return "EVENING"
  }
}

export function getPhaseEmoji(phase: Phase): string {
  switch (phase) {
    case "morning": return "🌅"
    case "day":     return "☀️"
    case "evening": return "🌙"
  }
}

/** Returns the logical date YYYY-MM-DD for a given UTC ms timestamp */
export function logicalDateFromMs(ms: number): string {
  return new Date(ms - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
