"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth, apiHeaders } from "@/hooks/useAuth"
import NavBar from "@/components/NavBar"
import Clicker from "@/components/Clicker"

const TRAINING_OPTIONS = [
  { value: "none", label: "None" },
  { value: "swim", label: "🏊 Swim" },
  { value: "gym",  label: "🏋️ Gym" },
  { value: "home", label: "🏠 Home" },
]

const PHONE_FREE_OPTIONS = [0, 15, 30, 60]

const INPUT = "w-full bg-[var(--bg-input)] border border-[var(--input-border)] px-3 py-3 rounded-lg text-sm focus:outline-none focus:border-[#00FF85] transition-colors font-mono"
const LABEL = "text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest mb-1 block"
const SECTION_HDR = "text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest py-2 border-t border-[var(--border)] mt-3 mb-1"

function CheckInInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { state, telegramUserId } = useAuth()

  const dateParam = searchParams.get("date")
  const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const targetDate = dateParam ?? today
  const isBackfill = targetDate < today

  const [mounted, setMounted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [showSleep, setShowSleep] = useState(false)
  const [showHealth, setShowHealth] = useState(false)

  const [form, setForm] = useState({
    nicotine_count: 0,
    caffeine_cups: 0,
    water_ml: 0,
    calories: 0,
    protein_g: 0,
    wake_time: "",
    sleep_time: "",
    phone_free_min: 0 as 0 | 15 | 30 | 60,
    training_type: "none" as "none" | "swim" | "gym" | "home",
    resting_hr: "" as string,
    weight_kg: "" as string,
    vitamins_adam: false,
    magnesium: false,
    l_theanine: false,
    alcohol_yes: false,
  })

  useEffect(() => { setMounted(true) }, [])

  const load = useCallback(async () => {
    if (!telegramUserId) return
    const res = await fetch(`/api/logs?date=${targetDate}`, {
      headers: { "x-telegram-user-id": String(telegramUserId) },
    })
    if (res.ok) {
      const data = await res.json()
      if (data) {
        setForm({
          nicotine_count: data.nicotine_count ?? 0,
          caffeine_cups: data.caffeine_cups ?? 0,
          water_ml: data.water_ml ?? 0,
          calories: data.calories ?? 0,
          protein_g: data.protein_g ?? 0,
          wake_time: data.wake_time ?? "",
          sleep_time: data.sleep_time ?? "",
          phone_free_min: data.phone_free_min ?? 0,
          training_type: data.training_type ?? "none",
          resting_hr: data.resting_hr != null ? String(data.resting_hr) : "",
          weight_kg: data.weight_kg != null ? String(data.weight_kg) : "",
          vitamins_adam: data.vitamins_adam ?? false,
          magnesium: data.magnesium ?? false,
          l_theanine: data.l_theanine ?? false,
          alcohol_yes: data.alcohol_yes ?? false,
        })
        if (data.wake_time || data.sleep_time) setShowSleep(true)
        if (data.resting_hr || data.weight_kg) setShowHealth(true)
      }
    }
  }, [telegramUserId, targetDate])

  useEffect(() => {
    if (state === "authed") load()
  }, [state, load])

  function set<K extends keyof typeof form>(key: K, val: typeof form[K]) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  async function handleSave() {
    if (!telegramUserId || saving) return
    setSaving(true)
    try {
      const payload = {
        ...form,
        date: targetDate,
        resting_hr: form.resting_hr !== "" ? Number(form.resting_hr) : null,
        weight_kg: form.weight_kg !== "" ? Number(form.weight_kg) : null,
        wake_time: form.wake_time || null,
        sleep_time: form.sleep_time || null,
      }
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: apiHeaders(telegramUserId),
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const { xpEarned } = await res.json()
        const msg = xpEarned > 0 ? `Saved! +${xpEarned} XP` : "Saved!"
        setToast(msg)
        setTimeout(() => router.push("/"), 1500)
      }
    } finally {
      setSaving(false)
    }
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
      style={{ paddingBottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <header
        className="px-4 pb-4 max-w-xl mx-auto border-b border-[var(--border)]"
        style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top, 2.5rem))" }}
      >
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-[var(--text-muted)] text-lg">←</button>
          <div>
            <h1 className="text-lg font-bold">
              {isBackfill ? "Backfill" : "Check-in"}
            </h1>
            <p className="text-xs font-mono text-[var(--text-muted)]">{targetDate}</p>
          </div>
          {isBackfill && (
            <span className="ml-auto text-xs font-mono bg-[var(--bg-card)] border border-[var(--border)] px-2 py-0.5 rounded">
              +15 XP
            </span>
          )}
        </div>
      </header>

      <main className="px-4 max-w-xl mx-auto pt-4 space-y-4">
        {/* Core clickers */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-1">
          <Clicker label="🚬" value={form.nicotine_count} increments={[1, 5]}
            onAdd={(n) => set("nicotine_count", form.nicotine_count + n)}
            onSub={() => set("nicotine_count", Math.max(0, form.nicotine_count - 1))} />
          <div className="border-t border-[var(--border)]" />
          <Clicker label="☕" value={form.caffeine_cups} increments={[1]}
            onAdd={(n) => set("caffeine_cups", form.caffeine_cups + n)}
            onSub={() => set("caffeine_cups", Math.max(0, form.caffeine_cups - 1))} />
          <div className="border-t border-[var(--border)]" />
          <Clicker label="💧" value={form.water_ml} unit="ml" increments={[250, 500]}
            onAdd={(n) => set("water_ml", form.water_ml + n)}
            onSub={() => set("water_ml", Math.max(0, form.water_ml - 250))} />
          <div className="border-t border-[var(--border)]" />
          <Clicker label="🍽" value={form.calories} unit="kcal" increments={[200, 500]}
            onAdd={(n) => set("calories", form.calories + n)}
            onSub={() => set("calories", Math.max(0, form.calories - 200))} />
          <div className="border-t border-[var(--border)]" />
          <Clicker label="🥩" value={form.protein_g} unit="g" increments={[25, 50]}
            onAdd={(n) => set("protein_g", form.protein_g + n)}
            onSub={() => set("protein_g", Math.max(0, form.protein_g - 25))} />
        </div>

        {/* Phone-free */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
          <p className={LABEL}>📵 Phone-free morning (min)</p>
          <div className="flex gap-2">
            {PHONE_FREE_OPTIONS.map((v) => (
              <button
                key={v}
                onClick={() => set("phone_free_min", v as 0 | 15 | 30 | 60)}
                className={`flex-1 py-2 rounded-lg text-sm font-mono border transition-colors ${
                  form.phone_free_min === v
                    ? "border-[#00FF85] text-[#00FF85] bg-[rgba(0,255,133,0.08)]"
                    : "border-[var(--border)] text-[var(--text-muted)]"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Training */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
          <p className={LABEL}>🏃 Training</p>
          <div className="flex gap-2 flex-wrap">
            {TRAINING_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => set("training_type", value as typeof form.training_type)}
                className={`px-3 py-2 rounded-lg text-sm font-mono border transition-colors ${
                  form.training_type === value
                    ? "border-[#00FF85] text-[#00FF85] bg-[rgba(0,255,133,0.08)]"
                    : "border-[var(--border)] text-[var(--text-muted)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Vitamins + Alcohol */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 space-y-3">
          <p className={LABEL.replace("mb-1", "")}>Supplements & Alcohol</p>
          {([
            ["vitamins_adam", "💊 Adam vitamins"],
            ["magnesium",    "🧲 Magnesium"],
            ["l_theanine",   "🍵 L-Theanine"],
          ] as [keyof typeof form, string][]).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between cursor-pointer">
              <span className="text-sm font-mono text-[var(--text)]">{label}</span>
              <button
                onClick={() => set(key, !form[key] as typeof form[typeof key])}
                className={`w-12 h-6 rounded-full border transition-all ${
                  form[key]
                    ? "bg-[#00FF85] border-[#00FF85]"
                    : "bg-[var(--bg-input)] border-[var(--border)]"
                }`}
              >
                <span className={`block w-5 h-5 rounded-full bg-white shadow transition-all mx-auto ${form[key] ? "translate-x-3" : "-translate-x-3"}`} />
              </button>
            </label>
          ))}
          <div className="border-t border-[var(--border)] pt-3">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm font-mono text-[var(--text)]">🍺 Alcohol today</span>
              <button
                onClick={() => set("alcohol_yes", !form.alcohol_yes)}
                className={`w-12 h-6 rounded-full border transition-all ${
                  form.alcohol_yes
                    ? "bg-[rgba(255,200,0,0.7)] border-yellow-400"
                    : "bg-[var(--bg-input)] border-[var(--border)]"
                }`}
              >
                <span className={`block w-5 h-5 rounded-full bg-white shadow transition-all mx-auto ${form.alcohol_yes ? "translate-x-3" : "-translate-x-3"}`} />
              </button>
            </label>
            {form.alcohol_yes && (
              <p className="text-xs font-mono text-[var(--text-muted)] mt-1">
                No penalty — just noted for your stats.
              </p>
            )}
          </div>
        </div>

        {/* Sleep section (collapsible) */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
          <button
            onClick={() => setShowSleep(!showSleep)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-mono text-[var(--text-muted)]"
          >
            <span>😴 Sleep times</span>
            <span>{showSleep ? "▲" : "▼"}</span>
          </button>
          {showSleep && (
            <div className="px-4 pb-4 space-y-3 border-t border-[var(--border)]">
              <div className="pt-3">
                <label className={LABEL}>Wake time</label>
                <input type="time" value={form.wake_time} onChange={(e) => set("wake_time", e.target.value)}
                  className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Sleep time (prev night)</label>
                <input type="time" value={form.sleep_time} onChange={(e) => set("sleep_time", e.target.value)}
                  className={INPUT} />
              </div>
            </div>
          )}
        </div>

        {/* Health metrics (collapsible) */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
          <button
            onClick={() => setShowHealth(!showHealth)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-mono text-[var(--text-muted)]"
          >
            <span>❤️ Health metrics</span>
            <span>{showHealth ? "▲" : "▼"}</span>
          </button>
          {showHealth && (
            <div className="px-4 pb-4 space-y-3 border-t border-[var(--border)]">
              <div className="pt-3">
                <label className={LABEL}>Resting HR (bpm)</label>
                <input type="number" value={form.resting_hr} onChange={(e) => set("resting_hr", e.target.value)}
                  placeholder="60" className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>Weight (kg)</label>
                <input type="number" value={form.weight_kg} onChange={(e) => set("weight_kg", e.target.value)}
                  placeholder="75.0" step="0.1" className={INPUT} />
              </div>
            </div>
          )}
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-4 bg-[#00FF85] text-black font-bold text-sm uppercase tracking-wider rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
        >
          {saving ? "Saving…" : isBackfill ? "Save Backfill" : "Save Check-in"}
        </button>
      </main>

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-[#00FF85] text-black font-bold text-sm px-5 py-3 rounded-xl z-50 pointer-events-none">
          {toast}
        </div>
      )}

      <NavBar />
    </div>
  )
}

export default function CheckInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center">
        <p className="text-sm font-mono text-[var(--text-muted)]">Loading…</p>
      </div>
    }>
      <CheckInInner />
    </Suspense>
  )
}
