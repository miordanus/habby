import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"
import { parseTgId } from "@/lib/parseRequest"
import type { QuestStatus } from "@/types/database"

export const runtime = "nodejs"

const VALID_STATUSES: QuestStatus[] = ["completed", "cancelled"]

/** PATCH /api/quests/[id] — update quest status */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tgId = parseTgId(req)
  if (!tgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sb = getSupabase()
  const userId = await getUserId(tgId)
  const { id } = await params

  let body: { status: QuestStatus; reason?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Invalid status (completed|cancelled only)" }, { status: 400 })
  }

  // Verify quest belongs to user
  const { data: quest } = await sb
    .from("quests")
    .select("id, status, user_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle()

  if (!quest) return NextResponse.json({ error: "Quest not found" }, { status: 404 })
  if (quest.status !== "active") {
    return NextResponse.json({ error: "Quest is not active" }, { status: 409 })
  }

  // Update quest status
  const { data: updated, error } = await sb
    .from("quests")
    .update({ status: body.status })
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Insert quest_history row
  await sb.from("quest_history").insert({
    quest_id: id,
    user_id: userId,
    action: body.status,
    reason: body.reason ?? null,
    initiator: "user",
  })

  // Award XP if completed
  if (body.status === "completed" && updated.xp_reward > 0) {
    const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
    await sb.from("xp_events").upsert(
      {
        user_id: userId,
        date: today,
        event_type: `quest_${id}`,
        xp: updated.xp_reward,
        meta: { quest_id: id, template_key: updated.template_key },
      },
      { onConflict: "user_id,date,event_type", ignoreDuplicates: true }
    )
  }

  return NextResponse.json(updated)
}
