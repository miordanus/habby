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

// ── Neuro-Run types ───────────────────────────────────────────

export type EventType =
  | 'nicotine'
  | 'coffee_cup'
  | 'water_ml'
  | 'vitamins_adam'
  | 'magnesium'
  | 'l_theanine'
  | 'workout'
  | 'alcohol_yes'
  | 'self_rating_energy'
  | 'self_rating_focus'
  | 'self_rating_stress'

export type NicotineType = 'cig' | 'vape' | 'pouch' | 'other'

export interface Event {
  id: string
  user_id: string
  ts_original: string
  ts_effective: string
  type: EventType
  value: number | null
  value_bool: boolean | null
  value_text: string | null
  metadata: Record<string, unknown> | null
  logical_date: string
  created_at: string
}

export interface UserPreferences {
  id: string
  user_id: string
  nicotine_default_type: NicotineType
  timezone: string
  created_at: string
  updated_at: string
}

export type QuestType = 'daily' | 'weekly' | 'monthly'
export type QuestStatus = 'active' | 'completed' | 'expired' | 'cancelled' | 'replaced'
export type Phase = 'morning' | 'day' | 'evening'

export interface Quest {
  id: string
  user_id: string
  quest_type: QuestType
  template_key: string
  title: string
  description: string
  metric_key: string | null
  operator: '<=' | '>=' | '==' | null
  target_number: number | null
  target_bool: boolean | null
  phase: Phase | null
  valid_from: string
  valid_until: string
  status: QuestStatus
  xp_reward: number
  created_at: string
  updated_at: string
}

export interface QuestHistory {
  id: string
  quest_id: string
  user_id: string
  action: 'cancelled' | 'replaced' | 'expired' | 'completed'
  reason: string | null
  initiator: 'system' | 'user'
  created_at: string
}

export interface ScoreReason {
  component: 'recovery' | 'focus' | 'stress' | 'discipline'
  reason: string
  delta: number
}

export interface DailySummary {
  id: string
  user_id: string
  date: string
  day_score: number | null
  recovery_score: number | null
  focus_score: number | null
  stress_score: number | null
  discipline_score: number | null
  score_reasons: ScoreReason[] | null
  quests_completed: number
  quests_total: number
  verdict: string | null
  computed_at: string
}

export interface AIPrompt {
  id: string
  template_key: string
  version: number
  provider: 'anthropic' | 'openai'
  system_prompt: string
  user_prompt_template: string
  is_active: boolean
  created_at: string
}

export interface Intervention {
  id: string
  user_id: string
  trigger_type: string
  phase: Phase
  diagnosis: string | null
  action_text: string | null
  vibe_line: string | null
  cta_types: string[] | null
  telegram_message_id: number | null
  sent_at: string | null
  created_at: string
}

export interface HealthSample {
  id: string
  user_id: string
  type: 'sleep_duration' | 'hrv' | 'steps' | 'workout' | 'resting_hr'
  value: number | null
  value_text: string | null
  sample_date: string
  sample_start: string | null
  sample_end: string | null
  source: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface QuestProgress {
  current: number
  target: number
  pct: number
}
