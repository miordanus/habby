import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { parseTgId } from "@/lib/parseRequest"
import { getLogicalDate } from "@/lib/logicalDate"
import { verifyCronAuth } from "@/lib/cronReminder"
import { generateDailyQuests, generateWeeklyQuests, expireOldQuests } from "@/lib/questEngine"

export const runtime = "nodejs"

/**
 * POST /api/quests/generate
 * Internal endpoint called by cron (morning) or by user for testing.
 * Auth: CRON_SECRET or x-telegram-user-id.
 */
export async function POST(req: NextRequest) {
  const today = getLogicalDate()
  const sb = getSupabase()

  // Allow cron auth OR user auth
  const cronAuthError = verifyCronAuth(req)
  const tgId = parseTgId(req)

  if (cronAuthError && !tgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let userId: string
  if (tgId) {
    userId = await getUserId(tgId)
  } else {
    // Cron: generate for all users who have had activity in last 7 days
    // For simplicity, we need at least one userId — use the TELEGRAM_CHAT_ID env
    const chatId = process.env.TELEGRAM_CHAT_ID
    if (!chatId) return NextResponse.json({ error: "No user target" }, { status: 500 })

    const { data: user } = await sb
      .from("users")
      .select("id")
      .eq("telegram_user_id", Number(chatId))
      .maybeSingle()

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
    userId = user.id
  }

  try {
    await expireOldQuests(sb, userId, today)
    await generateDailyQuests(sb, userId, today)
    await generateWeeklyQuests(sb, userId, today)

    return NextResponse.json({ ok: true, date: today })
  } catch (err) {
    console.error("[quests/generate]", err)
    return NextResponse.json({ error: "Generation failed" }, { status: 500 })
  }
}
