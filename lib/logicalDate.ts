// Day boundary: 05:00. Logical date = date part of (now − 5h).
// All XP, streaks, and check-ins use this — never raw Date.

export function getLogicalDate(): string {
  return offsetDate(Date.now())
}

export function getLogicalDateFor(ts: number | string): string {
  return offsetDate(typeof ts === "string" ? new Date(ts).getTime() : ts)
}

function offsetDate(ms: number): string {
  return new Date(ms - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** ISO week string YYYY-WW used for weekly bonus idempotency key */
export function isoWeek(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z")
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const weekNum = Math.ceil(
    ((d.getTime() - jan4.getTime()) / 86400000 + (jan4.getUTCDay() + 6) % 7 + 1) / 7
  )
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`
}

/** Add N days to a YYYY-MM-DD string */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Compare two YYYY-MM-DD strings */
export function dateDiff(a: string, b: string): number {
  return (new Date(a + "T12:00:00Z").getTime() - new Date(b + "T12:00:00Z").getTime()) / 86400000
}
