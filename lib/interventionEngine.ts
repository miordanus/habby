// SERVER ONLY — Conditional intervention trigger logic.
import { SupabaseClient } from "@supabase/supabase-js"
import { generateAI } from "./aiProvider"
import { sendTelegramMessage } from "./cronReminder"
import type { Event, Quest, Phase } from "@/types/database"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient<any>

// ── Trigger condition checks ──────────────────────────────────

/** True if nicotine rate today is > 2x the daily goal rate for elapsed time */
export function checkNicotineSpike(events: Event[], goalLimit: number): boolean {
  const now = Date.now()
  const todayStart = new Date(now - 5 * 60 * 60 * 1000)
  todayStart.setUTCHours(5, 0, 0, 0) // 05:00 UTC = logical day start
  const elapsed = (now - todayStart.getTime()) / (24 * 60 * 60 * 1000) // fraction of day

  const nicotineCount = events.filter((e) => e.type === "nicotine").length
  const expectedMax = goalLimit * elapsed * 2 // 2x tolerance
  return nicotineCount > expectedMax && nicotineCount > 5 // don't alert too early
}

/** True if water intake is < 30% of 2000ml goal by day phase */
export function checkHydrationLow(events: Event[], phase: Phase): boolean {
  if (phase === "morning") return false // too early to alert
  const waterTotal = events
    .filter((e) => e.type === "water_ml")
    .reduce((sum, e) => sum + (e.value ?? 0), 0)
  const threshold = phase === "day" ? 600 : 900 // day: 30%, evening: 45% of 2000ml
  return waterTotal < threshold
}

/** True if no events logged in last 3 hours during day phase */
export function checkNoEvents(events: Event[], phase: Phase): boolean {
  if (phase !== "day") return false
  if (events.length === 0) return true
  const latest = events.reduce((max, e) => {
    const t = new Date(e.ts_effective).getTime()
    return t > max ? t : max
  }, 0)
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000
  return latest < threeHoursAgo
}

/** True if today's nicotine/water shows strong improvement vs yesterday */
export function checkImprovement(
  todayEvents: Event[],
  yesterdayEvents: Event[]
): boolean {
  const todayNic = todayEvents.filter((e) => e.type === "nicotine").length
  const yestNic = yesterdayEvents.filter((e) => e.type === "nicotine").length
  const todayWater = todayEvents.filter((e) => e.type === "water_ml").reduce((s, e) => s + (e.value ?? 0), 0)
  const yestWater = yesterdayEvents.filter((e) => e.type === "water_ml").reduce((s, e) => s + (e.value ?? 0), 0)

  const nicBetter = yestNic > 0 && todayNic < yestNic * 0.6 // 40%+ reduction
  const waterBetter = yestWater > 0 && todayWater > yestWater * 1.4 // 40%+ increase
  return nicBetter || waterBetter
}

/** True if daily quests are at risk near phase end */
export function checkMissedQuests(quests: Quest[], phase: Phase): boolean {
  if (phase !== "evening") return false
  const dailyActive = quests.filter((q) => q.quest_type === "daily" && q.status === "active")
  return dailyActive.length >= 2 // 2+ quests still active in evening
}

// ── Intervention sending ──────────────────────────────────────

export type TriggerType =
  | "morning_window"
  | "day_window"
  | "evening_window"
  | "nicotine_spike"
  | "hydration_low"
  | "no_events"
  | "improvement"
  | "missed_quests"
  // Hourly rule-engine triggers (deterministic, no LLM)
  | "nicotine_rate"
  | "water_critical"
  | "no_events_90min"
  | "energy_untracked"
  | "coffee_theanine"
  | "vitamins_reminder"
  | "good_progress"

/** Generate AI message and send Telegram intervention. Records in DB. */
export async function sendIntervention(
  sb: SB,
  userId: string,
  triggerType: TriggerType,
  phase: Phase,
  vars: Record<string, unknown>
): Promise<void> {
  const output = await generateAI(sb, "intervention_conditional", {
    trigger_type: triggerType,
    phase,
    ...vars,
  })

  // Build Telegram message
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://t.me/your_bot"
  const lines = [output.diagnosis, output.action]
  if (output.vibe_line) lines.push(`\n_${output.vibe_line}_`)
  const text = lines.filter(Boolean).join("\n")

  const buttons = buildButtons(output.cta_types, appUrl)
  const msgId = await sendTelegramMessage(text, buttons)

  // Log intervention
  await sb.from("interventions").insert({
    user_id: userId,
    trigger_type: triggerType,
    phase,
    diagnosis: output.diagnosis,
    action_text: output.action,
    vibe_line: output.vibe_line ?? null,
    cta_types: output.cta_types,
    telegram_message_id: msgId,
    sent_at: new Date().toISOString(),
  })
}

function buildButtons(ctaTypes: string[], appUrl: string) {
  const buttons: { text: string; url?: string; web_app?: { url: string }; callback_data?: string }[] = []
  for (const cta of ctaTypes) {
    switch (cta) {
      case "open_app":
        buttons.push({ text: "🎮 Neuro-Run", web_app: { url: appUrl } })
        break
      case "log_water":
        buttons.push({ text: "💧 Залогировать воду", web_app: { url: `${appUrl}?action=water` } })
        break
      case "log_nicotine":
        buttons.push({ text: "🚬 Залогировать никотин", web_app: { url: `${appUrl}?action=nicotine` } })
        break
      default:
        // Support raw callback_data strings passed through directly
        if (cta.includes(":")) {
          const label = cta.startsWith("log_water") ? "💧 Вода" : cta.startsWith("log_energy") ? "⚡ Энергия" : "✅ Ок"
          buttons.push({ text: label, callback_data: cta })
        } else {
          buttons.push({ text: "🎮 Открыть", web_app: { url: appUrl } })
        }
    }
  }
  return buttons.length > 0 ? buttons : [{ text: "🎮 Neuro-Run", web_app: { url: appUrl } }]
}

/** Run all conditional checks and fire at most one intervention. */
export async function runConditionalChecks(
  sb: SB,
  userId: string,
  todayEvents: Event[],
  yesterdayEvents: Event[],
  quests: Quest[],
  phase: Phase
): Promise<void> {
  const nicotineCount = todayEvents.filter((e) => e.type === "nicotine").length
  const waterTotal = todayEvents.filter((e) => e.type === "water_ml").reduce((s, e) => s + (e.value ?? 0), 0)
  const minutesSinceLastEvent =
    todayEvents.length > 0
      ? Math.floor(
          (Date.now() -
            todayEvents.reduce((max, e) => {
              const t = new Date(e.ts_effective).getTime()
              return t > max ? t : max
            }, 0)) /
            60000
        )
      : 999

  const vars = { nicotine_count: nicotineCount, water_ml: waterTotal, minutes_since_last_event: minutesSinceLastEvent, phase }

  if (checkNicotineSpike(todayEvents, 20)) {
    await sendIntervention(sb, userId, "nicotine_spike", phase, vars)
    return
  }
  if (checkHydrationLow(todayEvents, phase)) {
    await sendIntervention(sb, userId, "hydration_low", phase, vars)
    return
  }
  if (checkNoEvents(todayEvents, phase)) {
    await sendIntervention(sb, userId, "no_events", phase, vars)
    return
  }
  if (checkMissedQuests(quests, phase)) {
    await sendIntervention(sb, userId, "missed_quests", phase, vars)
    return
  }
  if (checkImprovement(todayEvents, yesterdayEvents)) {
    await sendIntervention(sb, userId, "improvement", phase, vars)
  }
}
