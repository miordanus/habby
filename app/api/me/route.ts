import { NextRequest, NextResponse } from "next/server"
import { getUserId } from "@/lib/supabaseServer"

export async function GET(req: NextRequest) {
  const tgIdStr = req.headers.get("x-telegram-user-id")
  if (!tgIdStr) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const telegramUserId = Number(tgIdStr)
  if (!Number.isFinite(telegramUserId)) return NextResponse.json({ error: "Bad user id" }, { status: 400 })

  try {
    const userId = await getUserId(telegramUserId)
    return NextResponse.json({ user_id: userId })
  } catch (err) {
    console.error("[/api/me]", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
