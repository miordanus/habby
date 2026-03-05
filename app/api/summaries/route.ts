import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { parseTgId } from "@/lib/parseRequest"
import { getLogicalDate } from "@/lib/logicalDate"
import { computeDayScore } from "@/lib/scoreEngine"
import type { Event, Quest, HealthSample } from "@/types/database"

export const runtime = "nodejs"

/** GET /api/summaries?date=YYYY-MM-DD — get or compute daily summary */
export async function GET(req: NextRequest) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sb = getSupabase()
  const userId = await getUserId(tgId)
  const url = new URL(req.url)
  const date = url.searchParams.get("date") ?? getLogicalDate()

  // Try to return cached summary first
  const { data: cached } = await sb
    .from("daily_summaries")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle()

  if (cached) return NextResponse.json(cached)

  // Compute on-the-fly
  const [eventsRes, questsRes, healthRes] = await Promise.all([
    sb.from("events").select("*").eq("user_id", userId).eq("logical_date", date),
    sb.from("quests").select("*").eq("user_id", userId).lte("valid_from", date).gte("valid_until", date),
    sb.from("health_samples").select("*").eq("user_id", userId).eq("sample_date", date),
  ])

  const events: Event[] = eventsRes.data ?? []
  const quests: Quest[] = questsRes.data ?? []
  const healthSamples: HealthSample[] = healthRes.data ?? []

  const score = computeDayScore(events, quests, healthSamples)
  const dailyQuests = quests.filter((q) => q.quest_type === "daily")

  const summary = {
    user_id: userId,
    date,
    ...score,
    quests_completed: dailyQuests.filter((q) => q.status === "completed").length,
    quests_total: dailyQuests.length,
    verdict: null,
    computed_at: new Date().toISOString(),
  }

  // Upsert to cache
  const { data, error } = await sb
    .from("daily_summaries")
    .upsert(summary, { onConflict: "user_id,date" })
    .select()
    .single()

  if (error) {
    // Return computed even if upsert failed
    return NextResponse.json(summary)
  }

  return NextResponse.json(data)
}
