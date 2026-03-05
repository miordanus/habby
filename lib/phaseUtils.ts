import type { Phase } from "@/types/database"

export type { Phase }

/**
 * Returns the current phase based on raw UTC time.
 * morning: UTC 05:00–11:59 (≈ Moscow 08:00–14:59)
 * day:     UTC 12:00–17:59 (≈ Moscow 15:00–20:59)
 * evening: UTC 18:00–04:59 (≈ Moscow 21:00–07:59)
 *
 * Note: the 5h logical-day offset is for DATE boundaries only, not phase.
 * Phase reflects actual time-of-day so that morning/day/evening match
 * the user's waking hours.
 */
export function getCurrentPhase(): Phase {
  const now = new Date()
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
