// SERVER ONLY — import only from app/api/* route handlers.
// This module uses SUPABASE_SERVICE_ROLE_KEY which must never reach the browser.

import { createClient, SupabaseClient } from "@supabase/supabase-js"

// Lazily initialised so the module can be imported without env vars at build time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: SupabaseClient<any> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabase(): SupabaseClient<any> {
  if (!_client) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error("Missing Supabase env vars")
    _client = createClient(url, key)
  }
  return _client
}

/**
 * Upsert user by telegram_user_id and return internal UUID.
 * Safe to call on every request — upsert is idempotent.
 */
export async function getUserId(telegramUserId: number): Promise<string> {
  const sb = getSupabase()

  // Try to get existing user first (avoids upsert permission issues on some policies)
  const { data: existing } = await sb
    .from("users")
    .select("id")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle()

  if (existing?.id) return existing.id as string

  // Insert new user
  const { data: created, error } = await sb
    .from("users")
    .insert({ telegram_user_id: telegramUserId })
    .select("id")
    .single()

  if (error || !created) throw new Error(`Failed to create user: ${error?.message}`)
  return created.id as string
}
