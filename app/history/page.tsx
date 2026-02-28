"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import NavBar from "@/components/NavBar"

interface LogEntry {
  date: string
  nicotine_count: number
  caffeine_cups: number
  water_ml: number
  calories: number | null
  training_type: string
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z")
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

export default function HistoryPage() {
  const router = useRouter()
  const { state, telegramUserId } = useAuth()
  const [mounted, setMounted] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loggedDates, setLoggedDates] = useState<Set<string>>(new Set())

  useEffect(() => { setMounted(true) }, [])

  const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const sevenDaysAgo = new Date(new Date(today + "T12:00:00Z").getTime() - 6 * 86400000)
    .toISOString().slice(0, 10)

  const load = useCallback(async () => {
    if (!telegramUserId) return
    const res = await fetch(`/api/logs?from=${sevenDaysAgo}&to=${today}`, {
      headers: { "x-telegram-user-id": String(telegramUserId) },
    })
    if (res.ok) {
      const data: LogEntry[] = await res.json()
      setLogs(data)
      setLoggedDates(new Set(data.map((l) => l.date)))
    }
  }, [telegramUserId, today, sevenDaysAgo])

  useEffect(() => {
    if (state === "authed") load()
  }, [state, load])

  // Build list of last 7 logical days
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(new Date(today + "T12:00:00Z").getTime() - i * 86400000)
    days.push(d.toISOString().slice(0, 10))
  }

  function logForDate(date: string): LogEntry | undefined {
    return logs.find((l) => l.date === date)
  }

  const trainingEmoji: Record<string, string> = {
    swim: "🏊", gym: "🏋️", home: "🏠", none: "",
  }

  if (!mounted || state === "checking") {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center">
        <p className="text-sm font-mono text-[var(--text-muted)]">Loading…</p>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]"
      style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <header
        className="px-4 pb-4 max-w-xl mx-auto border-b border-[var(--border)]"
        style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top, 2.5rem))" }}
      >
        <h1 className="text-lg font-bold">History</h1>
        <p className="text-xs font-mono text-[var(--text-muted)]">Last 7 days — tap to edit</p>
      </header>

      <main className="px-4 max-w-xl mx-auto pt-4 space-y-2">
        {days.map((date) => {
          const log = logForDate(date)
          const isLogged = loggedDates.has(date)
          const isToday = date === today

          return (
            <button
              key={date}
              onClick={() => router.push(`/checkin?date=${date}`)}
              className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 flex items-center gap-3 text-left active:scale-[0.99] transition-transform hover:border-[#444]"
            >
              <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center border border-[var(--border)] text-lg">
                {isLogged ? "✅" : "○"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-bold">{formatDate(date)}</span>
                  {isToday && (
                    <span className="text-[10px] font-mono bg-[#00FF85] text-black px-1.5 py-0.5 rounded">
                      today
                    </span>
                  )}
                </div>
                {log ? (
                  <p className="text-xs font-mono text-[var(--text-muted)] mt-0.5">
                    🚬{log.nicotine_count} ☕{log.caffeine_cups} 💧{(log.water_ml / 1000).toFixed(1)}L
                    {log.calories ? ` 🍽${log.calories}` : ""}
                    {log.training_type !== "none" ? ` ${trainingEmoji[log.training_type] ?? ""}` : ""}
                  </p>
                ) : (
                  <p className="text-xs font-mono text-[var(--text-muted)] mt-0.5">Not logged</p>
                )}
              </div>
              <span className="text-[var(--text-muted)] text-sm">→</span>
            </button>
          )
        })}
      </main>

      <NavBar />
    </div>
  )
}
