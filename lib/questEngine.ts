// SERVER ONLY — Quest generation, progress computation, and lifecycle management.
import { SupabaseClient } from "@supabase/supabase-js"
import { addDays } from "./logicalDate"
import { generateAI } from "./aiProvider"
import type { Event, Quest, QuestProgress } from "@/types/database"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient<any>

// ── Template library ──────────────────────────────────────────

interface QuestTemplate {
  quest_type: "daily" | "weekly" | "monthly"
  template_key: string
  metric_key: string | null
  operator: "<=" | ">=" | "==" | null
  default_target_number: number | null
  default_target_bool: boolean | null
  phase: "morning" | "day" | "evening" | null
  xp_reward: number
  default_title: string
  default_description: string
}

const QUEST_TEMPLATES: QuestTemplate[] = [
  // ── Daily ──────────────────────────────────────────────────
  {
    quest_type: "daily", template_key: "daily_water_2000",
    metric_key: "water_ml", operator: ">=", default_target_number: 2000,
    default_target_bool: null, phase: null, xp_reward: 50,
    default_title: "Гидратация 2L",
    default_description: "Выпей не менее 2000мл воды за день",
  },
  {
    quest_type: "daily", template_key: "daily_nicotine_limit_20",
    metric_key: "nicotine_count", operator: "<=", default_target_number: 20,
    default_target_bool: null, phase: null, xp_reward: 60,
    default_title: "Никотин под контролем",
    default_description: "Не более 20 никотиновых событий за день",
  },
  {
    quest_type: "daily", template_key: "daily_nicotine_limit_10",
    metric_key: "nicotine_count", operator: "<=", default_target_number: 10,
    default_target_bool: null, phase: null, xp_reward: 80,
    default_title: "Никотин — жёсткий режим",
    default_description: "Не более 10 никотиновых событий за день",
  },
  {
    quest_type: "daily", template_key: "daily_coffee_limit",
    metric_key: "coffee_cup", operator: "<=", default_target_number: 2,
    default_target_bool: null, phase: null, xp_reward: 40,
    default_title: "Кофе 2 чашки",
    default_description: "Не более 2 чашек кофе",
  },
  {
    quest_type: "daily", template_key: "daily_vitamins",
    metric_key: "vitamins_adam", operator: "==", default_target_number: null,
    default_target_bool: true, phase: "morning", xp_reward: 30,
    default_title: "Витамины утром",
    default_description: "Прими витамины в утренний период",
  },
  {
    quest_type: "daily", template_key: "daily_rate_morning",
    metric_key: "self_rating_energy", operator: ">=", default_target_number: 1,
    default_target_bool: null, phase: "morning", xp_reward: 20,
    default_title: "Утренняя оценка",
    default_description: "Оцени энергию утром (любая оценка засчитывается)",
  },
  {
    quest_type: "daily", template_key: "daily_no_alcohol",
    metric_key: "alcohol_yes", operator: "==", default_target_number: null,
    default_target_bool: false, phase: null, xp_reward: 50,
    default_title: "Без алкоголя",
    default_description: "День без алкоголя",
  },
  {
    quest_type: "daily", template_key: "daily_workout",
    metric_key: "workout", operator: ">=", default_target_number: 1,
    default_target_bool: null, phase: null, xp_reward: 70,
    default_title: "Тренировка дня",
    default_description: "Залогируй тренировку сегодня",
  },
  // ── Weekly ─────────────────────────────────────────────────
  {
    quest_type: "weekly", template_key: "weekly_training_3x",
    metric_key: "workout", operator: ">=", default_target_number: 3,
    default_target_bool: null, phase: null, xp_reward: 150,
    default_title: "3 тренировки за неделю",
    default_description: "Залогируй минимум 3 тренировки за 7 дней",
  },
  {
    quest_type: "weekly", template_key: "weekly_avg_water",
    metric_key: "water_ml", operator: ">=", default_target_number: 14000,
    default_target_bool: null, phase: null, xp_reward: 120,
    default_title: "Гидратация недели",
    default_description: "Суммарно 14L воды за 7 дней",
  },
  {
    quest_type: "weekly", template_key: "weekly_low_nicotine",
    metric_key: "nicotine_count", operator: "<=", default_target_number: 100,
    default_target_bool: null, phase: null, xp_reward: 200,
    default_title: "Никотиновая неделя",
    default_description: "Не более 100 никотиновых событий за неделю",
  },
  // ── Monthly ────────────────────────────────────────────────
  {
    quest_type: "monthly", template_key: "monthly_streak_20",
    metric_key: null, operator: null, default_target_number: 20,
    default_target_bool: null, phase: null, xp_reward: 500,
    default_title: "Полоса 20 дней",
    default_description: "Поддерживай стрик минимум 20 дней в этом месяце",
  },
  {
    quest_type: "monthly", template_key: "monthly_training_12x",
    metric_key: "workout", operator: ">=", default_target_number: 12,
    default_target_bool: null, phase: null, xp_reward: 400,
    default_title: "12 тренировок за месяц",
    default_description: "Залогируй 12 тренировок за 30 дней",
  },
]

const TEMPLATE_MAP = new Map(QUEST_TEMPLATES.map((t) => [t.template_key, t]))

// ── Quest selection ───────────────────────────────────────────

/** Select 3 daily quest templates based on recent event history. */
async function selectDailyQuestTemplates(sb: SB, userId: string, today: string): Promise<string[]> {
  const sevenDaysAgo = addDays(today, -6)

  // Get recent events summary
  const { data: events } = await sb
    .from("events")
    .select("type, value")
    .eq("user_id", userId)
    .gte("logical_date", sevenDaysAgo)
    .lte("logical_date", today)

  const nicotineTotal = (events ?? []).filter((e: { type: string }) => e.type === "nicotine").length
  const waterEvents = (events ?? []).filter((e: { type: string }) => e.type === "water_ml").length
  const workoutEvents = (events ?? []).filter((e: { type: string }) => e.type === "workout").length

  const selected: string[] = []

  // Quest 1: nicotine-related (always relevant)
  if (nicotineTotal > 70) {
    selected.push("daily_nicotine_limit_20")
  } else if (nicotineTotal > 30) {
    selected.push("daily_nicotine_limit_10")
  } else {
    selected.push("daily_nicotine_limit_20")
  }

  // Quest 2: hydration if water logging is sparse
  if (waterEvents < 3) {
    selected.push("daily_water_2000")
  } else {
    selected.push("daily_coffee_limit")
  }

  // Quest 3: training if no workouts recently, else vitamins
  if (workoutEvents === 0) {
    selected.push("daily_workout")
  } else {
    selected.push("daily_vitamins")
  }

  return selected
}

// ── Quest text generation ─────────────────────────────────────

interface QuestTextResult {
  title: string
  description: string
}

async function generateQuestText(
  sb: SB,
  template: QuestTemplate,
  vars: Record<string, unknown>
): Promise<QuestTextResult> {
  try {
    const output = await generateAI(sb, "intervention_morning", {
      quest_template: template.template_key,
      default_title: template.default_title,
      default_description: template.default_description,
      ...vars,
    })
    // Use AI output if it provides something meaningful, otherwise fallback
    if (output.action && output.action.length > 5) {
      return { title: template.default_title, description: output.action }
    }
  } catch {
    // fallback to defaults
  }
  return { title: template.default_title, description: template.default_description }
}

// ── Main quest generation ─────────────────────────────────────

/**
 * Generate and upsert 3 daily quests for today.
 * Idempotent — safe to call multiple times for the same date.
 */
export async function generateDailyQuests(sb: SB, userId: string, today: string): Promise<void> {
  const templateKeys = await selectDailyQuestTemplates(sb, userId, today)
  const validUntil = today // daily quests expire at end of day

  for (const key of templateKeys) {
    const template = TEMPLATE_MAP.get(key)
    if (!template) continue

    const text = await generateQuestText(sb, template, { today })

    await sb.from("quests").upsert(
      {
        user_id: userId,
        quest_type: "daily",
        template_key: key,
        title: text.title,
        description: text.description,
        metric_key: template.metric_key,
        operator: template.operator,
        target_number: template.default_target_number,
        target_bool: template.default_target_bool,
        phase: template.phase,
        valid_from: today,
        valid_until: validUntil,
        status: "active",
        xp_reward: template.xp_reward,
      },
      { onConflict: "user_id,quest_type,template_key,valid_from", ignoreDuplicates: true }
    )
  }
}

/**
 * Generate weekly quests for the week containing `today`.
 * Idempotent.
 */
export async function generateWeeklyQuests(sb: SB, userId: string, today: string): Promise<void> {
  // Week start = Monday before or on today
  const d = new Date(today + "T12:00:00Z")
  const dow = (d.getUTCDay() + 6) % 7 // Mon=0
  const weekStart = addDays(today, -dow)
  const weekEnd = addDays(weekStart, 6)

  const weeklyKeys = ["weekly_training_3x", "weekly_avg_water", "weekly_low_nicotine"]
  for (const key of weeklyKeys) {
    const template = TEMPLATE_MAP.get(key)
    if (!template) continue

    await sb.from("quests").upsert(
      {
        user_id: userId,
        quest_type: "weekly",
        template_key: key,
        title: template.default_title,
        description: template.default_description,
        metric_key: template.metric_key,
        operator: template.operator,
        target_number: template.default_target_number,
        target_bool: template.default_target_bool,
        phase: null,
        valid_from: weekStart,
        valid_until: weekEnd,
        status: "active",
        xp_reward: template.xp_reward,
      },
      { onConflict: "user_id,quest_type,template_key,valid_from", ignoreDuplicates: true }
    )
  }
}

/** Mark quests as expired if valid_until < today and still active. */
export async function expireOldQuests(sb: SB, userId: string, today: string): Promise<void> {
  const { data: toExpire } = await sb
    .from("quests")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .lt("valid_until", today)

  if (!toExpire || toExpire.length === 0) return

  const ids = toExpire.map((q: { id: string }) => q.id)

  await sb.from("quests").update({ status: "expired" }).in("id", ids)

  // Insert history rows
  const historyRows = ids.map((id: string) => ({
    quest_id: id,
    user_id: userId,
    action: "expired",
    reason: "Quest period ended",
    initiator: "system",
  }))
  await sb.from("quest_history").insert(historyRows)
}

// ── Progress computation ──────────────────────────────────────

/** Compute current progress for a quest given today's events. */
export function computeQuestProgress(quest: Quest, events: Event[]): QuestProgress {
  const target = quest.target_number ?? 1
  if (!quest.metric_key) {
    // Non-metric quest (e.g., streak) — check status
    return { current: quest.status === "completed" ? target : 0, target, pct: quest.status === "completed" ? 1 : 0 }
  }

  const metric = quest.metric_key

  if (quest.target_bool !== null) {
    // Boolean quest: check if any event of this type matches
    const met = events.some((e) => e.type === metric && e.value_bool === quest.target_bool)
    return { current: met ? 1 : 0, target: 1, pct: met ? 1 : 0 }
  }

  // Numeric quest
  let current = 0

  if (metric === "water_ml") {
    current = events.filter((e) => e.type === "water_ml").reduce((sum, e) => sum + (e.value ?? 0), 0)
  } else if (metric === "nicotine_count") {
    current = events.filter((e) => e.type === "nicotine").reduce((sum, e) => sum + (e.value ?? 1), 0)
  } else if (metric === "coffee_cup") {
    current = events.filter((e) => e.type === "coffee_cup").length
  } else if (metric === "workout") {
    current = events.filter((e) => e.type === "workout").length
  } else if (metric === "self_rating_energy" || metric === "self_rating_focus" || metric === "self_rating_stress") {
    // Any rating logged = quest met
    current = events.filter((e) => e.type === metric).length > 0 ? target : 0
  }

  const pct =
    quest.operator === "<="
      ? current <= target ? 1 : Math.max(0, 1 - (current - target) / target)
      : Math.min(1, current / target)

  return { current, target, pct }
}

/** Auto-complete quests based on today's events. Returns count completed. */
export async function autoCompleteQuests(
  sb: SB,
  userId: string,
  today: string,
  events: Event[]
): Promise<number> {
  const { data: activeQuests } = await sb
    .from("quests")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("valid_from", today)
    .eq("quest_type", "daily")

  if (!activeQuests) return 0

  let completed = 0
  for (const quest of activeQuests as Quest[]) {
    const prog = computeQuestProgress(quest, events)
    const met =
      quest.operator === "<="
        ? prog.current <= (quest.target_number ?? Infinity)
        : quest.target_bool !== null
        ? prog.current === 1
        : prog.pct >= 1

    if (met) {
      await sb.from("quests").update({ status: "completed" }).eq("id", quest.id)
      await sb.from("quest_history").insert({
        quest_id: quest.id,
        user_id: userId,
        action: "completed",
        reason: "Auto-completed by event evaluation",
        initiator: "system",
      })
      completed++
    }
  }
  return completed
}
