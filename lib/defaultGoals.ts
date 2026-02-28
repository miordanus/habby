// SERVER ONLY — creates default goal version for a new user.
import { SupabaseClient } from "@supabase/supabase-js"

const DEFAULT_ITEMS = [
  { metric_key: "nicotine_count",  operator: "<=",   target_number: 20,   xp_reward: 10 },
  { metric_key: "caffeine_cups",   operator: "<=",   target_number: 2,    xp_reward: 10 },
  { metric_key: "water_ml",        operator: ">=",   target_number: 2000, xp_reward: 0  },
  { metric_key: "protein_g",       operator: ">=",   target_number: 150,  xp_reward: 0  },
  { metric_key: "calories",        operator: "range",target_number: 2700, tolerance_number: 0.10, xp_reward: 0 },
  { metric_key: "alcohol_yes",     operator: "==",   target_bool: false,  xp_reward: 0  },
  { metric_key: "vitamins_adam",   operator: "==",   target_bool: true,   xp_reward: 0  },
  { metric_key: "magnesium",       operator: "==",   target_bool: true,   xp_reward: 0  },
  { metric_key: "l_theanine",      operator: "==",   target_bool: true,   xp_reward: 0  },
]

export async function ensureDefaultGoals(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any>,
  userId: string,
  effectiveFrom: string
): Promise<void> {
  // Check if any goal exists already
  const { data: existing } = await sb
    .from("goals")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()

  if (existing) return  // already has goals

  // Create default goal version
  const { data: goal, error } = await sb
    .from("goals")
    .insert({ user_id: userId, effective_from: effectiveFrom })
    .select("id")
    .single()

  if (error || !goal) return

  const items = DEFAULT_ITEMS.map((item) => ({
    goal_id: goal.id,
    metric_key: item.metric_key,
    operator: item.operator,
    target_number: (item as { target_number?: number }).target_number ?? null,
    target_bool: (item as { target_bool?: boolean }).target_bool ?? null,
    tolerance_number: (item as { tolerance_number?: number }).tolerance_number ?? null,
    xp_reward: item.xp_reward,
    is_active: true,
  }))

  await sb.from("goal_items").insert(items)
}
