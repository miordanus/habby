import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { parseTgId } from "@/lib/parseRequest"
import { getLogicalDate } from "@/lib/logicalDate"
import { getCurrentPhase } from "@/lib/phaseUtils"
import { computeQuestProgress } from "@/lib/questEngine"
import type { Quest, Event } from "@/types/database"

export const runtime = "nodejs"

/** GET /api/quests — get active quests with progress for a date */
export async function GET(req: NextRequest) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sb = getSupabase()
  const userId = await getUserId(tgId)
  const url = new URL(req.url)
  const date = url.searchParams.get("date") ?? getLogicalDate()

  // Get quests valid for this date
  const { data: quests, error } = await sb
    .from("quests")
    .select("*")
    .eq("user_id", userId)
    .lte("valid_from", date)
    .gte("valid_until", date)
    .order("quest_type", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get events for this date to compute progress
  const { data: events } = await sb
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .eq("logical_date", date)

  const eventsArr: Event[] = events ?? []
  const questsArr: Quest[] = quests ?? []

  // Attach progress to each quest
  const questsWithProgress = questsArr.map((q) => ({
    ...q,
    progress: computeQuestProgress(q, eventsArr),
  }))

  const phase = getCurrentPhase()
  const dailyQuests = questsArr.filter((q) => q.quest_type === "daily")
  const completed = dailyQuests.filter((q) => q.status === "completed").length

  return NextResponse.json({
    quests: questsWithProgress,
    phase,
    summary: { completed, total: dailyQuests.length },
  })
}
