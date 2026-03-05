import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { parseTgId } from "@/lib/parseRequest"
import { getLogicalDate, dateDiff } from "@/lib/logicalDate"
import type { EventType } from "@/types/database"

export const runtime = "nodejs"

const VALID_TYPES: EventType[] = [
  "nicotine", "coffee_cup", "water_ml",
  "vitamins_adam", "magnesium", "l_theanine",
  "workout", "alcohol_yes",
  "self_rating_energy", "self_rating_focus", "self_rating_stress",
]

const BOOL_TYPES: EventType[] = ["vitamins_adam", "magnesium", "l_theanine", "alcohol_yes"]
const RATING_TYPES: EventType[] = ["self_rating_energy", "self_rating_focus", "self_rating_stress"]

/** GET /api/events — get events for a date or date range */
export async function GET(req: NextRequest) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sb = getSupabase()
  const userId = await getUserId(tgId)
  const url = new URL(req.url)
  const date = url.searchParams.get("date")
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")

  let query = sb.from("events").select("*").eq("user_id", userId).order("ts_effective", { ascending: false })

  if (date) {
    query = query.eq("logical_date", date)
  } else if (from && to) {
    query = query.gte("logical_date", from).lte("logical_date", to)
  } else {
    query = query.eq("logical_date", getLogicalDate())
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

/** POST /api/events — log a single event */
export async function POST(req: NextRequest) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sb = getSupabase()
  const userId = await getUserId(tgId)

  let body: {
    type: EventType
    value?: number
    value_bool?: boolean
    value_text?: string
    ts_effective?: string
    metadata?: Record<string, unknown>
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body.type || !VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: "Invalid event type" }, { status: 400 })
  }

  // Validate rating values
  if (RATING_TYPES.includes(body.type)) {
    if (body.value == null || body.value < 1 || body.value > 5) {
      return NextResponse.json({ error: "Rating must be 1-5" }, { status: 400 })
    }
  }

  // Validate bool events
  if (BOOL_TYPES.includes(body.type) && body.value_bool == null) {
    return NextResponse.json({ error: "value_bool required for boolean events" }, { status: 400 })
  }

  // Validate ts_effective if provided (within 7 days)
  const tsEffective = body.ts_effective ? new Date(body.ts_effective) : new Date()
  const logicalDateOfEvent = new Date(tsEffective.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const today = getLogicalDate()
  const diff = dateDiff(today, logicalDateOfEvent)

  if (diff < 0) return NextResponse.json({ error: "Cannot log future events" }, { status: 400 })
  if (diff > 7) return NextResponse.json({ error: "Cannot log events older than 7 days" }, { status: 400 })

  const { data, error } = await sb
    .from("events")
    .insert({
      user_id: userId,
      ts_original: new Date().toISOString(),
      ts_effective: tsEffective.toISOString(),
      type: body.type,
      value: body.value ?? null,
      value_bool: body.value_bool ?? null,
      value_text: body.value_text ?? null,
      metadata: body.metadata ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Trigger conditional checks asynchronously (non-blocking)
  // We don't await this to avoid slowing down the response
  if (body.type === "nicotine" || body.type === "water_ml") {
    runConditionalChecksAsync(sb, userId, logicalDateOfEvent, today).catch(() => {})
  }

  return NextResponse.json(data, { status: 201 })
}

/** Run conditional intervention checks in background (fire and forget) */
async function runConditionalChecksAsync(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: import("@supabase/supabase-js").SupabaseClient<any>,
  userId: string,
  logicalDate: string,
  today: string
) {
  // Only run if it's the current logical day
  if (logicalDate !== today) return

  try {
    const { getCurrentPhase } = await import("@/lib/phaseUtils")
    const { runConditionalChecks } = await import("@/lib/interventionEngine")

    const phase = getCurrentPhase()

    // Get today's events
    const { data: todayEvents } = await sb
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .eq("logical_date", today)

    // Get yesterday's events
    const yesterday = new Date(new Date(today + "T12:00:00Z").getTime() - 86400000).toISOString().slice(0, 10)
    const { data: yesterdayEvents } = await sb
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .eq("logical_date", yesterday)

    // Get active quests
    const { data: quests } = await sb
      .from("quests")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .lte("valid_from", today)
      .gte("valid_until", today)

    await runConditionalChecks(
      sb,
      userId,
      todayEvents ?? [],
      yesterdayEvents ?? [],
      quests ?? [],
      phase
    )
  } catch (err) {
    console.error("[events] Conditional check failed:", err)
  }
}
