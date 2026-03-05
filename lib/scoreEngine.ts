// SERVER ONLY — Daily score computation from events.
import type { Event, HealthSample, Quest, ScoreReason } from "@/types/database"

export interface DayScoreResult {
  day_score: number
  recovery_score: number
  focus_score: number
  stress_score: number
  discipline_score: number
  score_reasons: ScoreReason[]
}

// Component weights (must sum to 100)
const WEIGHTS = { recovery: 30, focus: 25, stress: 25, discipline: 20 }

/**
 * Compute the day score from events, quests, and health samples.
 * All scores are 0-100.
 */
export function computeDayScore(
  events: Event[],
  quests: Quest[],
  healthSamples: HealthSample[]
): DayScoreResult {
  const reasons: ScoreReason[] = []

  // ── Recovery (30 pts) ──────────────────────────────────────
  let recovery = 50 // baseline

  const sleepDuration = healthSamples.find((s) => s.type === "sleep_duration")?.value
  const hrv = healthSamples.find((s) => s.type === "hrv")?.value

  if (sleepDuration != null) {
    // Ideal: 7-9h (25200-32400 seconds). 8h = full score.
    const hours = sleepDuration / 3600
    if (hours >= 7 && hours <= 9) {
      const delta = 25
      recovery += delta
      reasons.push({ component: "recovery", reason: `Сон ${hours.toFixed(1)}ч — в норме`, delta })
    } else if (hours < 5) {
      const delta = -30
      recovery += delta
      reasons.push({ component: "recovery", reason: `Сон ${hours.toFixed(1)}ч — критически мало`, delta })
    } else if (hours < 7) {
      const delta = -10
      recovery += delta
      reasons.push({ component: "recovery", reason: `Сон ${hours.toFixed(1)}ч — маловато`, delta })
    } else {
      const delta = 10
      recovery += delta
      reasons.push({ component: "recovery", reason: `Сон ${hours.toFixed(1)}ч — чуть много`, delta })
    }
  } else {
    reasons.push({ component: "recovery", reason: "Данные о сне отсутствуют", delta: 0 })
  }

  if (hrv != null) {
    // HRV: higher is better, typical range 20-100ms
    if (hrv >= 60) {
      const delta = 25
      recovery += delta
      reasons.push({ component: "recovery", reason: `HRV ${hrv}ms — отлично`, delta })
    } else if (hrv >= 40) {
      const delta = 10
      recovery += delta
      reasons.push({ component: "recovery", reason: `HRV ${hrv}ms — норма`, delta })
    } else {
      const delta = -10
      recovery += delta
      reasons.push({ component: "recovery", reason: `HRV ${hrv}ms — низкий`, delta })
    }
  }

  recovery = clamp(recovery, 0, 100)

  // ── Focus (25 pts) ─────────────────────────────────────────
  let focus = 50 // baseline

  const coffeeCount = events.filter((e) => e.type === "coffee_cup").length
  const hasLTheanine = events.some((e) => e.type === "l_theanine" && e.value_bool)

  if (coffeeCount >= 1 && coffeeCount <= 2) {
    const delta = hasLTheanine ? 25 : 15
    focus += delta
    reasons.push({
      component: "focus",
      reason: `${coffeeCount} кофе${hasLTheanine ? " + L-теанин" : ""} — фокус+`,
      delta,
    })
  } else if (coffeeCount > 3) {
    const delta = -15
    focus += delta
    reasons.push({ component: "focus", reason: `${coffeeCount} кофе — перебор, тревожность`, delta })
  }

  const focusRatings = events
    .filter((e) => e.type === "self_rating_focus" && e.value != null)
    .map((e) => e.value as number)
  if (focusRatings.length > 0) {
    const avg = focusRatings.reduce((a, b) => a + b, 0) / focusRatings.length
    const delta = Math.round((avg - 3) * 10) // 1-5 scale: 3 = neutral
    focus += delta
    reasons.push({ component: "focus", reason: `Фокус: ${avg.toFixed(1)}/5 (само-оценка)`, delta })
  }

  focus = clamp(focus, 0, 100)

  // ── Stress (25 pts — lower nicotine = better) ─────────────
  let stress = 70 // start optimistic

  const nicotineCount = events.filter((e) => e.type === "nicotine").reduce((sum, e) => sum + (e.value ?? 1), 0)

  if (nicotineCount === 0) {
    const delta = 20
    stress += delta
    reasons.push({ component: "stress", reason: "Никотин 0 — отлично", delta })
  } else if (nicotineCount <= 5) {
    const delta = 10
    stress += delta
    reasons.push({ component: "stress", reason: `Никотин ${nicotineCount} — умеренно`, delta })
  } else if (nicotineCount <= 15) {
    const delta = -10
    stress += delta
    reasons.push({ component: "stress", reason: `Никотин ${nicotineCount} — многовато`, delta })
  } else {
    const delta = -25
    stress += delta
    reasons.push({ component: "stress", reason: `Никотин ${nicotineCount} — критически много`, delta })
  }

  const stressRatings = events
    .filter((e) => e.type === "self_rating_stress" && e.value != null)
    .map((e) => e.value as number)
  if (stressRatings.length > 0) {
    const avg = stressRatings.reduce((a, b) => a + b, 0) / stressRatings.length
    // High stress rating = bad (5 = very stressed)
    const delta = Math.round((3 - avg) * 8)
    stress += delta
    reasons.push({ component: "stress", reason: `Стресс: ${avg.toFixed(1)}/5 (само-оценка)`, delta })
  }

  stress = clamp(stress, 0, 100)

  // ── Discipline (20 pts — quest completion) ─────────────────
  const dailyQuests = quests.filter((q) => q.quest_type === "daily")
  const completedQuests = dailyQuests.filter((q) => q.status === "completed").length
  const totalQuests = dailyQuests.length

  let discipline: number
  if (totalQuests === 0) {
    discipline = 50
    reasons.push({ component: "discipline", reason: "Квесты не назначены", delta: 0 })
  } else {
    const pct = completedQuests / totalQuests
    discipline = Math.round(pct * 100)
    const delta = discipline - 50
    reasons.push({
      component: "discipline",
      reason: `Квесты: ${completedQuests}/${totalQuests} выполнено`,
      delta,
    })
  }

  // ── Weighted day score ─────────────────────────────────────
  const day_score = Math.round(
    (recovery * WEIGHTS.recovery +
      focus * WEIGHTS.focus +
      stress * WEIGHTS.stress +
      discipline * WEIGHTS.discipline) /
      100
  )

  return {
    day_score: clamp(day_score, 0, 100),
    recovery_score: recovery,
    focus_score: focus,
    stress_score: stress,
    discipline_score: discipline,
    score_reasons: reasons,
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}
