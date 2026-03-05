// SERVER + CLIENT safe — pure function, no DB calls.
// Aggregates an array of Event rows (all for a single logical date) into
// a DayAggregate that matches the shape of daily_logs exactly.
// This is the canonical read path for "what happened today."

import type { Event } from "@/types/database"

export interface DayAggregate {
  nicotine_count: number
  caffeine_cups: number
  water_ml: number
  calories: number | null
  protein_g: number | null
  wake_time: string | null
  sleep_time: string | null
  phone_free_min: number | null
  training_type: "none" | "swim" | "gym" | "home"
  resting_hr: number | null
  weight_kg: number | null
  vitamins_adam: boolean
  magnesium: boolean
  l_theanine: boolean
  alcohol_yes: boolean
}

/**
 * Aggregation rules per field:
 *
 * COUNT  — nicotine_count, caffeine_cups
 * SUM    — water_ml (each event carries a partial value, e.g. 250ml per glass)
 * ANY    — vitamins_adam, magnesium, l_theanine, alcohol_yes (true if any event has value_bool=true)
 * LATEST — calories, protein_g, weight_kg, resting_hr, phone_free_min (.value of newest event)
 * LATEST_TEXT — wake_time, sleep_time, training_type (.value_text of newest event)
 *
 * Events are assumed to already be filtered to a single logical_date.
 * Ordering within a date uses ts_effective ascending so the "latest" pick
 * is the last element after sorting.
 */
export function aggregateDay(events: Event[]): DayAggregate {
  // Sort ascending by ts_effective so we can take the last element as "latest"
  const sorted = [...events].sort((a, b) =>
    a.ts_effective < b.ts_effective ? -1 : a.ts_effective > b.ts_effective ? 1 : 0
  )

  const latest = (type: string): Event | undefined =>
    [...sorted].reverse().find((e) => e.type === type)

  const aggregate: DayAggregate = {
    // COUNT
    nicotine_count: sorted.filter((e) => e.type === "nicotine").length,
    caffeine_cups: sorted.filter((e) => e.type === "coffee_cup").length,

    // SUM
    water_ml: sorted
      .filter((e) => e.type === "water_ml")
      .reduce((sum, e) => sum + (e.value ?? 0), 0),

    // ANY
    vitamins_adam: sorted.some((e) => e.type === "vitamins_adam" && e.value_bool === true),
    magnesium: sorted.some((e) => e.type === "magnesium" && e.value_bool === true),
    l_theanine: sorted.some((e) => e.type === "l_theanine" && e.value_bool === true),
    alcohol_yes: sorted.some((e) => e.type === "alcohol_yes" && e.value_bool === true),

    // LATEST numeric
    calories: latest("calories_kcal")?.value ?? null,
    protein_g: latest("protein_g")?.value ?? null,
    weight_kg: latest("weight_kg")?.value ?? null,
    resting_hr: latest("resting_hr_manual")?.value ?? null,
    phone_free_min: latest("phone_free_min") != null
      ? (latest("phone_free_min")!.value ?? null)
      : null,

    // LATEST text
    wake_time: latest("wake_time")?.value_text ?? null,
    sleep_time: latest("sleep_time")?.value_text ?? null,
    training_type: (latest("training_session")?.value_text as DayAggregate["training_type"]) ?? "none",
  }

  return aggregate
}
