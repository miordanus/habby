import { NextRequest, NextResponse } from "next/server"
import { verifyCronAuth, sendTelegramMessage } from "@/lib/cronReminder"
import { getSupabase } from "@/lib/supabaseServer"
import { getLogicalDate, addDays } from "@/lib/logicalDate"
import { evaluateRules } from "@/lib/ruleEngine"
import type { Event } from "@/types/database"
import type { TriggerType } from "@/lib/interventionEngine"
import type { CallbackButton } from "@/lib/ruleEngine"

export const runtime = "nodejs"

const DAILY_CAP = 6
// Quiet hours: no sends before 05:00 or after 20:00 UTC
const ACTIVE_HOUR_START = 5
const ACTIVE_HOUR_END = 20

export async function GET(req: NextRequest) {
  const authError = verifyCronAuth(req)
  if (authError) return authError

  const utcHour = new Date().getUTCHours()
  if (utcHour < ACTIVE_HOUR_START || utcHour > ACTIVE_HOUR_END) {
    return NextResponse.json({ ok: true, skipped: "quiet_hours" })
  }

  const sb = getSupabase()
  const today = getLogicalDate()
  const yesterday = addDays(today, -1)
  const chatId = process.env.TELEGRAM_CHAT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://t.me/your_bot"

  if (!chatId) {
    return NextResponse.json({ error: "TELEGRAM_CHAT_ID not configured" }, { status: 500 })
  }

  // Resolve internal user ID
  const { data: user } = await sb
    .from("users")
    .select("id")
    .eq("telegram_user_id", Number(chatId))
    .maybeSingle()

  if (!user?.id) {
    return NextResponse.json({ ok: true, skipped: "no_user" })
  }
  const userId = user.id as string

  // Check daily intervention cap
  const todayStart = `${today}T00:00:00.000Z`
  const { count: sentToday } = await sb
    .from("interventions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", todayStart)

  if ((sentToday ?? 0) >= DAILY_CAP) {
    return NextResponse.json({ ok: true, skipped: "daily_cap", count: sentToday })
  }

  // Fetch today's and yesterday's events
  const { data: todayEvents } = await sb
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .eq("logical_date", today)
    .order("ts_effective", { ascending: true })

  const { data: yestEvents } = await sb
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .eq("logical_date", yesterday)
    .order("ts_effective", { ascending: true })

  const events = (todayEvents ?? []) as Event[]
  const yesterdayEvents = (yestEvents ?? []) as Event[]

  // Evaluate rules (pure, no I/O)
  const triggered = evaluateRules(events, yesterdayEvents, utcHour)
  if (triggered.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no_rules_triggered" })
  }

  // Fetch recent interventions for cooldown filtering
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentInterventions } = await sb
    .from("interventions")
    .select("trigger_type, created_at")
    .eq("user_id", userId)
    .gte("created_at", twoDaysAgo)
    .order("created_at", { ascending: false })

  const lastSent = new Map<string, number>()
  for (const row of recentInterventions ?? []) {
    if (!lastSent.has(row.trigger_type)) {
      lastSent.set(row.trigger_type, new Date(row.created_at).getTime())
    }
  }

  // Filter by cooldown
  const now = Date.now()
  const available = triggered.filter((rule) => {
    const last = lastSent.get(rule.trigger_type)
    if (!last) return true
    const cooldownMs = rule.cooldown_hours * 60 * 60 * 1000
    return now - last > cooldownMs
  })

  if (available.length === 0) {
    return NextResponse.json({ ok: true, skipped: "all_on_cooldown" })
  }

  // Take highest-priority (lowest priority number)
  const rule = available[0]

  // Build message text
  const obsLines = rule.observations.map((o) => `• ${o}`).join("\n")
  const text = `${obsLines}\n\n${rule.question}`

  // Fill in any web_app buttons that need the appUrl
  const buttons: CallbackButton[] = rule.buttons.map((btn) => {
    if (btn.callback_data === undefined && btn.web_app === undefined) {
      return { ...btn, web_app: { url: appUrl } }
    }
    return btn
  })

  // Send — split callback vs web_app buttons across rows for clean layout
  const callbackBtns = buttons.filter((b) => b.callback_data)
  const webAppBtns = buttons.filter((b) => b.web_app)

  const rows: CallbackButton[][] = []
  if (callbackBtns.length > 0) rows.push(callbackBtns)
  if (webAppBtns.length > 0) rows.push(webAppBtns)
  const flatButtons = rows.flat()

  const msgId = await sendTelegramMessage(text, flatButtons)

  // Log intervention
  await sb.from("interventions").insert({
    user_id: userId,
    trigger_type: rule.trigger_type as TriggerType,
    phase: utcHour < 12 ? "morning" : utcHour < 18 ? "day" : "evening",
    diagnosis: rule.observations.join(" | "),
    action_text: rule.question,
    cta_types: rule.buttons.map((b) => b.callback_data ?? "open_app"),
    telegram_message_id: msgId,
    sent_at: new Date().toISOString(),
  })

  return NextResponse.json({
    ok: true,
    trigger_type: rule.trigger_type,
    priority: rule.priority,
    message_id: msgId,
  })
}
