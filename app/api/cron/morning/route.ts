import { NextRequest, NextResponse } from "next/server"
import { verifyCronAuth, sendTelegramMessage } from "@/lib/cronReminder"
import { getSupabase } from "@/lib/supabaseServer"
import { getLogicalDate } from "@/lib/logicalDate"
import { generateDailyQuests, generateWeeklyQuests, expireOldQuests } from "@/lib/questEngine"
import { generateAI } from "@/lib/aiProvider"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const authError = verifyCronAuth(req)
  if (authError) return authError

  const sb = getSupabase()
  const today = getLogicalDate()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://t.me/your_bot"
  const chatId = process.env.TELEGRAM_CHAT_ID

  // Resolve user
  let userId: string | null = null
  if (chatId) {
    const { data: user } = await sb
      .from("users")
      .select("id")
      .eq("telegram_user_id", Number(chatId))
      .maybeSingle()
    userId = user?.id ?? null
  }

  // Generate quests
  if (userId) {
    try {
      await expireOldQuests(sb, userId, today)
      await generateDailyQuests(sb, userId, today)
      await generateWeeklyQuests(sb, userId, today)
    } catch (err) {
      console.error("[cron/morning] Quest generation failed:", err)
    }
  }

  // Get quest titles for AI prompt
  let questTitles = "квесты дня"
  if (userId) {
    const { data: quests } = await sb
      .from("quests")
      .select("title")
      .eq("user_id", userId)
      .eq("quest_type", "daily")
      .eq("valid_from", today)
      .limit(3)
    if (quests && quests.length > 0) {
      questTitles = quests.map((q: { title: string }) => q.title).join(", ")
    }
  }

  // Get streak from XP
  let streak = 0
  if (userId) {
    const { data: xpData } = await sb
      .from("xp_events")
      .select("date")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(30)
    streak = (xpData ?? []).length
  }

  // Generate AI morning message
  let text = `🌅 *Neuro-Run: утро*\nНовый день, новые квесты. Открой и посмотри свой план.\n\n📅 ${questTitles}`
  if (userId) {
    try {
      const ai = await generateAI(sb, "intervention_morning", {
        yesterday_nicotine: "N/A",
        yesterday_water_ml: "N/A",
        yesterday_quests_done: "N/A",
        quest_titles: questTitles,
        streak,
      })
      text = [
        `🌅 *Neuro-Run: утро*`,
        ai.diagnosis,
        ai.action,
        ai.vibe_line ? `\n_${ai.vibe_line}_` : "",
        `\n📅 Квесты: ${questTitles}`,
      ].filter(Boolean).join("\n")
    } catch (err) {
      console.error("[cron/morning] AI generation failed:", err)
    }
  }

  await sendTelegramMessage(text, [{ text: "🎮 Neuro-Run", web_app: { url: appUrl } }])
  return NextResponse.json({ ok: true, period: "morning", date: today })
}
