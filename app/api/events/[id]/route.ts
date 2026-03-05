import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { parseTgId } from "@/lib/parseRequest"
import { dateDiff, getLogicalDate } from "@/lib/logicalDate"

export const runtime = "nodejs"

/** PATCH /api/events/[id] — update ts_effective of an event (within 7-day window) */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: "Missing event id" }, { status: 400 })

  let body: { ts_effective: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body.ts_effective) {
    return NextResponse.json({ error: "ts_effective required" }, { status: 400 })
  }

  const newTs = new Date(body.ts_effective)
  if (isNaN(newTs.getTime())) {
    return NextResponse.json({ error: "Invalid ts_effective" }, { status: 400 })
  }

  // Validate new timestamp is within 7-day window, not in future
  const today = getLogicalDate()
  const logicalDateOfNewTs = new Date(newTs.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const diff = dateDiff(today, logicalDateOfNewTs)

  if (diff < 0) return NextResponse.json({ error: "Cannot set future timestamp" }, { status: 400 })
  if (diff > 7) return NextResponse.json({ error: "Cannot set timestamp older than 7 days" }, { status: 400 })

  const sb = getSupabase()
  const userId = await getUserId(tgId)

  // Verify ownership
  const { data: existing } = await sb
    .from("events")
    .select("id, user_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: "Event not found" }, { status: 404 })

  const { data, error } = await sb
    .from("events")
    .update({ ts_effective: newTs.toISOString() })
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
