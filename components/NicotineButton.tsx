"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import type { NicotineType } from "@/types/database"
import { apiHeaders } from "@/hooks/useAuth"

const NICOTINE_TYPES: { type: NicotineType; label: string; emoji: string }[] = [
  { type: "cig",   label: "Сигарета", emoji: "🚬" },
  { type: "vape",  label: "Вейп",     emoji: "💨" },
  { type: "pouch", label: "Снюс",     emoji: "🫧" },
  { type: "other", label: "Другое",   emoji: "❓" },
]

const HOLD_DURATION = 400 // ms

interface Props {
  telegramUserId: number | null
  count: number
  onLogged: () => void
}

export default function NicotineButton({ telegramUserId, count, onLogged }: Props) {
  const [defaultType, setDefaultType] = useState<NicotineType>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("nicotine_type") as NicotineType) ?? "cig"
    }
    return "cig"
  })

  const [showPicker, setShowPicker] = useState(false)
  const [holding, setHolding] = useState(false)
  const [logging, setLogging] = useState(false)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didHoldRef = useRef(false)

  const currentConfig = NICOTINE_TYPES.find((t) => t.type === defaultType) ?? NICOTINE_TYPES[0]

  const logNicotine = useCallback(
    async (type: NicotineType) => {
      if (!telegramUserId) return
      setLogging(true)
      try {
        await fetch("/api/events", {
          method: "POST",
          headers: apiHeaders(telegramUserId),
          body: JSON.stringify({ type: "nicotine", value: 1, value_text: type }),
        })
        onLogged()
      } finally {
        setLogging(false)
      }
    },
    [telegramUserId, onLogged]
  )

  const persistType = useCallback(
    async (type: NicotineType) => {
      localStorage.setItem("nicotine_type", type)
      setDefaultType(type)
      if (telegramUserId) {
        await fetch("/api/preferences", {
          method: "PATCH",
          headers: apiHeaders(telegramUserId),
          body: JSON.stringify({ nicotine_default_type: type }),
        }).catch(() => {})
      }
    },
    [telegramUserId]
  )

  // ── Pointer hold logic ─────────────────────────────────────

  const handlePointerDown = useCallback(() => {
    didHoldRef.current = false
    setHolding(true)
    holdTimerRef.current = setTimeout(() => {
      didHoldRef.current = true
      setHolding(false)
      setShowPicker(true)
    }, HOLD_DURATION)
  }, [])

  const handlePointerUp = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    setHolding(false)
    if (!didHoldRef.current) {
      // Short tap — log with default type
      logNicotine(defaultType)
    }
  }, [defaultType, logNicotine])

  const handlePointerCancel = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    setHolding(false)
  }, [])

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    }
  }, [])

  const handlePickerSelect = async (type: NicotineType) => {
    setShowPicker(false)
    await persistType(type)
    await logNicotine(type)
  }

  return (
    <>
      {/* Main nicotine button */}
      <div className="relative select-none">
        <button
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerCancel}
          disabled={logging}
          className={[
            "w-full py-5 rounded-xl font-bold text-xl transition-all relative overflow-hidden",
            "bg-[var(--bg-card)] border-2 text-[var(--text)]",
            holding
              ? "border-[#00FF85] scale-[0.97] bg-[#00FF8510]"
              : "border-[var(--border)] active:scale-95",
            logging ? "opacity-60" : "",
          ].join(" ")}
          style={{ touchAction: "none" }}
        >
          {/* Hold progress ring */}
          {holding && (
            <span
              className="absolute inset-0 bg-[#00FF85] opacity-10 animate-pulse rounded-xl"
              style={{ animationDuration: `${HOLD_DURATION}ms` }}
            />
          )}

          <span className="relative flex flex-col items-center gap-0.5">
            <span className="text-3xl">{currentConfig.emoji}</span>
            <span className="text-sm font-mono text-[var(--text-muted)]">
              {logging ? "…" : `${count}× сегодня`}
            </span>
            <span className="text-xs font-mono text-[var(--text-muted)] opacity-50 mt-0.5">
              удержи для смены типа
            </span>
          </span>
        </button>

        {/* Count badge */}
        {count > 0 && (
          <span className="absolute -top-2 -right-2 bg-[#00FF85] text-black text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
            {count}
          </span>
        )}
      </div>

      {/* Type picker overlay */}
      {showPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowPicker(false)}
        >
          <div
            className="bg-[var(--bg-card)] rounded-t-2xl w-full max-w-lg px-4 pb-8 pt-4 border-t border-[var(--border)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full bg-[var(--border)]" />
            </div>
            <p className="text-xs font-mono text-[var(--text-muted)] text-center mb-4 uppercase tracking-widest">
              Тип никотина
            </p>
            <div className="grid grid-cols-2 gap-3">
              {NICOTINE_TYPES.map(({ type, label, emoji }) => (
                <button
                  key={type}
                  onClick={() => handlePickerSelect(type)}
                  className={[
                    "flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all",
                    defaultType === type
                      ? "border-[#00FF85] bg-[#00FF8510]"
                      : "border-[var(--border)] bg-[var(--bg-input)]",
                  ].join(" ")}
                >
                  <span className="text-3xl">{emoji}</span>
                  <span className="text-sm font-semibold text-[var(--text)]">{label}</span>
                  {defaultType === type && (
                    <span className="text-xs font-mono text-[#00FF85]">по умолчанию</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
