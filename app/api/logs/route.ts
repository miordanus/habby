import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { getLogicalDate } from "@/lib/logicalDate"
import { runXpPipeline } from "@/lib/xpEngine"
import { aggregateDay, type DayAggregate } from "@/lib/eventAggregator"
import { parseTgId } from "@/lib/parseRequest"
import type { DailyLog } from "@/types/database"

/** Reconstruct a DailyLog-shaped response from a DayAggregate + metadata. */
function aggregateToLog(
  userId: string,
  date: string,
  aggregate: DayAggregate
): DailyLog {
  return {
    id: "",
    user_id: userId,
    date,
    created_at: "",
    updated_at: "",
    ...aggregate,
  }
}

export async function GET(req: NextRequest) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = await getUserId(tgId)
  const sb = getSupabase()
  const { searchParams } = new URL(req.url)

  const date = searchParams.get("date")
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  if (date) {
    // Try events first
    const { data: dayEvents, error: evErr } = await sb
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .eq("logical_date", date)
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })

    if (dayEvents && dayEvents.length > 0) {
      return NextResponse.json(aggregateToLog(userId, date, aggregateDay(dayEvents)))
    }

    // Fallback: historical data in daily_logs
    const { data, error } = await sb
      .from("daily_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data ?? null)
  }

  if (from && to) {
    // Build a date list and aggregate per date from events; fall back to daily_logs for missing dates
    const { data: rangeEvents, error: evErr } = await sb
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .gte("logical_date", from)
      .lte("logical_date", to)
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })

    // Group events by date
    const byDate = new Map<string, typeof rangeEvents>()
    for (const ev of rangeEvents ?? []) {
      const d = ev.logical_date as string
      if (!byDate.has(d)) byDate.set(d, [])
      byDate.get(d)!.push(ev)
    }

    const eventDates = new Set(byDate.keys())

    // For dates that have events, reconstruct from events
    const eventLogs: DailyLog[] = [...byDate.entries()]
      .sort((a, b) => (a[0] > b[0] ? -1 : 1)) // descending
      .map(([d, evs]) => aggregateToLog(userId, d, aggregateDay(evs)))

    // Fallback: fetch daily_logs rows for dates not covered by events
    const { data: legacyRows } = await sb
      .from("daily_logs")
      .select("*")
      .eq("user_id", userId)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false })

    const legacyFiltered = (legacyRows ?? []).filter(
      (r: { date: string }) => !eventDates.has(r.date)
    ) as DailyLog[]

    // Merge and sort descending
    const merged = [...eventLogs, ...legacyFiltered].sort((a, b) =>
      (a.date > b.date ? -1 : 1)
    )
    return NextResponse.json(merged)
  }

  return NextResponse.json({ error: "Provide date or from+to" }, { status: 400 })
}

export async function POST(req: NextRequest) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const userId = await getUserId(tgId)
  const sb = getSupabase()
  const today = getLogicalDate()
  const date: string = body.date ?? today

  // Backfill guard: max 7 days
  const diffDays = Math.floor(
    (new Date(today + "T12:00:00Z").getTime() - new Date(date + "T12:00:00Z").getTime()) / 86400000
  )
  if (diffDays > 7) return NextResponse.json({ error: "Backfill window is 7 days" }, { status: 400 })
  if (diffDays < 0) return NextResponse.json({ error: "Cannot log future dates" }, { status: 400 })

  const payload = {
    user_id: userId,
    date,
    wake_time: body.wake_time ?? null,
    sleep_time: body.sleep_time ?? null,
    phone_free_min: body.phone_free_min ?? null,
    caffeine_cups: body.caffeine_cups ?? 0,
    nicotine_count: body.nicotine_count ?? 0,
    calories: body.calories ?? null,
    protein_g: body.protein_g ?? null,
    water_ml: body.water_ml ?? 0,
    training_type: body.training_type ?? "none",
    resting_hr: body.resting_hr ?? null,
    weight_kg: body.weight_kg ?? null,
    vitamins_adam: body.vitamins_adam ?? false,
    magnesium: body.magnesium ?? false,
    l_theanine: body.l_theanine ?? false,
    alcohol_yes: body.alcohol_yes ?? false,
  }

  // Write to daily_logs (backward compat)
  const { data: log, error } = await sb
    .from("daily_logs")
    .upsert(payload, { onConflict: "user_id,date" })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Dual-write aggregate-only fields as events (fire and forget)
  writeDailyLogEvents(sb, userId, date, body).catch((err) =>
    console.error("[/api/logs POST] event dual-write error:", err)
  )

  // XP engine via events aggregation (fire and forget)
  runXpFromEvents(sb, userId, date, today).catch((err) =>
    console.error("[/api/logs POST] XP engine error:", err)
  )

  return NextResponse.json({ log, xpEarned: 0 })
}

/**
 * Write events for the aggregate-only fields that have no home-page equivalent.
 * Uses noon UTC of the given date as ts_effective (daily anchor timestamp).
 * These are "latest-value-wins" fields so it's fine to append a new event on
 * each checkin form submission — aggregateDay will pick the newest.
 */
async function writeDailyLogEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: import("@supabase/supabase-js").SupabaseClient<any>,
  userId: string,
  date: string,
  body: Record<string, unknown>
) {
  const tsEffective = date + "T12:00:00Z"
  const toInsert: object[] = []

  const push = (type: string, value?: number | null, value_text?: string | null) => {
    if (value != null || value_text != null) {
      toInsert.push({ user_id: userId, ts_original: new Date().toISOString(), ts_effective: tsEffective, type, value: value ?? null, value_text: value_text ?? null })
    }
  }

  push("calories_kcal", body.calories as number | undefined)
  push("protein_g", body.protein_g as number | undefined)
  if (body.training_type && body.training_type !== "none") {
    push("training_session", null, body.training_type as string)
  }
  push("phone_free_min", body.phone_free_min as number | undefined)
  push("weight_kg", body.weight_kg as number | undefined)
  push("resting_hr_manual", body.resting_hr as number | undefined)
  if (body.wake_time) push("wake_time", null, body.wake_time as string)
  if (body.sleep_time) push("sleep_time", null, body.sleep_time as string)

  if (toInsert.length === 0) return
  await sb.from("events").insert(toInsert)
}

/** Fetch all events for a date, aggregate, and run XP pipeline. */
async function runXpFromEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: import("@supabase/supabase-js").SupabaseClient<any>,
  userId: string,
  date: string,
  today: string
) {
  const { data: dayEvents } = await sb
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .eq("logical_date", date)
  const aggregate = aggregateDay(dayEvents ?? [])
  await runXpPipeline(sb, userId, date, today, aggregate)
}
