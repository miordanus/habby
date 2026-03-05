import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { parseTgId } from "@/lib/parseRequest"
import type { NicotineType } from "@/types/database"

export const runtime = "nodejs"

/** GET /api/preferences — return user preferences (upsert defaults if not set) */
export async function GET(req: NextRequest) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sb = getSupabase()
  const userId = await getUserId(tgId)

  // Upsert defaults if not exists
  await sb.from("user_preferences").upsert(
    { user_id: userId, nicotine_default_type: "cig", timezone: "Europe/Rome" },
    { onConflict: "user_id", ignoreDuplicates: true }
  )

  const { data, error } = await sb
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** PATCH /api/preferences — update nicotine_default_type or timezone */
export async function PATCH(req: NextRequest) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sb = getSupabase()
  const userId = await getUserId(tgId)

  let body: { nicotine_default_type?: NicotineType; timezone?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const validTypes: NicotineType[] = ["cig", "vape", "pouch", "other"]
  if (body.nicotine_default_type && !validTypes.includes(body.nicotine_default_type)) {
    return NextResponse.json({ error: "Invalid nicotine_default_type" }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (body.nicotine_default_type) update.nicotine_default_type = body.nicotine_default_type
  if (body.timezone) update.timezone = body.timezone

  const { data, error } = await sb
    .from("user_preferences")
    .upsert({ user_id: userId, ...update }, { onConflict: "user_id" })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
