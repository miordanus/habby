"use client"

import { useState, useEffect, useCallback } from "react"
import { useAuth, apiHeaders } from "@/hooks/useAuth"
import NavBar from "@/components/NavBar"

interface GoalItemForm {
  metric_key: string
  operator: string
  target_number: number | null
  target_bool: boolean | null
  tolerance_number: number | null
  xp_reward: number
}

interface GoalData {
  id: string
  effective_from: string
  items: GoalItemForm[]
}

const METRIC_META: Record<string, { label: string; unit?: string; type: "number" | "bool" }> = {
  nicotine_count: { label: "🚬 Max nicotine/day",    unit: "sticks",  type: "number" },
  caffeine_cups:  { label: "☕ Max caffeine/day",     unit: "cups",    type: "number" },
  water_ml:       { label: "💧 Min water/day",        unit: "ml",      type: "number" },
  protein_g:      { label: "🥩 Min protein/day",      unit: "g",       type: "number" },
  calories:       { label: "🍽 Calories target",       unit: "kcal ±10%", type: "number" },
  alcohol_yes:    { label: "🍺 Alcohol-free",          type: "bool"    },
  vitamins_adam:  { label: "💊 Adam vitamins daily",   type: "bool"    },
  magnesium:      { label: "🧲 Magnesium daily",       type: "bool"    },
  l_theanine:     { label: "🍵 L-Theanine (if caffeine)", type: "bool" },
}

const INPUT = "bg-[var(--bg-input)] border border-[var(--input-border)] px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-[#00FF85] transition-colors font-mono w-28 text-right"

export default function GoalsPage() {
  const { state, telegramUserId } = useAuth()
  const [mounted, setMounted] = useState(false)
  const [current, setCurrent] = useState<GoalData | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const tomorrow = new Date(new Date(today + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10)

  const [effectiveFrom, setEffectiveFrom] = useState(tomorrow)
  const [draftItems, setDraftItems] = useState<GoalItemForm[]>([])

  useEffect(() => { setMounted(true) }, [])

  const load = useCallback(async () => {
    if (!telegramUserId) return
    const res = await fetch(`/api/goals`, {
      headers: { "x-telegram-user-id": String(telegramUserId) },
    })
    if (res.ok) {
      const data: GoalData | null = await res.json()
      setCurrent(data)
    }
  }, [telegramUserId])

  useEffect(() => {
    if (state === "authed") load()
  }, [state, load])

  function startEditing() {
    if (!current) return
    setDraftItems(current.items.map((i) => ({ ...i })))
    setEffectiveFrom(tomorrow)
    setEditing(true)
  }

  function updateItem(key: string, field: "target_number" | "target_bool", val: number | boolean | null) {
    setDraftItems((prev) =>
      prev.map((item) =>
        item.metric_key === key ? { ...item, [field]: val } : item
      )
    )
  }

  async function handleSave() {
    if (!telegramUserId || saving) return
    if (effectiveFrom <= today) {
      setToast("Effective date must be tomorrow or later")
      setTimeout(() => setToast(null), 3000)
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: apiHeaders(telegramUserId),
        body: JSON.stringify({ effective_from: effectiveFrom, items: draftItems }),
      })
      if (res.ok) {
        setToast("Goals saved! Active from " + effectiveFrom)
        setEditing(false)
        load()
        setTimeout(() => setToast(null), 3000)
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

  function renderItem(item: GoalItemForm, readOnly: boolean) {
    const meta = METRIC_META[item.metric_key]
    if (!meta) return null

    return (
      <div key={item.metric_key} className="flex items-center justify-between gap-3 py-2.5 border-b border-[var(--border)] last:border-0">
        <div className="min-w-0">
          <p className="text-sm font-mono text-[var(--text)]">{meta.label}</p>
          {meta.unit && <p className="text-[10px] font-mono text-[var(--text-muted)]">{meta.unit}</p>}
        </div>
        {meta.type === "number" ? (
          readOnly ? (
            <span className="text-sm font-bold font-mono text-[#00FF85]">
              {item.operator} {item.target_number}
            </span>
          ) : (
            <input
              type="number"
              value={item.target_number ?? ""}
              onChange={(e) => updateItem(item.metric_key, "target_number", e.target.value === "" ? null : Number(e.target.value))}
              className={INPUT}
            />
          )
        ) : (
          readOnly ? (
            <span className={`text-sm font-mono font-bold ${item.target_bool ? "text-[#00FF85]" : "text-[var(--text-muted)]"}`}>
              {item.target_bool ? "Yes" : "No"}
            </span>
          ) : (
            <button
              onClick={() => updateItem(item.metric_key, "target_bool", !item.target_bool)}
              className={`px-4 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                item.target_bool
                  ? "border-[#00FF85] text-[#00FF85] bg-[rgba(0,255,133,0.08)]"
                  : "border-[var(--border)] text-[var(--text-muted)]"
              }`}
            >
              {item.target_bool ? "Required" : "Optional"}
            </button>
          )
        )}
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
        <h1 className="text-lg font-bold">Goals</h1>
        <p className="text-xs font-mono text-[var(--text-muted)]">Current contract + next version</p>
      </header>

      <main className="px-4 max-w-xl mx-auto pt-4 space-y-4">
        {/* Current goal */}
        {current && (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest">
                Current Contract
              </p>
              <span className="text-xs font-mono text-[var(--text-muted)]">
                from {current.effective_from}
              </span>
            </div>
            {current.items.map((item) => renderItem(item, true))}
          </div>
        )}

        {/* Edit next goals */}
        {!editing ? (
          <button
            onClick={startEditing}
            disabled={!current}
            className="w-full py-3 border border-[var(--border)] rounded-xl text-sm font-mono text-[var(--text-muted)] hover:border-[#444] transition-colors disabled:opacity-40"
          >
            ✏️ Edit Next Goals
          </button>
        ) : (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
            <p className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest mb-3">
              Next Contract
            </p>
            <div className="mb-4">
              <label className="text-xs font-mono text-[var(--text-muted)] block mb-1 uppercase tracking-widest">
                Effective from (tomorrow minimum)
              </label>
              <input
                type="date"
                value={effectiveFrom}
                min={tomorrow}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="bg-[var(--bg-input)] border border-[var(--input-border)] px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-[#00FF85] transition-colors font-mono"
              />
            </div>
            {draftItems.map((item) => renderItem(item, false))}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 py-3 border border-[var(--border)] rounded-xl text-sm font-mono text-[var(--text-muted)]"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-3 bg-[#00FF85] text-black font-bold text-sm rounded-xl disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Goals"}
              </button>
            </div>
          </div>
        )}
      </main>

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-[#00FF85] text-black font-bold text-sm px-5 py-3 rounded-xl z-50 pointer-events-none text-center max-w-xs">
          {toast}
        </div>
      )}

      <NavBar />
    </div>
  )
}
