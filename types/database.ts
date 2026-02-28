export interface User {
  id: string
  telegram_user_id: number
  created_at: string
}

export interface DailyLog {
  id: string
  user_id: string
  date: string
  wake_time: string | null
  sleep_time: string | null
  phone_free_min: number | null
  caffeine_cups: number
  nicotine_count: number
  calories: number | null
  protein_g: number | null
  water_ml: number
  training_type: "none" | "swim" | "gym" | "home"
  resting_hr: number | null
  weight_kg: number | null
  vitamins_adam: boolean
  magnesium: boolean
  l_theanine: boolean
  alcohol_yes: boolean
  created_at: string
  updated_at: string
}

export type DailyLogInput = Omit<DailyLog, "id" | "user_id" | "created_at" | "updated_at">

export interface Goal {
  id: string
  user_id: string
  effective_from: string
  created_at: string
  items?: GoalItem[]
}

export interface GoalItem {
  id: string
  goal_id: string
  metric_key: string
  operator: "<=" | ">=" | "==" | "range"
  target_number: number | null
  target_bool: boolean | null
  tolerance_number: number | null
  xp_reward: number
  xp_cap: number | null
  is_active: boolean
}

export interface DailyGoalEvaluation {
  id: string
  user_id: string
  date: string
  goal_id_used: string
  metric_key: string
  actual_number: number | null
  actual_bool: boolean | null
  target_number: number | null
  target_bool: boolean | null
  delta_number: number | null
  met: boolean
  xp_awarded: number
  created_at: string
}

export interface XpEvent {
  id: string
  user_id: string
  date: string
  event_type: string
  xp: number
  meta: Record<string, unknown> | null
  created_at: string
}

export interface XpSummary {
  totalXp: number
  xpToday: number
  level: number
  xpIntoLevel: number
  xpForNextLevel: number
  streak: number
  shieldActive: boolean
}
