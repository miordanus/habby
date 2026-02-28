"use client"

import { useState, useEffect } from "react"
import { detectTelegramEnv, callTelegramReady, getTelegramInitData } from "@/lib/telegram"

export type AuthState =
  | "checking"
  | "authed"
  | "no_initdata"
  | "invalid_initdata"
  | "error"

export interface AuthInfo {
  state: AuthState
  telegramUserId: number | null
  userId: string | null
  firstName: string | null
}

const ENV_MAX_RETRIES = 10
const ENV_RETRY_MS = 200

export function useAuth(): AuthInfo {
  const [state, setState] = useState<AuthState>("checking")
  const [telegramUserId, setTelegramUserId] = useState<number | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [firstName, setFirstName] = useState<string | null>(null)

  useEffect(() => {
    // Fast path: already authed from localStorage
    const cached = localStorage.getItem("tg_user_id")
    const cachedUid = localStorage.getItem("habby_user_id")
    if (cached && cachedUid) {
      setTelegramUserId(Number(cached))
      setUserId(cachedUid)
      setState("authed")
      return
    }

    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let started = false

    async function doAuth() {
      callTelegramReady()
      const initData = getTelegramInitData()

      if (!initData) {
        setState("no_initdata")
        return
      }

      try {
        const authRes = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        })

        if (!authRes.ok) { setState("invalid_initdata"); return }

        const profile = await authRes.json()
        const tgId: number = profile.telegram_user_id
        setTelegramUserId(tgId)
        setFirstName(profile.first_name ?? null)
        localStorage.setItem("tg_user_id", String(tgId))

        // Resolve internal user_id
        const meRes = await fetch("/api/me", {
          headers: { "x-telegram-user-id": String(tgId) },
        })
        if (!meRes.ok) { setState("error"); return }

        const meData = await meRes.json()
        setUserId(meData.user_id)
        localStorage.setItem("habby_user_id", meData.user_id)

        setState("authed")
      } catch {
        setState("error")
      }
    }

    function tryDetect() {
      attempts++
      if (detectTelegramEnv()) {
        if (!started) { started = true; doAuth() }
        return
      }
      if (attempts >= ENV_MAX_RETRIES) {
        // Allow web access for dev — still attempt auth via cached initData
        if (!started) { started = true; doAuth() }
        return
      }
      timer = setTimeout(tryDetect, ENV_RETRY_MS)
    }

    tryDetect()
    return () => { if (timer) clearTimeout(timer) }
  }, [])

  return { state, telegramUserId, userId, firstName }
}

/** apiHeaders helper for use in page components */
export function apiHeaders(telegramUserId: number | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-telegram-user-id": String(telegramUserId ?? ""),
  }
}
