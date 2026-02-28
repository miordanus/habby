"use client"

import { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/hooks/useAuth"
import NavBar from "@/components/NavBar"

interface WeekStats {
  days_logged: number
  avg_nicotine: number | null
  avg_caffeine: number | null
  avg_calories: number | null
  avg_protein: number | null
  avg_water: number | null
  training_count: number
  from: string
  to: string
}

interface StatsData {
  this_week: WeekStats
  last_week: WeekStats
}

function Stat({ label, thisVal, lastVal, unit = "" }: {
  label: string
  thisVal: number | null
  lastVal: number | null
  unit?: string
}) {
  const fmt = (v: number | null) => v == null ? "—" : `${v}${unit}`

  const diff = thisVal != null && lastVal != null ? thisVal - lastVal : null
  let diffEl = null
  if (diff != null && diff !== 0) {
    const positive = diff > 0
    // For water/protein/calories, more is better. For nicotine/caffeine, less is better.
    // We'll just show neutral delta.
    const sign = positive ? "+" : ""
    diffEl = (
      <span className="text-[10px] font-mono text-[var(--text-muted)]">
        {" "}({sign}{diff}{unit})
      </span>
    )
  }

  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
      <span className="text-sm font-mono text-[var(--text-muted)]">{label}</span>
      <div className="text-right">
        <span className="text-sm font-bold font-mono text-[var(--text)]">{fmt(thisVal)}</span>
        {diffEl}
        <div className="text-[10px] font-mono text-[var(--text-muted)]">
          prev: {fmt(lastVal)}
        </div>
      </div>
    </div>
  )
}

export default function StatsPage() {
  const { state, telegramUserId } = useAuth()
  const [mounted, setMounted] = useState(false)
  const [data, setData] = useState<StatsData | null>(null)

  useEffect(() => { setMounted(true) }, [])

  const load = useCallback(async () => {
    if (!telegramUserId) return
    const res = await fetch("/api/stats", {
      headers: { "x-telegram-user-id": String(telegramUserId) },
    })
    if (res.ok) setData(await res.json())
  }, [telegramUserId])

  useEffect(() => {
    if (state === "authed") load()
  }, [state, load])

  if (!mounted || state === "checking") {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center">
        <p className="text-sm font-mono text-[var(--text-muted)]">Loading…</p>
      </div>
    )
  }

  const tw = data?.this_week
  const lw = data?.last_week

  return (
    <div
      className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]"
      style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <header
        className="px-4 pb-4 max-w-xl mx-auto border-b border-[var(--border)]"
        style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top, 2.5rem))" }}
      >
        <h1 className="text-lg font-bold">Stats</h1>
        <p className="text-xs font-mono text-[var(--text-muted)]">This week vs last week</p>
      </header>

      <main className="px-4 max-w-xl mx-auto pt-4">
        {!data ? (
          <p className="text-sm font-mono text-[var(--text-muted)] text-center py-8">Loading stats…</p>
        ) : (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest">This week</p>
                <p className="text-[10px] font-mono text-[var(--text-muted)]">
                  {tw?.from} → {tw?.to}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest">Last week</p>
                <p className="text-[10px] font-mono text-[var(--text-muted)]">
                  {lw?.from} → {lw?.to}
                </p>
              </div>
            </div>

            <Stat label="📅 Days logged"   thisVal={tw?.days_logged ?? null}  lastVal={lw?.days_logged ?? null} />
            <Stat label="🚬 Avg nicotine"  thisVal={tw?.avg_nicotine ?? null} lastVal={lw?.avg_nicotine ?? null} />
            <Stat label="☕ Avg caffeine"  thisVal={tw?.avg_caffeine ?? null} lastVal={lw?.avg_caffeine ?? null} unit=" cups" />
            <Stat label="🍽 Avg calories"  thisVal={tw?.avg_calories ?? null} lastVal={lw?.avg_calories ?? null} unit=" kcal" />
            <Stat label="🥩 Avg protein"   thisVal={tw?.avg_protein ?? null}  lastVal={lw?.avg_protein ?? null}  unit="g" />
            <Stat label="💧 Avg water"     thisVal={tw?.avg_water != null ? Math.round((tw.avg_water) / 100) * 100 : null}
                                            lastVal={lw?.avg_water != null ? Math.round((lw.avg_water) / 100) * 100 : null}  unit="ml" />
            <Stat label="🏃 Training days" thisVal={tw?.training_count ?? null} lastVal={lw?.training_count ?? null} />
          </div>
        )}

        {data && tw && tw.days_logged === 0 && (
          <p className="text-xs font-mono text-[var(--text-muted)] text-center mt-4">
            No data yet — start logging to see your stats here.
          </p>
        )}
      </main>

      <NavBar />
    </div>
  )
}
