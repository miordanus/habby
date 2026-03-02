"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuth, apiHeaders } from "@/hooks/useAuth"
import NavBar from "@/components/NavBar"
import XPBar from "@/components/XPBar"
import StreakBadge from "@/components/StreakBadge"
import GoalChips from "@/components/GoalChips"
import Clicker from "@/components/Clicker"
import { DailyLog } from "@/types/database"

const BOT_USERNAME = "habby_bot"

interface XpData {
  totalXp: number; xpToday: number; level: number
  xpIntoLevel: number; xpForNextLevel: number
  streak: number; shieldActive: boolean
}

interface EvalRow {
  metric_key: string; met: boolean
  actual_number: number | null; actual_bool: boolean | null
  target_number: number | null; target_bool: boolean | null
}

function toastMessage(xp: number): string {
  if (xp >= 45) return `Saved! +${xp} XP 🔥`
  if (xp > 0)  return `Saved! +${xp} XP`
  return "Saved!"
}

export default function Home() {
  const router = useRouter()
  const { state, telegramUserId } = useAuth()
  const [mounted, setMounted] = useState(false)

  const [log, setLog] = useState<Partial<DailyLog>>({})
  const [draft, setDraft] = useState({
    nicotine_count: 0,
    caffeine_cups: 0,
    water_ml: 0,
    calories: 0,
    protein_g: 0,
  })

  const [xp, setXp] = useState<XpData | null>(null)
  const [evals, setEvals] = useState<EvalRow[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<null | "pending" | "saving" | "saved">(null)

  const draftRef = useRef(draft)
  const logRef = useRef(log)
  const telegramUserIdRef = useRef(telegramUserId)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLoadingRef = useRef(false)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { draftRef.current = draft }, [draft])
  useEffect(() => { logRef.current = log }, [log])
  useEffect(() => { telegramUserIdRef.current = telegramUserId }, [telegramUserId])
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const load = useCallback(async () => {
    if (!telegramUserId) return
    const hdr = { "x-telegram-user-id": String(telegramUserId) }
    const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const [logRes, xpRes, evalRes] = await Promise.all([
      fetch(`/api/logs?date=${today}`, { headers: hdr }),
      fetch("/api/xp", { headers: hdr }),
      fetch(`/api/evaluations?date=${today}`, { headers: hdr }),
    ])

    if (logRes.ok) {
      const data: DailyLog | null = await logRes.json()
      if (data) {
        isLoadingRef.current = true
        setLog(data)
        setDraft({
          nicotine_count: data.nicotine_count,
          caffeine_cups: data.caffeine_cups,
          water_ml: data.water_ml,
          calories: data.calories ?? 0,
          protein_g: data.protein_g ?? 0,
        })
        queueMicrotask(() => { isLoadingRef.current = false })
      }
    }
    if (xpRes.ok) setXp(await xpRes.json())
    if (evalRes.ok) setEvals(await evalRes.json())
  }, [telegramUserId])

  useEffect(() => {
    if (state === "authed") load()
  }, [state, load])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const performSave = useCallback(async () => {
    const tgId = telegramUserIdRef.current
    if (!tgId) return
    setAutoSaveStatus("saving")
    setSaving(true)
    try {
      const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: apiHeaders(tgId),
        body: JSON.stringify({ ...logRef.current, ...draftRef.current, date: today }),
      })
      if (res.ok) {
        const { xpEarned } = await res.json()
        if (xpEarned > 0) showToast(toastMessage(xpEarned))
        setAutoSaveStatus("saved")
        setTimeout(() => setAutoSaveStatus(null), 2000)
        load()
      } else {
        setAutoSaveStatus(null)
      }
    } catch {
      setAutoSaveStatus(null)
    } finally {
      setSaving(false)
    }
  }, [load])

  const scheduleSave = useCallback(() => {
    if (isLoadingRef.current) return
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    setAutoSaveStatus("pending")
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      performSave()
    }, 1500)
  }, [performSave])

  async function handleQuickSave() {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    await performSave()
  }

  // ── Auth gates ──────────────────────────────────────────────────────────────

  if (!mounted || state === "checking") {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center">
        <p className="text-sm font-mono text-[var(--text-muted)]">Loading…</p>
      </div>
    )
  }

  if (state === "no_initdata" || state === "invalid_initdata") {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex flex-col items-center justify-center gap-4 px-8">
        <p className="text-sm font-mono text-[var(--text-muted)] text-center">
          Open from Telegram: @{BOT_USERNAME}
        </p>
        <a
          href={`https://t.me/${BOT_USERNAME}`}
          className="text-xs font-mono text-black bg-[#00FF85] px-4 py-2 rounded-lg"
        >
          Open bot
        </a>
      </div>
    )
  }

  if (state === "error") {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center px-8">
        <p className="text-sm font-mono text-[var(--text-muted)] text-center">
          Something went wrong. Close and reopen the app.
        </p>
      </div>
    )
  }

  // ── Main app ────────────────────────────────────────────────────────────────

  const today = new Date(Date.now() - 5 * 60 * 60 * 1000)
  const dateLabel = today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })

  return (
    <div
      className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]"
      style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      {/* Header */}
      <header
        className="px-4 pb-4 max-w-xl mx-auto"
        style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top, 2.5rem))" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">habby</h1>
            <p className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest">{dateLabel}</p>
          </div>
          {xp && <StreakBadge streak={xp.streak} shieldActive={xp.shieldActive} />}
        </div>
        {xp && (
          <XPBar
            totalXp={xp.totalXp}
            xpToday={xp.xpToday}
            level={xp.level}
            xpIntoLevel={xp.xpIntoLevel}
            xpForNextLevel={xp.xpForNextLevel}
          />
        )}
      </header>

      {/* Goal chips */}
      {evals.length > 0 && (
        <div className="px-4 mb-3 max-w-xl mx-auto">
          <GoalChips evaluations={evals} />
        </div>
      )}

      {/* Clicker grid */}
      <main className="px-4 max-w-xl mx-auto">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-1 mb-3">
          <Clicker
            label="🚬"
            value={draft.nicotine_count}
            increments={[1, 5]}
            onAdd={(n) => { setDraft((d) => ({ ...d, nicotine_count: d.nicotine_count + n })); scheduleSave() }}
            onSub={() => { setDraft((d) => ({ ...d, nicotine_count: Math.max(0, d.nicotine_count - 1) })); scheduleSave() }}
          />
          <div className="border-t border-[var(--border)]" />
          <Clicker
            label="☕"
            value={draft.caffeine_cups}
            increments={[1]}
            onAdd={(n) => { setDraft((d) => ({ ...d, caffeine_cups: d.caffeine_cups + n })); scheduleSave() }}
            onSub={() => { setDraft((d) => ({ ...d, caffeine_cups: Math.max(0, d.caffeine_cups - 1) })); scheduleSave() }}
          />
          <div className="border-t border-[var(--border)]" />
          <Clicker
            label="💧"
            value={draft.water_ml}
            unit="ml"
            increments={[250, 500]}
            onAdd={(n) => { setDraft((d) => ({ ...d, water_ml: d.water_ml + n })); scheduleSave() }}
            onSub={() => { setDraft((d) => ({ ...d, water_ml: Math.max(0, d.water_ml - 250) })); scheduleSave() }}
          />
          <div className="border-t border-[var(--border)]" />
          <Clicker
            label="🍽"
            value={draft.calories}
            unit="kcal"
            increments={[200, 500]}
            onAdd={(n) => { setDraft((d) => ({ ...d, calories: d.calories + n })); scheduleSave() }}
            onSub={() => { setDraft((d) => ({ ...d, calories: Math.max(0, d.calories - 200) })); scheduleSave() }}
          />
          <div className="border-t border-[var(--border)]" />
          <Clicker
            label="🥩"
            value={draft.protein_g}
            unit="g"
            increments={[25, 50]}
            onAdd={(n) => { setDraft((d) => ({ ...d, protein_g: d.protein_g + n })); scheduleSave() }}
            onSub={() => { setDraft((d) => ({ ...d, protein_g: Math.max(0, d.protein_g - 25) })); scheduleSave() }}
          />
        </div>

        {/* Quick save */}
        {autoSaveStatus !== null && (
          <p className="text-xs font-mono text-[var(--text-muted)] text-center mb-1">
            {autoSaveStatus === "pending" && "Unsaved changes…"}
            {autoSaveStatus === "saving" && "Saving…"}
            {autoSaveStatus === "saved" && "Saved ✓"}
          </p>
        )}
        <button
          onClick={handleQuickSave}
          disabled={saving}
          className="w-full py-4 bg-[#00FF85] text-black font-bold text-sm uppercase tracking-wider rounded-xl mb-3 disabled:opacity-50 active:scale-95 transition-transform"
        >
          Save
        </button>

        {/* Nav shortcuts */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => router.push("/checkin")}
            className="py-3 border border-[var(--border)] rounded-xl text-sm font-mono text-[var(--text-muted)] hover:border-[#444] transition-colors"
          >
            ✏️ Full Check-in
          </button>
          <button
            onClick={() => router.push("/history")}
            className="py-3 border border-[var(--border)] rounded-xl text-sm font-mono text-[var(--text-muted)] hover:border-[#444] transition-colors"
          >
            📅 History
          </button>
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-[#00FF85] text-black font-bold text-sm px-5 py-3 rounded-xl z-50 pointer-events-none">
          {toast}
        </div>
      )}

      <NavBar />
    </div>
  )
}
