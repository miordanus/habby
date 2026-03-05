import { NextRequest, NextResponse } from "next/server"
import { verifyCronAuth, sendTelegramMessage } from "@/lib/cronReminder"
import { getSupabase } from "@/lib/supabaseServer"
import { getLogicalDate } from "@/lib/logicalDate"
import { computeDayScore } from "@/lib/scoreEngine"
import { generateAI } from "@/lib/aiProvider"
import type { Event, Quest, HealthSample } from "@/types/database"

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

  let text = `🌙 *Neuro-Run: вечер*\nКак прошёл день? Проверь результаты и оцени стрик.`

  if (userId) {
    try {
      // Gather data for scoring
      const [eventsRes, questsRes, healthRes] = await Promise.all([
        sb.from("events").select("*").eq("user_id", userId).eq("logical_date", today),
        sb.from("quests").select("*").eq("user_id", userId).lte("valid_from", today).gte("valid_until", today),
        sb.from("health_samples").select("*").eq("user_id", userId).eq("sample_date", today),
      ])

      const events: Event[] = eventsRes.data ?? []
      const quests: Quest[] = questsRes.data ?? []
      const healthSamples: HealthSample[] = healthRes.data ?? []

      const score = computeDayScore(events, quests, healthSamples)
      const dailyQuests = quests.filter((q) => q.quest_type === "daily")
      const questsCompleted = dailyQuests.filter((q) => q.status === "completed").length

      // Upsert daily summary
      await sb.from("daily_summaries").upsert(
        {
          user_id: userId,
          date: today,
          ...score,
          quests_completed: questsCompleted,
          quests_total: dailyQuests.length,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "user_id,date" }
      )

      const nicotineCount = events.filter((e) => e.type === "nicotine").length
      const waterTotal = events.filter((e) => e.type === "water_ml").reduce((s, e) => s + (e.value ?? 0), 0)
      const coffeeCount = events.filter((e) => e.type === "coffee_cup").length

      // Generate AI verdict
      const ai = await generateAI(sb, "daily_verdict", {
        date: today,
        day_score: score.day_score,
        recovery: score.recovery_score,
        focus: score.focus_score,
        stress: score.stress_score,
        discipline: score.discipline_score,
        nicotine_count: nicotineCount,
        water_ml: waterTotal,
        coffee_count: coffeeCount,
        quests_completed: questsCompleted,
        quests_total: dailyQuests.length,
        score_reasons: score.score_reasons.map((r) => r.reason).join("; "),
        streak: 0, // TODO: compute streak
      })

      // Update summary verdict
      await sb.from("daily_summaries").update({ verdict: ai.diagnosis }).eq("user_id", userId).eq("date", today)

      text = [
        `🌙 *Neuro-Run: итог дня*`,
        `Счёт: *${score.day_score}/100* | Квесты: ${questsCompleted}/${dailyQuests.length}`,
        ``,
        ai.diagnosis,
        ai.action,
        ai.vibe_line ? `\n_${ai.vibe_line}_` : "",
      ].filter(Boolean).join("\n")
    } catch (err) {
      console.error("[cron/evening] Failed:", err)
    }
  }

  await sendTelegramMessage(text, [{ text: "🎮 Neuro-Run", web_app: { url: appUrl } }])
  return NextResponse.json({ ok: true, period: "evening", date: today })
}
