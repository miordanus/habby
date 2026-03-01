// SERVER ONLY — XP award + goal evaluation logic.
// All functions take a service-role Supabase client.
import { SupabaseClient } from "@supabase/supabase-js"
import { isoWeek } from "./logicalDate"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient<any>

interface LogRow {
  nicotine_count: number
  caffeine_cups: number
  calories: number | null
  protein_g: number | null
  water_ml: number
  wake_time: string | null
  sleep_time: string | null
  phone_free_min: number | null
  training_type: string
  vitamins_adam: boolean
  magnesium: boolean
  l_theanine: boolean
  alcohol_yes: boolean
}

/** Award XP event idempotently. Returns xp awarded (0 if duplicate). */
async function awardXp(
  sb: SB,
  userId: string,
  date: string,
  eventType: string,
  xp: number,
  meta?: Record<string, unknown>
): Promise<number> {
  const { error } = await sb.from("xp_events").upsert(
    { user_id: userId, date, event_type: eventType, xp, meta: meta ?? null },
    { onConflict: "user_id,date,event_type", ignoreDuplicates: true }
  )
  if (error) console.error("[xpEngine] awardXp error:", error.message)
  return xp
}

/** Determine if a log qualifies as "full" check-in. */
function isFull(log: LogRow): boolean {
  return log.calories != null && log.protein_g != null && !!(log.wake_time || log.sleep_time)
}

/** Award checkin XP (quick/full/backfill) — idempotent. */
export async function awardCheckinXP(
  sb: SB,
  userId: string,
  date: string,
  todayDate: string,
  log: LogRow
): Promise<number> {
  let total = 0

  if (date < todayDate) {
    // Backfill
    total += await awardXp(sb, userId, date, "checkin_backfill", 15)
  }

  if (isFull(log)) {
    total += await awardXp(sb, userId, date, "checkin_full", 35)
  } else {
    total += await awardXp(sb, userId, date, "checkin_quick", 20)
  }

  return total
}

/** Award phone-free bonus if applicable. */
export async function awardBonusXP(
  sb: SB,
  userId: string,
  date: string,
  log: LogRow
): Promise<number> {
  let total = 0
  if ((log.phone_free_min ?? 0) >= 30) {
    total += await awardXp(sb, userId, date, "bonus_phone_free_30", 10)
  }
  return total
}

/** Return the Monday (YYYY-MM-DD) of the ISO week containing dateStr. */
function isoWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z")
  const dow = (d.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

/** Check & award weekly training bonus (once per ISO week). */
export async function checkWeeklyTrainingBonus(
  sb: SB,
  userId: string,
  todayDate: string
): Promise<number> {
  // Count sessions in last 7 logical days
  const sevenDaysAgo = new Date(new Date(todayDate + "T12:00:00Z").getTime() - 6 * 86400000)
    .toISOString()
    .slice(0, 10)

  const { data: sessions } = await sb
    .from("daily_logs")
    .select("date")
    .eq("user_id", userId)
    .gte("date", sevenDaysAgo)
    .neq("training_type", "none")

  if (!sessions || sessions.length < 2) return 0

  // Use the Monday of the ISO week as the event date so the triple
  // (user_id, monday_date, weekly_training_YYYY-WW) is stable for all
  // saves within the same week — prevents double-awarding.
  const week = isoWeek(todayDate)
  const weekMonday = isoWeekMonday(todayDate)
  return await awardXp(sb, userId, weekMonday, `weekly_training_${week}`, 40, { week })
}

interface GoalItem {
  id: string
  metric_key: string
  operator: string
  target_number: number | null
  target_bool: boolean | null
  tolerance_number: number | null
  xp_reward: number
  is_active: boolean
}

/** Evaluate goals for a given date and persist daily_goal_evaluations. */
export async function evaluateAndPersistGoals(
  sb: SB,
  userId: string,
  date: string,
  log: LogRow
): Promise<number> {
  // Find applicable goal version (latest effective_from <= date)
  const { data: goalRow } = await sb
    .from("goals")
    .select("id")
    .eq("user_id", userId)
    .lte("effective_from", date)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!goalRow) return 0

  const { data: items } = await sb
    .from("goal_items")
    .select("*")
    .eq("goal_id", goalRow.id)
    .eq("is_active", true)

  if (!items) return 0

  let xpTotal = 0

  for (const item of items as GoalItem[]) {
    const result = evaluateMetric(item, log)
    if (!result) continue

    const { met, actualNumber, actualBool, deltaNumber, xpAwarded } = result

    // Upsert evaluation row
    await sb.from("daily_goal_evaluations").upsert(
      {
        user_id: userId,
        date,
        goal_id_used: goalRow.id,
        metric_key: item.metric_key,
        actual_number: actualNumber ?? null,
        actual_bool: actualBool ?? null,
        target_number: item.target_number,
        target_bool: item.target_bool,
        delta_number: deltaNumber ?? null,
        met,
        xp_awarded: xpAwarded,
      },
      { onConflict: "user_id,date,metric_key" }
    )

    // Award XP for caffeine and nicotine goals only (per spec)
    if (met && xpAwarded > 0) {
      if (item.metric_key === "caffeine_cups") {
        xpTotal += await awardXp(sb, userId, date, "bonus_goal_caffeine", xpAwarded)
      } else if (item.metric_key === "nicotine_count") {
        xpTotal += await awardXp(sb, userId, date, "bonus_goal_nicotine", xpAwarded)
      }
    }
  }

  return xpTotal
}

function evaluateMetric(
  item: GoalItem,
  log: LogRow
): {
  met: boolean
  actualNumber: number | null
  actualBool: boolean | null
  deltaNumber: number | null
  xpAwarded: number
} | null {
  const key = item.metric_key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logAny = log as any

  // l_theanine is N/A if caffeine_cups == 0
  if (key === "l_theanine" && log.caffeine_cups === 0) {
    return {
      met: true,
      actualBool: log.l_theanine,
      actualNumber: null,
      deltaNumber: null,
      xpAwarded: 0,
    }
  }

  if (item.operator === "==" && item.target_bool !== null) {
    const actual = logAny[key] as boolean
    const met = actual === item.target_bool
    return { met, actualBool: actual, actualNumber: null, deltaNumber: null, xpAwarded: met ? item.xp_reward : 0 }
  }

  if (item.operator === "range" && item.target_number !== null) {
    const actual = logAny[key] as number | null
    if (actual == null) return { met: false, actualNumber: null, actualBool: null, deltaNumber: null, xpAwarded: 0 }
    const tol = item.tolerance_number ?? 0.10
    const delta = actual - item.target_number
    const met = Math.abs(delta) <= item.target_number * tol
    return { met, actualNumber: actual, actualBool: null, deltaNumber: delta, xpAwarded: met ? item.xp_reward : 0 }
  }

  if (item.target_number !== null) {
    const actual = logAny[key] as number | null
    if (actual == null) return { met: false, actualNumber: null, actualBool: null, deltaNumber: null, xpAwarded: 0 }
    let met = false
    if (item.operator === "<=") met = actual <= item.target_number
    else if (item.operator === ">=") met = actual >= item.target_number
    const delta = actual - item.target_number
    return { met, actualNumber: actual, actualBool: null, deltaNumber: delta, xpAwarded: met ? item.xp_reward : 0 }
  }

  return null
}
