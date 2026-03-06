import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { getLogicalDate } from "@/lib/logicalDate"
import { aggregateDay, type DayAggregate } from "@/lib/eventAggregator"
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
  const rangeFrom = lastFrom

  // Fetch events for the full 14-day window
  const { data: rangeEvents, error: evErr } = await sb
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .gte("logical_date", rangeFrom)
    .lte("logical_date", thisTo)

  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })

  // Group events by logical_date and aggregate each day
  const byDate = new Map<string, DayAggregate>()
  const eventsByDate = new Map<string, typeof rangeEvents>()
  for (const ev of rangeEvents ?? []) {
    const d = ev.logical_date as string
    if (!eventsByDate.has(d)) eventsByDate.set(d, [])
    eventsByDate.get(d)!.push(ev)
  }
  for (const [d, evs] of eventsByDate) {
    byDate.set(d, aggregateDay(evs))
  }

  function summarise(from: string, to: string) {
    const subset: DayAggregate[] = []
    for (const [d, agg] of byDate) {
      if (d >= from && d <= to) subset.push(agg)
    }
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
