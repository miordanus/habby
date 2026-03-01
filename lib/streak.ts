// Streak computation with ISO-week shield (1 missed day per week allowed).

/** Returns ISO week number (1-53) for a YYYY-MM-DD string */
function weekNumber(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00Z")
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return Math.ceil(
    ((d.getTime() - jan4.getTime()) / 86400000 + (jan4.getUTCDay() + 6) % 7 + 1) / 7
  )
}

function isoYear(dateStr: string): number {
  // Approximate — good enough for streak purposes
  return new Date(dateStr + "T12:00:00Z").getUTCFullYear()
}

function subtractDay(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export interface StreakResult {
  streak: number
  shieldActive: boolean  // shield was consumed in the current week
}

/**
 * Compute streak walking backward from `today`.
 * Rules:
 *  - A day is "logged" if its date appears in loggedDates.
 *  - Within each ISO week, one missed day is forgiven (shield).
 *  - A second miss in the same week breaks the streak.
 */
export function computeStreak(loggedDates: string[], today: string): StreakResult {
  const logged = new Set(loggedDates)

  let streak = 0
  let shieldActive = false

  // Track shield usage per ISO year+week key
  const shieldUsed = new Map<string, boolean>()

  for (let i = 0; i < 60; i++) {
    const date = subtractDay(today, i)
    const weekKey = `${isoYear(date)}-W${weekNumber(date)}`

    if (logged.has(date)) {
      streak++
      continue
    }

    // Date not logged — check shield
    if (!shieldUsed.get(weekKey)) {
      // Use shield for this week
      shieldUsed.set(weekKey, true)
      if (weekKey === `${isoYear(today)}-W${weekNumber(today)}`) {
        shieldActive = true
      }
      continue
    }

    // Shield already used for this week — streak broken
    break
  }

  return { streak, shieldActive }
}
