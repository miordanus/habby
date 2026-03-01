import { NextRequest } from "next/server"
import { sendReminder } from "@/lib/cronReminder"

export async function GET(req: NextRequest) {
  return sendReminder(req, "morning")
}
