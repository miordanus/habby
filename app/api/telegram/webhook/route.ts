// Telegram webhook receiver — handles callback_query updates from inline keyboards.
// Register with: POST https://api.telegram.org/bot{TOKEN}/setWebhook
//                Body: { "url": "https://your-app.vercel.app/api/telegram/webhook" }
import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { answerCallbackQuery, editMessageText } from "@/lib/cronReminder"
import type { EventType } from "@/types/database"

export const runtime = "nodejs"

// ── Callback data → event mapping ─────────────────────────────

interface EventSpec {
  type: EventType
  value?: number
  value_bool?: boolean
  confirmText: string  // shown after logging
}

function parseCallbackData(data: string): EventSpec | null {
  const [action, rawValue] = data.split(":")
  const numValue = Number(rawValue)

  switch (action) {
    case "log_water":
      return { type: "water_ml", value: numValue || 250, confirmText: `💧 Вода ${numValue || 250} мл — записано` }
    case "log_nicotine":
      return { type: "nicotine", value: 1, confirmText: "🚬 Никотин — записан" }
    case "log_coffee":
      return { type: "coffee_cup", value: 1, confirmText: "☕ Кофе — записан" }
    case "log_energy":
      return { type: "self_rating_energy", value: numValue || 3, confirmText: `⚡ Энергия ${numValue || 3}/5 — записана` }
    case "log_focus":
      return { type: "self_rating_focus", value: numValue || 3, confirmText: `🎯 Фокус ${numValue || 3}/5 — записан` }
    case "log_stress":
      return { type: "self_rating_stress", value: numValue || 3, confirmText: `😤 Стресс ${numValue || 3}/5 — записан` }
    case "log_ltheanine":
      return { type: "l_theanine", value_bool: true, confirmText: "🍵 L-теанин — записан" }
    case "log_vitamins":
      return { type: "vitamins_adam", value_bool: true, confirmText: "💊 Витамины — записаны" }
    case "all_good":
      return null  // no event to log, just dismiss
    default:
      return null
  }
}

// ── Webhook handler ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Parse Telegram update
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let update: any
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // We only handle callback_query updates
  const cq = update?.callback_query
  if (!cq) {
    return NextResponse.json({ ok: true })  // ignore other update types
  }

  const callbackQueryId: string = cq.id
  const fromId: number = cq.from?.id
  const callbackData: string = cq.data ?? ""
  const chatId: string = String(cq.message?.chat?.id ?? "")
  const messageId: number = cq.message?.message_id

  // Security: only accept updates from the configured user
  const allowedChatId = process.env.TELEGRAM_CHAT_ID
  if (!allowedChatId || String(fromId) !== allowedChatId) {
    await answerCallbackQuery(callbackQueryId, "⛔ Нет доступа")
    return NextResponse.json({ ok: true })
  }

  const eventSpec = parseCallbackData(callbackData)

  if (!eventSpec) {
    // "all_good" or unknown — just dismiss
    await answerCallbackQuery(callbackQueryId, "✅ Окей!")
    if (messageId && chatId) {
      const originalText = cq.message?.text ?? ""
      await editMessageText(chatId, messageId, `${originalText}\n\n✅ _Окей_`)
    }
    return NextResponse.json({ ok: true })
  }

  // Log the event
  try {
    const sb = getSupabase()
    const userId = await getUserId(fromId)

    const { error } = await sb.from("events").insert({
      user_id: userId,
      type: eventSpec.type,
      value: eventSpec.value ?? null,
      value_bool: eventSpec.value_bool ?? null,
      ts_effective: new Date().toISOString(),
    })

    if (error) {
      console.error("[webhook] Event insert failed:", error.message)
      await answerCallbackQuery(callbackQueryId, "❌ Ошибка записи")
      return NextResponse.json({ ok: true })
    }

    // Mark intervention as responded
    if (messageId) {
      await sb
        .from("interventions")
        .update({
          responded_at: new Date().toISOString(),
          response_data: callbackData,
        })
        .eq("telegram_message_id", messageId)
        .is("responded_at", null)
    }

    // Dismiss spinner and confirm in message
    await answerCallbackQuery(callbackQueryId, eventSpec.confirmText)
    if (messageId && chatId) {
      const originalText = cq.message?.text ?? ""
      await editMessageText(chatId, messageId, `${originalText}\n\n✅ _${eventSpec.confirmText}_`)
    }
  } catch (err) {
    console.error("[webhook] Unexpected error:", err)
    await answerCallbackQuery(callbackQueryId, "❌ Ошибка")
  }

  return NextResponse.json({ ok: true })
}
