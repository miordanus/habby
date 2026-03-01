// SERVER ONLY — shared request-parsing helpers for API route handlers.
import { NextRequest } from "next/server"

/** Extract and validate the x-telegram-user-id header. Returns null if missing/invalid. */
export function parseTgId(req: NextRequest): number | null {
  const v = req.headers.get("x-telegram-user-id")
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
