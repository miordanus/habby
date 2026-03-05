"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth, apiHeaders } from "@/hooks/useAuth"
import NavBar from "@/components/NavBar"
import XPBar from "@/components/XPBar"
import StreakBadge from "@/components/StreakBadge"
import PhaseBar from "@/components/PhaseBar"
import QuestCard from "@/components/QuestCard"
import NicotineButton from "@/components/NicotineButton"
import RatingBar from "@/components/RatingBar"
import Clicker from "@/components/Clicker"
import { getCurrentPhase } from "@/lib/phaseUtils"
import type { Quest, QuestProgress, Phase } from "@/types/database"

const BOT_USERNAME = "habby_bot"

interface XpData {
  totalXp: number; xpToday: number; level: number
  xpIntoLevel: number; xpForNextLevel: number
  streak: number; shieldActive: boolean
}

interface QuestWithProgress extends Quest {
  progress: QuestProgress
}

interface QuestsResponse {
  quests: QuestWithProgress[]
  phase: Phase
  summary: { completed: number; total: number }
}

interface EventCounts {
  nicotine: number
  coffee: number
  water: number
}

function toastMessage(xp: number): string {
  if (xp >= 45) return `+${xp} XP 🔥`
  if (xp > 0)  return `+${xp} XP`
  return "Залогировано!"
}

export default function Home() {
  const router = useRouter()
  const { state, telegramUserId } = useAuth()
  const [mounted, setMounted] = useState(false)

  const [xp, setXp] = useState<XpData | null>(null)
  const [questsData, setQuestsData] = useState<QuestsResponse | null>(null)
  const [counts, setCounts] = useState<EventCounts>({ nicotine: 0, coffee: 0, water: 0 })
  const [phase, setPhase] = useState<Phase>(getCurrentPhase())
  const [toast, setToast] = useState<string | null>(null)
  const [ratingValues, setRatingValues] = useState<{ energy: number | null; focus: number | null; stress: number | null }>({
    energy: null, focus: null, stress: null,
  })

  useEffect(() => {
    setMounted(true)
    // Refresh phase every minute
    const interval = setInterval(() => setPhase(getCurrentPhase()), 60_000)
    return () => clearInterval(interval)
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const load = useCallback(async () => {
    if (!telegramUserId) return
    const hdr = { "x-telegram-user-id": String(telegramUserId) }
    const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const [xpRes, questsRes, eventsRes] = await Promise.all([
      fetch("/api/xp", { headers: hdr }),
      fetch("/api/quests", { headers: hdr }),
      fetch(`/api/events?date=${today}`, { headers: hdr }),
    ])

    if (xpRes.ok) setXp(await xpRes.json())
    if (questsRes.ok) setQuestsData(await questsRes.json())
    if (eventsRes.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: any[] = await eventsRes.json()
      setCounts({
        nicotine: events.filter((e) => e.type === "nicotine").length,
        coffee:   events.filter((e) => e.type === "coffee_cup").length,
        water:    events.filter((e) => e.type === "water_ml").reduce((s: number, e: { value: number }) => s + (e.value ?? 0), 0),
      })
    }
  }, [telegramUserId])

  useEffect(() => {
    if (state === "authed") load()
  }, [state, load])

  const logEvent = useCallback(
    async (type: string, params: Record<string, unknown> = {}) => {
      if (!telegramUserId) return 0
      const res = await fetch("/api/events", {
        method: "POST",
        headers: apiHeaders(telegramUserId),
        body: JSON.stringify({ type, ...params }),
      })
      return res.ok ? 1 : 0
    },
    [telegramUserId]
  )

  const handleNicotineLogged = useCallback(() => {
    setCounts((c) => ({ ...c, nicotine: c.nicotine + 1 }))
    showToast("🚬 залогировано")
    load()
  }, [load])

  const handleCoffeeAdd = useCallback(async () => {
    await logEvent("coffee_cup", { value: 1 })
    setCounts((c) => ({ ...c, coffee: c.coffee + 1 }))
    showToast("☕ залогировано")
    load()
  }, [logEvent, load])

  const handleWaterAdd = useCallback(
    async (ml: number) => {
      await logEvent("water_ml", { value: ml })
      setCounts((c) => ({ ...c, water: c.water + ml }))
      showToast(`💧 +${ml}мл`)
      load()
    },
    [logEvent, load]
  )

  const handleRating = useCallback(
    async (type: "energy" | "focus" | "stress", value: number) => {
      setRatingValues((v) => ({ ...v, [type]: value }))
      await logEvent(`self_rating_${type}`, { value })
      showToast(`Оценка сохранена`)
      load()
    },
    [logEvent, load]
  )

  const handleQuestComplete = useCallback(
    async (questId: string) => {
      if (!telegramUserId) return
      const res = await fetch(`/api/quests/${questId}`, {
        method: "PATCH",
        headers: apiHeaders(telegramUserId),
        body: JSON.stringify({ status: "completed", reason: "User marked complete" }),
      })
      if (res.ok) {
        showToast("Квест выполнен! 🎉")
        load()
      }
    },
    [telegramUserId, load]
  )

  // ── Auth gates ────────────────────────────────────────────────

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

  // ── Main app ──────────────────────────────────────────────────

  const today = new Date(Date.now() - 5 * 60 * 60 * 1000)
  const dateLabel = today.toLocaleDateString("ru-RU", { weekday: "short", month: "short", day: "numeric" })

  const dailyQuests = questsData?.quests.filter((q) => q.quest_type === "daily") ?? []
  const weeklyQuests = questsData?.quests.filter((q) => q.quest_type === "weekly") ?? []

  return (
    <div
      className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]"
      style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      {/* Header */}
      <header
        className="px-4 pb-3 max-w-xl mx-auto"
        style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top, 2.5rem))" }}
      >
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Neuro-Run</h1>
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
        <div className="mt-2">
          <PhaseBar phase={phase} />
        </div>
      </header>

      <main className="px-4 max-w-xl mx-auto space-y-4">

        {/* Daily quests */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest">
              Квесты дня
            </h2>
            {questsData && (
              <span className="text-xs font-mono text-[var(--text-muted)]">
                {questsData.summary.completed}/{questsData.summary.total}
              </span>
            )}
          </div>

          {dailyQuests.length === 0 ? (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-6 text-center">
              <p className="text-sm font-mono text-[var(--text-muted)]">Квесты ещё не назначены</p>
              <p className="text-xs font-mono text-[var(--text-muted)] mt-1 opacity-60">Они появятся утром</p>
            </div>
          ) : (
            <div className="space-y-2">
              {dailyQuests.map((q) => (
                <QuestCard
                  key={q.id}
                  quest={q}
                  progress={q.progress}
                  onComplete={handleQuestComplete}
                />
              ))}
            </div>
          )}
        </section>

        {/* Weekly quests (collapsed section) */}
        {weeklyQuests.length > 0 && (
          <section>
            <h2 className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest mb-2">
              Квесты недели
            </h2>
            <div className="space-y-2">
              {weeklyQuests.map((q) => (
                <QuestCard key={q.id} quest={q} progress={q.progress} />
              ))}
            </div>
          </section>
        )}

        {/* Quick log */}
        <section>
          <h2 className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest mb-2">
            Быстрый лог
          </h2>

          {/* Nicotine — primary action */}
          <div className="mb-3">
            <NicotineButton
              telegramUserId={telegramUserId}
              count={counts.nicotine}
              onLogged={handleNicotineLogged}
            />
          </div>

          {/* Coffee + Water */}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-1 mb-3">
            <Clicker
              label="☕"
              value={counts.coffee}
              increments={[1]}
              onAdd={handleCoffeeAdd}
            />
            <div className="border-t border-[var(--border)]" />
            <Clicker
              label="💧"
              value={counts.water}
              unit="мл"
              increments={[250, 500]}
              onAdd={(n) => handleWaterAdd(n)}
            />
          </div>

          {/* State ratings */}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-4 space-y-4">
            <RatingBar type="energy" value={ratingValues.energy} onChange={(v) => handleRating("energy", v)} />
            <RatingBar type="focus"  value={ratingValues.focus}  onChange={(v) => handleRating("focus", v)} />
            <RatingBar type="stress" value={ratingValues.stress} onChange={(v) => handleRating("stress", v)} />
          </div>
        </section>

        {/* Nav shortcuts */}
        <div className="grid grid-cols-2 gap-2 pb-2">
          <button
            onClick={() => router.push("/checkin")}
            className="py-3 border border-[var(--border)] rounded-xl text-sm font-mono text-[var(--text-muted)] hover:border-[#444] transition-colors"
          >
            ✏️ Полный лог
          </button>
          <button
            onClick={() => router.push("/timeline")}
            className="py-3 border border-[var(--border)] rounded-xl text-sm font-mono text-[var(--text-muted)] hover:border-[#444] transition-colors"
          >
            📊 Таймлайн
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
