import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authHeader = req.headers.get("authorization")
  const cronHeader = req.headers.get("x-vercel-cron")

  if (!cronHeader && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://t.me/your_bot"

  if (!botToken || !chatId) {
    return NextResponse.json({ error: "Bot not configured" }, { status: 500 })
  }

  const body = {
    chat_id: chatId,
    text: "🌙 Evening check-in time — how did today go?",
    reply_markup: {
      inline_keyboard: [[
        { text: "Open habby", web_app: { url: appUrl } },
      ]],
    },
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) return NextResponse.json({ error: data.description }, { status: 500 })
  return NextResponse.json({ ok: true, period: "evening" })
}
