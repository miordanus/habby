import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { getLogicalDate } from "@/lib/logicalDate"
import { parseTgId } from "@/lib/parseRequest"

function avg(vals: (number | null)[]): number | null {
  const v = vals.filter((x): x is number => x != null)
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null
}

function dateRange(anchor: string, offsetDays: number, daysBack: number): [string, string] {
  const end = new Date(new Date(anchor + "T12:00:00Z").getTime() + offsetDays * 86400000)
  const start = new Date(end.getTime() - (daysBack - 1) * 86400000)
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
}

export async function GET(req: NextRequest) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = await getUserId(tgId)
  const sb = getSupabase()
  const today = getLogicalDate()

  const [thisFrom, thisTo] = dateRange(today, 0, 7)
  const [lastFrom, lastTo] = dateRange(today, -7, 7)

  const { data: rows } = await sb
    .from("daily_logs")
    .select("date,nicotine_count,caffeine_cups,calories,protein_g,water_ml,training_type")
    .eq("user_id", userId)
    .gte("date", lastFrom)
    .lte("date", thisTo)
    .order("date")

  function summarise(from: string, to: string) {
    const subset = (rows ?? []).filter((r) => r.date >= from && r.date <= to)
    return {
      days_logged: subset.length,
      avg_nicotine: avg(subset.map((r) => r.nicotine_count)),
      avg_caffeine: avg(subset.map((r) => r.caffeine_cups)),
      avg_calories: avg(subset.map((r) => r.calories)),
      avg_protein:  avg(subset.map((r) => r.protein_g)),
      avg_water:    avg(subset.map((r) => r.water_ml)),
      training_count: subset.filter((r) => r.training_type !== "none").length,
      from,
      to,
    }
  }

  return NextResponse.json({
    this_week: summarise(thisFrom, thisTo),
    last_week: summarise(lastFrom, lastTo),
  })
}
