// SERVER ONLY — shared Telegram messaging + cron auth helpers.
import { NextRequest, NextResponse } from "next/server"

// ── Auth helper ────────────────────────────────────────────────

export function verifyCronAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  const cronHeader = req.headers.get("x-vercel-cron")
  const authHeader = req.headers.get("authorization")

  // Guard: require a configured secret so "Bearer undefined" can never match.
  if (!secret && !cronHeader) {
    return NextResponse.json({ error: "Cron not configured" }, { status: 500 })
  }
  if (!cronHeader && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null // auth passed
}

// ── Telegram button types ──────────────────────────────────────

export interface TelegramButton {
  text: string
  url?: string
  web_app?: { url: string }
  callback_data?: string  // for inline keyboard callback queries
}

/**
 * Send a Telegram message to the configured chat.
 * Returns the Telegram message ID on success, or null on error.
 */
export async function sendTelegramMessage(
  text: string,
  buttons: TelegramButton[] = []
): Promise<number | null> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!botToken || !chatId) {
    console.error("[cronReminder] Bot not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing)")
    return null
  }

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  }

  if (buttons.length > 0) {
    body.reply_markup = { inline_keyboard: [buttons] }
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any
    if (!res.ok) {
      console.error("[cronReminder] Telegram error:", data.description)
      return null
    }
    return data.result?.message_id ?? null
  } catch (err) {
    console.error("[cronReminder] sendTelegramMessage failed:", err)
    return null
  }
}

// ── Callback query helpers ─────────────────────────────────────

/**
 * Dismiss the loading spinner after a user taps an inline button.
 * Must be called within 10 seconds of receiving the callback_query update.
 */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    })
  } catch (err) {
    console.error("[cronReminder] answerCallbackQuery failed:", err)
  }
}

/**
 * Edit the text of an existing bot message (e.g. show confirmation after tap).
 */
export async function editMessageText(
  chatId: string,
  messageId: number,
  text: string,
  buttons: TelegramButton[] = []
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return

  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "Markdown",
  }

  if (buttons.length > 0) {
    body.reply_markup = { inline_keyboard: [buttons] }
  }

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error("[cronReminder] editMessageText failed:", err)
  }
}

// ── Legacy reminder helper (used by cron routes) ───────────────

export async function sendReminder(req: NextRequest, period: "morning" | "evening") {
  const authError = verifyCronAuth(req)
  if (authError) return authError

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://t.me/your_bot"

  const text =
    period === "morning"
      ? "🌅 *Neuro-Run: утро*\nНовый день, новые квесты. Открой и посмотри свой план."
      : "🌙 *Neuro-Run: вечер*\nКак прошёл день? Проверь результаты и оцени стрик."

  const buttons: TelegramButton[] = [{ text: "🎮 Neuro-Run", web_app: { url: appUrl } }]
  await sendTelegramMessage(text, buttons)
  return NextResponse.json({ ok: true, period })
}
