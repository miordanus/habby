// SERVER ONLY — AI provider abstraction for Neuro-Run interventions.
// Supports Anthropic (default) and OpenAI, switchable via AI_PROVIDER env.
import Anthropic from "@anthropic-ai/sdk"
import { SupabaseClient } from "@supabase/supabase-js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient<any>

export interface AIOutput {
  diagnosis: string
  action: string
  vibe_line?: string
  cta_types: string[]
}

interface PromptTemplate {
  system_prompt: string
  user_prompt_template: string
}

// Hardcoded fallback templates (used when DB lookup fails)
const FALLBACK_TEMPLATES: Record<string, PromptTemplate> = {
  intervention_morning: {
    system_prompt:
      'You are a harsh but caring performance coach with rap energy. Always respond with valid JSON: {"diagnosis":"<1 line>","action":"<1 line>","vibe_line":"<rap bar>","cta_types":["open_app"]}.',
    user_prompt_template:
      "Morning check. Yesterday: nicotine={{yesterday_nicotine}}, water={{yesterday_water_ml}}ml. Today quests: {{quest_titles}}. Streak: {{streak}} days. Short morning motivation in Russian rap style.",
  },
  intervention_evening: {
    system_prompt:
      'You are a harsh but caring performance coach with rap energy. Always respond with valid JSON: {"diagnosis":"<1 line>","action":"<1 line>","vibe_line":"<rap bar>","cta_types":["open_app"]}.',
    user_prompt_template:
      "Evening review. Today: nicotine={{nicotine_count}}, water={{water_ml}}ml. Score: {{day_score}}/100. Quests: {{quests_completed}}/{{quests_total}}. Short verdict in Russian rap style.",
  },
  intervention_conditional: {
    system_prompt:
      'You are a harsh but caring performance coach. Always respond with valid JSON: {"diagnosis":"<1 line>","action":"<1 line>","vibe_line":"<rap bar>","cta_types":["log_water","open_app"]}.',
    user_prompt_template:
      "Alert: {{trigger_type}}. Phase: {{phase}}. Nicotine: {{nicotine_count}}, water: {{water_ml}}ml. Short sharp intervention in Russian.",
  },
  daily_verdict: {
    system_prompt:
      'Performance analyst with rap energy. Respond with valid JSON: {"diagnosis":"<2-3 sentences>","action":"<tip>","vibe_line":"<rap bar>","cta_types":["open_app"]}.',
    user_prompt_template:
      "Day score: {{day_score}}/100. Nicotine: {{nicotine_count}}, water: {{water_ml}}ml, coffee: {{coffee_count}}. Quests: {{quests_completed}}/{{quests_total}}. Daily verdict in Russian rap style.",
  },
  weekly_summary: {
    system_prompt:
      'Campaign commander reviewing weekly performance. Respond with valid JSON: {"diagnosis":"<3-4 sentences>","action":"<priority>","vibe_line":"<rap bar>","cta_types":["open_app"]}.',
    user_prompt_template:
      "Week {{week}}: {{days_logged}}/7 days logged. Avg nicotine: {{avg_nicotine}}/day. Training: {{training_count}}. Weekly summary in Russian rap style.",
  },
}

/** Load the latest active prompt template from DB, fallback to hardcoded. */
async function loadPromptTemplate(sb: SB, templateKey: string): Promise<PromptTemplate> {
  try {
    const { data } = await sb
      .from("ai_prompts")
      .select("system_prompt, user_prompt_template")
      .eq("template_key", templateKey)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) {
      return { system_prompt: data.system_prompt, user_prompt_template: data.user_prompt_template }
    }
  } catch {
    // fall through to fallback
  }
  return FALLBACK_TEMPLATES[templateKey] ?? FALLBACK_TEMPLATES.intervention_conditional
}

/** Fill {{variable}} placeholders in a template string. */
function fillTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key]
    return val !== undefined && val !== null ? String(val) : "N/A"
  })
}

/** Parse AI response — expects JSON but falls back gracefully. */
function parseAIResponse(raw: string): AIOutput {
  try {
    const parsed = JSON.parse(raw.trim()) as Partial<AIOutput>
    return {
      diagnosis: parsed.diagnosis ?? "Данных недостаточно.",
      action: parsed.action ?? "Открой приложение.",
      vibe_line: parsed.vibe_line,
      cta_types: Array.isArray(parsed.cta_types) ? parsed.cta_types : ["open_app"],
    }
  } catch {
    // Extract what we can from malformed response
    return {
      diagnosis: raw.slice(0, 120),
      action: "Открой приложение.",
      cta_types: ["open_app"],
    }
  }
}

// ── Anthropic provider ────────────────────────────────────────

let anthropicClient: Anthropic | null = null
function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropicClient
}

async function generateWithAnthropic(
  template: PromptTemplate,
  vars: Record<string, unknown>
): Promise<AIOutput> {
  const client = getAnthropicClient()
  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001"
  const userContent = fillTemplate(template.user_prompt_template, vars)

  const message = await client.messages.create({
    model,
    max_tokens: 256,
    system: template.system_prompt,
    messages: [{ role: "user", content: userContent }],
  })

  const raw = message.content.find((b) => b.type === "text")?.text ?? ""
  return parseAIResponse(raw)
}

// ── OpenAI provider ───────────────────────────────────────────

async function generateWithOpenAI(
  template: PromptTemplate,
  vars: Record<string, unknown>
): Promise<AIOutput> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY not set")

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
  const userContent = fillTemplate(template.user_prompt_template, vars)

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      messages: [
        { role: "system", content: template.system_prompt },
        { role: "user", content: userContent },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any
  const raw: string = data.choices?.[0]?.message?.content ?? ""
  return parseAIResponse(raw)
}

// ── Public API ────────────────────────────────────────────────

/**
 * Generate an AI intervention/verdict using the configured provider.
 * Falls back to a default message if AI call fails.
 */
export async function generateAI(
  sb: SB,
  templateKey: string,
  vars: Record<string, unknown>
): Promise<AIOutput> {
  const template = await loadPromptTemplate(sb, templateKey)
  const provider = process.env.AI_PROVIDER ?? "anthropic"

  try {
    if (provider === "openai") {
      return await generateWithOpenAI(template, vars)
    }
    return await generateWithAnthropic(template, vars)
  } catch (err) {
    console.error(`[aiProvider] ${templateKey} generation failed:`, err)
    return {
      diagnosis: "Система анализа недоступна.",
      action: "Открой приложение и продолжай.",
      cta_types: ["open_app"],
    }
  }
}
