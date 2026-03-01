import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { getLogicalDate, addDays } from "@/lib/logicalDate"
import { ensureDefaultGoals } from "@/lib/defaultGoals"
import { parseTgId } from "@/lib/parseRequest"

const ALLOWED_METRIC_KEYS = new Set([
  "nicotine_count", "caffeine_cups", "water_ml", "protein_g",
  "calories", "alcohol_yes", "vitamins_adam", "magnesium", "l_theanine",
])
const ALLOWED_OPERATORS = new Set(["<=", ">=", "==", "range"])

export async function GET(req: NextRequest) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = await getUserId(tgId)
  const sb = getSupabase()
  const today = getLogicalDate()

  // Ensure default goals exist
  await ensureDefaultGoals(sb, userId, today)

  const { searchParams } = new URL(req.url)
  const date = searchParams.get("date") ?? today

  // Applicable goal version for given date (most recent effective_from <= date)
  const { data: goal } = await sb
    .from("goals")
    .select("id, effective_from, created_at")
    .eq("user_id", userId)
    .lte("effective_from", date)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!goal) return NextResponse.json(null)

  const { data: items } = await sb
    .from("goal_items")
    .select("*")
    .eq("goal_id", goal.id)
    .eq("is_active", true)
    .order("metric_key")

  return NextResponse.json({ ...goal, items: items ?? [] })
}

export async function POST(req: NextRequest) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const userId = await getUserId(tgId)
  const sb = getSupabase()

  const today = getLogicalDate()
  const tomorrow = addDays(today, 1)

  const effectiveFrom: string = body.effective_from ?? tomorrow

  // Must be future-only
  if (effectiveFrom <= today) {
    return NextResponse.json(
      { error: "effective_from must be tomorrow or later" },
      { status: 400 }
    )
  }

  // Validate each item before touching the DB
  const rawItems: unknown[] = Array.isArray(body.items) ? body.items : []
  for (const item of rawItems) {
    const i = item as Record<string, unknown>
    if (!ALLOWED_METRIC_KEYS.has(i.metric_key as string)) {
      return NextResponse.json({ error: `Unknown metric_key: ${i.metric_key}` }, { status: 400 })
    }
    if (!ALLOWED_OPERATORS.has(i.operator as string)) {
      return NextResponse.json({ error: `Invalid operator: ${i.operator}` }, { status: 400 })
    }
  }

  const { data: goal, error } = await sb
    .from("goals")
    .upsert(
      { user_id: userId, effective_from: effectiveFrom },
      { onConflict: "user_id,effective_from" }
    )
    .select("id")
    .single()

  if (error || !goal) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500 })

  // Delete old items for this goal version, then insert fresh
  await sb.from("goal_items").delete().eq("goal_id", goal.id)

  const items = rawItems.map((item) => {
    const i = item as {
      metric_key: string
      operator: string
      target_number?: number | null
      target_bool?: boolean | null
      tolerance_number?: number | null
      xp_reward?: number
    }
    return {
      goal_id: goal.id,
      metric_key: i.metric_key,
      operator: i.operator,
      target_number: i.target_number ?? null,
      target_bool: i.target_bool ?? null,
      tolerance_number: i.tolerance_number ?? null,
      xp_reward: i.xp_reward ?? 10,
      is_active: true,
    }
  })

  if (items.length > 0) await sb.from("goal_items").insert(items)

  const { data: savedItems } = await sb
    .from("goal_items")
    .select("*")
    .eq("goal_id", goal.id)

  return NextResponse.json({ ...goal, effective_from: effectiveFrom, items: savedItems ?? [] })
}
