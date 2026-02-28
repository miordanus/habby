import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { getLogicalDate, addDays } from "@/lib/logicalDate"
import { ensureDefaultGoals } from "@/lib/defaultGoals"

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

  const items = (body.items ?? []).map((item: {
    metric_key: string
    operator: string
    target_number?: number | null
    target_bool?: boolean | null
    tolerance_number?: number | null
    xp_reward?: number
  }) => ({
    goal_id: goal.id,
    metric_key: item.metric_key,
    operator: item.operator,
    target_number: item.target_number ?? null,
    target_bool: item.target_bool ?? null,
    tolerance_number: item.tolerance_number ?? null,
    xp_reward: item.xp_reward ?? 10,
    is_active: true,
  }))

  if (items.length > 0) await sb.from("goal_items").insert(items)

  const { data: savedItems } = await sb
    .from("goal_items")
    .select("*")
    .eq("goal_id", goal.id)

  return NextResponse.json({ ...goal, effective_from: effectiveFrom, items: savedItems ?? [] })
}
