import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { getLogicalDate } from "@/lib/logicalDate"
import { awardCheckinXP, awardBonusXP, evaluateAndPersistGoals, checkWeeklyTrainingBonus } from "@/lib/xpEngine"

function parseTgId(req: NextRequest): number | null {
  const v = req.headers.get("x-telegram-user-id")
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
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
    const { data, error } = await sb
      .from("daily_logs")
      .select("*")
      .eq("user_id", userId)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data ?? [])
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

  const { data: log, error } = await sb
    .from("daily_logs")
    .upsert(payload, { onConflict: "user_id,date" })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // XP engine (fire-and-forget errors — don't fail the request)
  let xpEarned = 0
  try {
    xpEarned += await awardCheckinXP(sb, userId, date, today, payload)
    xpEarned += await awardBonusXP(sb, userId, date, payload)
    xpEarned += await evaluateAndPersistGoals(sb, userId, date, payload)
    xpEarned += await checkWeeklyTrainingBonus(sb, userId, today)
  } catch (err) {
    console.error("[/api/logs POST] XP engine error:", err)
  }

  return NextResponse.json({ log, xpEarned })
}
