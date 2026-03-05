import { NextRequest, NextResponse } from "next/server"
import { verifyCronAuth } from "@/lib/cronReminder"
import { getSupabase } from "@/lib/supabaseServer"
import { getLogicalDate, addDays } from "@/lib/logicalDate"
import { getCurrentPhase } from "@/lib/phaseUtils"
import { runConditionalChecks } from "@/lib/interventionEngine"
import type { Event, Quest } from "@/types/database"

export const runtime = "nodejs"

/** GET /api/cron/day — mid-day conditional intervention check (12:00 UTC) */
export async function GET(req: NextRequest) {
  const authError = verifyCronAuth(req)
  if (authError) return authError

  const sb = getSupabase()
  const today = getLogicalDate()
  const yesterday = addDays(today, -1)
  const phase = getCurrentPhase()
  const chatId = process.env.TELEGRAM_CHAT_ID

  let userId: string | null = null
  if (chatId) {
    const { data: user } = await sb
      .from("users")
      .select("id")
      .eq("telegram_user_id", Number(chatId))
      .maybeSingle()
    userId = user?.id ?? null
  }

  if (!userId) {
    return NextResponse.json({ ok: false, error: "No user found" })
  }

  try {
    const [todayEventsRes, yesterdayEventsRes, questsRes] = await Promise.all([
      sb.from("events").select("*").eq("user_id", userId).eq("logical_date", today),
      sb.from("events").select("*").eq("user_id", userId).eq("logical_date", yesterday),
      sb.from("quests").select("*").eq("user_id", userId).eq("status", "active").lte("valid_from", today).gte("valid_until", today),
    ])

    const todayEvents: Event[] = todayEventsRes.data ?? []
    const yesterdayEvents: Event[] = yesterdayEventsRes.data ?? []
    const quests: Quest[] = questsRes.data ?? []

    await runConditionalChecks(sb, userId, todayEvents, yesterdayEvents, quests, phase)
  } catch (err) {
    console.error("[cron/day] Conditional check failed:", err)
  }

  return NextResponse.json({ ok: true, period: "day", date: today, phase })
}
