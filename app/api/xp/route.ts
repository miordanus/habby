import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { getLogicalDate } from "@/lib/logicalDate"
import { computeStreak } from "@/lib/streak"
import { parseTgId } from "@/lib/parseRequest"

export async function GET(req: NextRequest) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = await getUserId(tgId)
  const sb = getSupabase()
  const today = getLogicalDate()

  // Total XP
  const { data: allEvents } = await sb
    .from("xp_events")
    .select("xp, date")
    .eq("user_id", userId)

  const totalXp = (allEvents ?? []).reduce((s, e) => s + (e.xp as number), 0)
  const xpToday = (allEvents ?? [])
    .filter((e) => e.date === today)
    .reduce((s, e) => s + (e.xp as number), 0)

  const level = Math.floor(totalXp / 500) + 1
  const xpIntoLevel = totalXp % 500
  const xpForNextLevel = 500

  // Streak: last 30 days of logged dates
  const thirtyDaysAgo = new Date(new Date(today + "T12:00:00Z").getTime() - 29 * 86400000)
    .toISOString()
    .slice(0, 10)

  const { data: logRows } = await sb
    .from("daily_logs")
    .select("date")
    .eq("user_id", userId)
    .gte("date", thirtyDaysAgo)
    .lte("date", today)

  const loggedDates = (logRows ?? []).map((r) => r.date as string)
  const { streak, shieldActive } = computeStreak(loggedDates, today)

  return NextResponse.json({ totalXp, xpToday, level, xpIntoLevel, xpForNextLevel, streak, shieldActive })
}
