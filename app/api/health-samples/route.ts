import { NextRequest, NextResponse } from "next/server"
import { getSupabase, getUserId } from "@/lib/supabaseServer"

export const runtime = "nodejs"

interface HealthSampleInput {
  type: "sleep_duration" | "hrv" | "steps" | "workout" | "resting_hr"
  value?: number
  value_text?: string
  sample_date: string
  sample_start?: string
  sample_end?: string
  metadata?: Record<string, unknown>
}

/**
 * POST /api/health-samples
 * Apple Shortcuts / Health bridge endpoint.
 * Auth: x-health-secret header must match HEALTH_WEBHOOK_SECRET env var.
 * Body: { telegram_user_id: number, samples: HealthSampleInput[] }
 */
export async function POST(req: NextRequest) {
  const secret = process.env.HEALTH_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Health webhook not configured" }, { status: 500 })
  }

  const providedSecret = req.headers.get("x-health-secret")
  if (providedSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { telegram_user_id: number; samples: HealthSampleInput[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body.telegram_user_id || !Array.isArray(body.samples)) {
    return NextResponse.json({ error: "telegram_user_id and samples required" }, { status: 400 })
  }

  const sb = getSupabase()
  const userId = await getUserId(body.telegram_user_id)

  const VALID_TYPES = ["sleep_duration", "hrv", "steps", "workout", "resting_hr"]
  const rows = body.samples
    .filter((s) => VALID_TYPES.includes(s.type) && s.sample_date)
    .map((s) => ({
      user_id: userId,
      type: s.type,
      value: s.value ?? null,
      value_text: s.value_text ?? null,
      sample_date: s.sample_date,
      sample_start: s.sample_start ?? null,
      sample_end: s.sample_end ?? null,
      source: "apple_shortcuts",
      metadata: s.metadata ?? null,
    }))

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 })
  }

  const { error } = await sb.from("health_samples").insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ inserted: rows.length })
}
