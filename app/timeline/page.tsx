"use client"

import { useState, useEffect, useCallback } from "react"
import { useAuth, apiHeaders } from "@/hooks/useAuth"
import NavBar from "@/components/NavBar"
import type { Event, EventType } from "@/types/database"

const EVENT_EMOJI: Record<EventType, string> = {
  nicotine:             "🚬",
  coffee_cup:           "☕",
  water_ml:             "💧",
  vitamins_adam:        "💊",
  magnesium:            "🧲",
  l_theanine:           "🍵",
  workout:              "🏋️",
  alcohol_yes:          "🍺",
  self_rating_energy:   "⚡",
  self_rating_focus:    "🎯",
  self_rating_stress:   "😰",
  calories_kcal:        "🍽️",
  protein_g:            "🥩",
  training_session:     "🏃",
  phone_free_min:       "📵",
  weight_kg:            "⚖️",
  resting_hr_manual:    "❤️",
  wake_time:            "🌅",
  sleep_time:           "🌙",
}

const EVENT_LABELS: Record<EventType, string> = {
  nicotine:             "Никотин",
  coffee_cup:           "Кофе",
  water_ml:             "Вода",
  vitamins_adam:        "Витамины",
  magnesium:            "Магний",
  l_theanine:           "L-теанин",
  workout:              "Тренировка",
  alcohol_yes:          "Алкоголь",
  self_rating_energy:   "Энергия",
  self_rating_focus:    "Фокус",
  self_rating_stress:   "Стресс",
  calories_kcal:        "Калории",
  protein_g:            "Белок",
  training_session:     "Тренировка",
  phone_free_min:       "Без телефона",
  weight_kg:            "Вес",
  resting_hr_manual:    "Пульс покоя",
  wake_time:            "Подъём",
  sleep_time:           "Отбой",
}

const RATING_TYPES: EventType[] = ["self_rating_energy", "self_rating_focus", "self_rating_stress"]
const RATING_EMOJIS = ["", "😴", "😐", "🙂", "😄", "⚡"]

function formatEventValue(event: Event): string {
  if (event.type === "nicotine") return event.value_text ?? "cig"
  if (event.type === "water_ml") return `${event.value ?? 0}мл`
  if (RATING_TYPES.includes(event.type)) return `${event.value}/5 ${RATING_EMOJIS[event.value ?? 0] ?? ""}`
  if (event.value_bool != null) return event.value_bool ? "✓" : "✗"
  if (event.value != null) return String(event.value)
  return ""
}

function groupByHour(events: Event[]): Map<number, Event[]> {
  const groups = new Map<number, Event[]>()
  for (const e of events) {
    const hour = new Date(e.ts_effective).getUTCHours()
    if (!groups.has(hour)) groups.set(hour, [])
    groups.get(hour)!.push(e)
  }
  return new Map([...groups.entries()].sort((a, b) => b[0] - a[0]))
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:xx`
}

function formatTime(ts: string): string {
  const d = new Date(ts)
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}

interface RatingData {
  energy: { hour: number; value: number }[]
  focus:  { hour: number; value: number }[]
  stress: { hour: number; value: number }[]
}

export default function TimelinePage() {
  const { state, telegramUserId } = useAuth()
  const [mounted, setMounted] = useState(false)
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTime, setEditTime] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const load = useCallback(async () => {
    if (!telegramUserId) return
    setLoading(true)
    const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
    try {
      const res = await fetch(`/api/events?date=${today}`, {
        headers: { "x-telegram-user-id": String(telegramUserId) },
      })
      if (res.ok) setEvents(await res.json())
    } finally {
      setLoading(false)
    }
  }, [telegramUserId])

  useEffect(() => {
    if (state === "authed") load()
  }, [state, load])

  const handleEditSave = async (event: Event) => {
    if (!telegramUserId || !editTime) return
    setSaving(true)
    try {
      // Build new ts_effective: use the event's logical date + the new time
      const logicalDate = new Date(new Date(event.ts_effective).getTime() - 5 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
      const newTs = `${logicalDate}T${editTime}:00Z`

      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-user-id": String(telegramUserId),
        },
        body: JSON.stringify({ ts_effective: newTs }),
      })

      if (res.ok) {
        setEditingId(null)
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  // Build mini rating charts
  const ratingData: RatingData = { energy: [], focus: [], stress: [] }
  for (const e of events) {
    if (e.type === "self_rating_energy" && e.value != null) {
      ratingData.energy.push({ hour: new Date(e.ts_effective).getUTCHours(), value: e.value })
    } else if (e.type === "self_rating_focus" && e.value != null) {
      ratingData.focus.push({ hour: new Date(e.ts_effective).getUTCHours(), value: e.value })
    } else if (e.type === "self_rating_stress" && e.value != null) {
      ratingData.stress.push({ hour: new Date(e.ts_effective).getUTCHours(), value: e.value })
    }
  }

  const grouped = groupByHour(events)

  if (!mounted || state === "checking") {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center">
        <p className="text-sm font-mono text-[var(--text-muted)]">Loading…</p>
      </div>
    )
  }

  const today = new Date(Date.now() - 5 * 60 * 60 * 1000)
  const dateLabel = today.toLocaleDateString("ru-RU", { weekday: "long", month: "short", day: "numeric" })

  return (
    <div
      className="min-h-screen bg-[var(--bg-page)] text-[var(--text)]"
      style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <header
        className="px-4 pb-3 max-w-xl mx-auto"
        style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top, 2.5rem))" }}
      >
        <h1 className="text-2xl font-bold tracking-tight">Таймлайн</h1>
        <p className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest">{dateLabel}</p>
      </header>

      <main className="px-4 max-w-xl mx-auto space-y-4">

        {/* Mini rating bar charts */}
        {(ratingData.energy.length > 0 || ratingData.focus.length > 0 || ratingData.stress.length > 0) && (
          <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-3">
            <p className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest mb-3">Состояние</p>
            {(["energy", "focus", "stress"] as const).map((key) => {
              const data = ratingData[key]
              if (data.length === 0) return null
              const label = key === "energy" ? "⚡ Энергия" : key === "focus" ? "🎯 Фокус" : "😰 Стресс"
              return (
                <div key={key} className="mb-3 last:mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-[var(--text-muted)]">{label}</span>
                  </div>
                  <div className="flex items-end gap-1 h-10">
                    {data.map((d, i) => (
                      <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                        <div
                          className="w-full rounded-sm bg-[#00FF85] transition-all"
                          style={{ height: `${(d.value / 5) * 100}%`, opacity: 0.6 + d.value * 0.08 }}
                        />
                        <span className="text-[9px] font-mono text-[var(--text-muted)]">{d.hour}h</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </section>
        )}

        {/* Event list grouped by hour */}
        {loading ? (
          <p className="text-sm font-mono text-[var(--text-muted)] text-center py-8">Загрузка…</p>
        ) : events.length === 0 ? (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-8 text-center">
            <p className="text-sm font-mono text-[var(--text-muted)]">Нет событий за сегодня</p>
            <p className="text-xs font-mono text-[var(--text-muted)] mt-1 opacity-60">Вернись на главную и залогируй</p>
          </div>
        ) : (
          <section className="space-y-3">
            {[...grouped.entries()].map(([hour, hourEvents]) => (
              <div key={hour}>
                <p className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest mb-1.5 px-1">
                  {formatHour(hour)}
                </p>
                <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden divide-y divide-[var(--border)]">
                  {hourEvents.map((e) => (
                    <div key={e.id} className="flex items-center px-4 py-2.5 gap-3">
                      <span className="text-xl">{EVENT_EMOJI[e.type as EventType] ?? "•"}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-[var(--text)]">
                          {EVENT_LABELS[e.type as EventType] ?? e.type}
                        </span>
                        <span className="text-xs font-mono text-[var(--text-muted)] ml-2">
                          {formatEventValue(e)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-[var(--text-muted)]">
                          {formatTime(e.ts_effective)}
                        </span>
                        {editingId === e.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="time"
                              value={editTime}
                              onChange={(ev) => setEditTime(ev.target.value)}
                              className="text-xs font-mono bg-[var(--bg-input)] border border-[var(--border)] rounded px-1 py-0.5 text-[var(--text)] w-20"
                            />
                            <button
                              onClick={() => handleEditSave(e)}
                              disabled={saving}
                              className="text-xs font-mono text-[#00FF85] disabled:opacity-50"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-xs font-mono text-[var(--text-muted)]"
                            >
                              ✗
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingId(e.id)
                              setEditTime(formatTime(e.ts_effective))
                            }}
                            className="text-xs font-mono text-[var(--text-muted)] opacity-50 hover:opacity-100"
                          >
                            ✏️
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </main>

      <NavBar />
    </div>
  )
}
