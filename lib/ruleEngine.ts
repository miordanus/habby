// Pure rule engine — no I/O, no DB calls, no AI.
// Input: today's events + UTC hour + yesterday's events.
// Output: prioritised list of triggered rules with observations and buttons.
import type { Event } from "@/types/database"

export interface CallbackButton {
  text: string
  callback_data?: string   // "log_water:500" → parsed by webhook handler
  web_app?: { url: string }
}

export interface RuleResult {
  trigger_type: string
  priority: number         // lower = higher priority; winner is lowest
  cooldown_hours: number
  observations: string[]   // bullet lines in Russian, already formatted
  question: string
  buttons: CallbackButton[]
}

// ── Helpers ────────────────────────────────────────────────────

function countType(events: Event[], type: string): number {
  return events.filter((e) => e.type === type).length
}

function sumType(events: Event[], type: string): number {
  return events.filter((e) => e.type === type).reduce((s, e) => s + (e.value ?? 0), 0)
}

function hasType(events: Event[], type: string): boolean {
  return events.some((e) => e.type === type)
}

function minutesSinceLastEvent(events: Event[]): number {
  if (events.length === 0) return 9999
  const latest = events.reduce((max, e) => {
    const t = new Date(e.ts_effective).getTime()
    return t > max ? t : max
  }, 0)
  return Math.floor((Date.now() - latest) / 60_000)
}

// ── Rules ──────────────────────────────────────────────────────

function ruleNicotineRate(events: Event[], utcHour: number): RuleResult | null {
  const nicCount = countType(events, "nicotine")
  if (nicCount === 0) return null

  // Elapsed day fraction since 05:00 UTC (logical day start)
  const startHour = 5
  const elapsedHours = Math.max(0, utcHour - startHour)
  if (elapsedHours < 1) return null  // too early to judge pace

  const dayFraction = elapsedHours / 16  // 16 active hours in a day
  const pacedLimit = Math.ceil(20 * dayFraction)  // expected max at this time

  if (nicCount <= pacedLimit) return null

  const obs = [`🚬 Никотин: ${nicCount} шт — темп превышает дневную норму (20)`]
  if (hasType(events, "coffee_cup")) {
    obs.push(`☕ Кофе: ${countType(events, "coffee_cup")} чашки — усиливает тягу`)
  }

  return {
    trigger_type: "nicotine_rate",
    priority: 1,
    cooldown_hours: 1,
    observations: obs,
    question: "Как дела с никотином?",
    buttons: [
      { text: "📝 Открыть", web_app: undefined },  // placeholder, filled in cron
      { text: "✅ Держусь", callback_data: "all_good:0" },
    ],
  }
}

function ruleWaterCritical(events: Event[], utcHour: number): RuleResult | null {
  const water = sumType(events, "water_ml")

  // Time-scaled targets: 500 after 13 UTC, 1000 after 17, 1500 after 19
  let target: number
  if (utcHour >= 19) target = 1500
  else if (utcHour >= 17) target = 1000
  else if (utcHour >= 13) target = 500
  else return null  // too early to alert

  if (water >= target) return null

  const obs = [`💧 Вода: ${water} мл — нужно минимум ${target} мл к этому времени`]
  const coffeeCount = countType(events, "coffee_cup")
  if (coffeeCount >= 2) obs.push(`☕ ${coffeeCount} кофе без воды — риск обезвоживания`)

  return {
    trigger_type: "water_critical",
    priority: 2,
    cooldown_hours: 2,
    observations: obs,
    question: "Выпьешь воды прямо сейчас?",
    buttons: [
      { text: "💧 250 мл", callback_data: "log_water:250" },
      { text: "💧 500 мл", callback_data: "log_water:500" },
      { text: "✅ Уже пью", callback_data: "all_good:0" },
    ],
  }
}

function ruleNoEvents90min(events: Event[]): RuleResult | null {
  const minutes = minutesSinceLastEvent(events)
  if (minutes < 90) return null

  const obs = [
    `⏱ Последняя запись: ${minutes} мин назад — ты выпал из трекинга`,
  ]

  return {
    trigger_type: "no_events_90min",
    priority: 3,
    cooldown_hours: 1.5,
    observations: obs,
    question: "Что происходит прямо сейчас?",
    buttons: [
      { text: "☕ Кофе", callback_data: "log_coffee:1" },
      { text: "💧 Вода", callback_data: "log_water:250" },
      { text: "🚬 Никотин", callback_data: "log_nicotine:1" },
    ],
  }
}

function ruleEnergyUntracked(events: Event[], utcHour: number): RuleResult | null {
  if (utcHour < 9) return null  // too early
  if (hasType(events, "self_rating_energy")) return null

  const obs = [`⚡ Энергия: не оценена за сегодня`]
  const water = sumType(events, "water_ml")
  if (water < 300) obs.push("💧 Мало воды — может влиять на самочувствие")

  return {
    trigger_type: "energy_untracked",
    priority: 4,
    cooldown_hours: 3,
    observations: obs,
    question: "Как ощущения прямо сейчас?",
    buttons: [
      { text: "😴 Плохо", callback_data: "log_energy:2" },
      { text: "😐 Норм", callback_data: "log_energy:3" },
      { text: "⚡ Огонь", callback_data: "log_energy:5" },
    ],
  }
}

function ruleCoffeeTheanine(events: Event[], utcHour: number): RuleResult | null {
  if (utcHour < 8) return null
  const coffeeCount = countType(events, "coffee_cup")
  if (coffeeCount < 2) return null
  if (hasType(events, "l_theanine")) return null

  const obs = [
    `☕ ${coffeeCount} кофе без L-теанина — возможна тревожность и спад`,
  ]

  return {
    trigger_type: "coffee_theanine",
    priority: 5,
    cooldown_hours: 4,
    observations: obs,
    question: "Принял L-теанин?",
    buttons: [
      { text: "✅ Принял", callback_data: "log_ltheanine:1" },
      { text: "📝 Позже", callback_data: "all_good:0" },
    ],
  }
}

function ruleVitaminsReminder(events: Event[], utcHour: number): RuleResult | null {
  if (utcHour < 10) return null
  if (hasType(events, "vitamins_adam")) return null

  const obs = [`💊 Витамины: не отмечены за сегодня`]

  return {
    trigger_type: "vitamins_reminder",
    priority: 6,
    cooldown_hours: 8,
    observations: obs,
    question: "Принял витамины?",
    buttons: [
      { text: "✅ Принял", callback_data: "log_vitamins:1" },
      { text: "⏭ Пропускаю", callback_data: "all_good:0" },
    ],
  }
}

function ruleGoodProgress(events: Event[], yesterdayEvents: Event[], utcHour: number): RuleResult | null {
  if (utcHour < 12) return null  // need enough data to judge

  const todayNic = countType(events, "nicotine")
  const yestNic = countType(yesterdayEvents, "nicotine")
  const todayWater = sumType(events, "water_ml")
  const yestWater = sumType(yesterdayEvents, "water_ml")

  const nicBetter = yestNic > 5 && todayNic < yestNic * 0.6
  const waterBetter = yestWater > 0 && todayWater > yestWater * 1.4 && todayWater > 800

  if (!nicBetter && !waterBetter) return null

  const obs: string[] = []
  if (nicBetter) obs.push(`🚬 Никотин: ${todayNic} vs ${yestNic} вчера — заметный прогресс`)
  if (waterBetter) obs.push(`💧 Вода: ${todayWater} мл vs ${yestWater} вчера — хорошо`)

  return {
    trigger_type: "good_progress",
    priority: 7,
    cooldown_hours: 6,
    observations: obs,
    question: "Так держать!",
    buttons: [
      { text: "💪 Продолжаю", callback_data: "all_good:0" },
    ],
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Evaluate all rules against current state.
 * Returns all triggered rules sorted by priority (ascending = highest first).
 * No I/O — pure function.
 */
export function evaluateRules(
  todayEvents: Event[],
  yesterdayEvents: Event[],
  utcHour: number
): RuleResult[] {
  const candidates: (RuleResult | null)[] = [
    ruleNicotineRate(todayEvents, utcHour),
    ruleWaterCritical(todayEvents, utcHour),
    ruleNoEvents90min(todayEvents),
    ruleEnergyUntracked(todayEvents, utcHour),
    ruleCoffeeTheanine(todayEvents, utcHour),
    ruleVitaminsReminder(todayEvents, utcHour),
    ruleGoodProgress(todayEvents, yesterdayEvents, utcHour),
  ]

  return candidates
    .filter((r): r is RuleResult => r !== null)
    .sort((a, b) => a.priority - b.priority)
}
