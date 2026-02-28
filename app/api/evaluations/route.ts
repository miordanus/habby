import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"

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

  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 })

  const { data, error } = await sb
    .from("daily_goal_evaluations")
    .select("metric_key,met,actual_number,actual_bool,target_number,target_bool,delta_number,xp_awarded")
    .eq("user_id", userId)
    .eq("date", date)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
