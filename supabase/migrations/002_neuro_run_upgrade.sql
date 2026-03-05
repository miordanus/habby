-- ============================================================
-- 002 Neuro-Run upgrade — event stream, quests, scoring, AI
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Helper: compute logical date from a timestamptz (05:00 UTC offset)
-- ─────────────────────────────────────────────────────────────
create or replace function logical_date_from_ts(ts timestamptz)
returns date language sql immutable parallel safe as $$
  select (ts - interval '5 hours')::date
$$;


-- ─────────────────────────────────────────────────────────────
-- 1. user_preferences
-- ─────────────────────────────────────────────────────────────
create table if not exists user_preferences (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references users(id) on delete cascade,
  nicotine_default_type text        not null default 'cig'
                        check (nicotine_default_type in ('cig', 'vape', 'pouch', 'other')),
  timezone              text        not null default 'Europe/Rome',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id)
);

alter table user_preferences enable row level security;
create policy "user_preferences_own" on user_preferences
  using (user_id = (select id from users where telegram_user_id =
    nullif(current_setting('app.telegram_user_id', true), '')::bigint));

create trigger user_preferences_updated_at
  before update on user_preferences
  for each row execute procedure set_updated_at();


-- ─────────────────────────────────────────────────────────────
-- 2. events  (append-only event stream)
-- ─────────────────────────────────────────────────────────────
create table if not exists events (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references users(id) on delete cascade,
  ts_original  timestamptz not null default now(),
  ts_effective timestamptz not null default now(),
  type         text        not null
               check (type in (
                 'nicotine', 'coffee_cup', 'water_ml',
                 'vitamins_adam', 'magnesium', 'l_theanine',
                 'workout', 'alcohol_yes',
                 'self_rating_energy', 'self_rating_focus', 'self_rating_stress'
               )),
  value        numeric     null,   -- for counted/measured events (ml, count, rating 1-5)
  value_bool   boolean     null,   -- for boolean events (vitamins, alcohol)
  value_text   text        null,   -- for enum events (nicotine type: cig/vape/pouch/other)
  metadata     jsonb       null,
  logical_date date        not null generated always as (logical_date_from_ts(ts_effective)) stored,
  created_at   timestamptz not null default now()
);

create index if not exists events_user_logical_date on events (user_id, logical_date);
create index if not exists events_user_ts_effective on events (user_id, ts_effective);

alter table events enable row level security;
create policy "events_own" on events
  using (user_id = (select id from users where telegram_user_id =
    nullif(current_setting('app.telegram_user_id', true), '')::bigint));


-- ─────────────────────────────────────────────────────────────
-- 3. quests
-- ─────────────────────────────────────────────────────────────
create table if not exists quests (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references users(id) on delete cascade,
  quest_type    text        not null check (quest_type in ('daily', 'weekly', 'monthly')),
  template_key  text        not null,
  title         text        not null,
  description   text        not null,
  metric_key    text        null,
  operator      text        null check (operator is null or operator in ('<=', '>=', '==')),
  target_number numeric     null,
  target_bool   boolean     null,
  phase         text        null check (phase is null or phase in ('morning', 'day', 'evening')),
  valid_from    date        not null,
  valid_until   date        not null,
  status        text        not null default 'active'
                check (status in ('active', 'completed', 'expired', 'cancelled', 'replaced')),
  xp_reward     int         not null default 50,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- one quest per (user, type, start-date) — idempotent generation
  unique (user_id, quest_type, template_key, valid_from)
);

create index if not exists quests_user_status on quests (user_id, status, valid_from);

alter table quests enable row level security;
create policy "quests_own" on quests
  using (user_id = (select id from users where telegram_user_id =
    nullif(current_setting('app.telegram_user_id', true), '')::bigint));

create trigger quests_updated_at
  before update on quests
  for each row execute procedure set_updated_at();


-- ─────────────────────────────────────────────────────────────
-- 4. quest_history  (audit log)
-- ─────────────────────────────────────────────────────────────
create table if not exists quest_history (
  id        uuid        primary key default gen_random_uuid(),
  quest_id  uuid        not null references quests(id) on delete cascade,
  user_id   uuid        not null references users(id) on delete cascade,
  action    text        not null check (action in ('cancelled', 'replaced', 'expired', 'completed')),
  reason    text        null,
  initiator text        not null default 'system' check (initiator in ('system', 'user')),
  created_at timestamptz not null default now()
);

alter table quest_history enable row level security;
create policy "quest_history_own" on quest_history
  using (user_id = (select id from users where telegram_user_id =
    nullif(current_setting('app.telegram_user_id', true), '')::bigint));


-- ─────────────────────────────────────────────────────────────
-- 5. daily_summaries  (cached day scores)
-- ─────────────────────────────────────────────────────────────
create table if not exists daily_summaries (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references users(id) on delete cascade,
  date             date        not null,
  day_score        int         null check (day_score is null or (day_score >= 0 and day_score <= 100)),
  recovery_score   int         null check (recovery_score is null or (recovery_score >= 0 and recovery_score <= 100)),
  focus_score      int         null check (focus_score is null or (focus_score >= 0 and focus_score <= 100)),
  stress_score     int         null check (stress_score is null or (stress_score >= 0 and stress_score <= 100)),
  discipline_score int         null check (discipline_score is null or (discipline_score >= 0 and discipline_score <= 100)),
  score_reasons    jsonb       null,  -- array of { component, reason, delta }
  quests_completed int         not null default 0,
  quests_total     int         not null default 0,
  verdict          text        null,  -- AI-generated verdict
  computed_at      timestamptz not null default now(),
  unique (user_id, date)
);

alter table daily_summaries enable row level security;
create policy "daily_summaries_own" on daily_summaries
  using (user_id = (select id from users where telegram_user_id =
    nullif(current_setting('app.telegram_user_id', true), '')::bigint));


-- ─────────────────────────────────────────────────────────────
-- 6. ai_prompts  (versioned prompt templates — not user-scoped)
-- ─────────────────────────────────────────────────────────────
create table if not exists ai_prompts (
  id                    uuid        primary key default gen_random_uuid(),
  template_key          text        not null,
  version               int         not null default 1,
  provider              text        not null default 'anthropic' check (provider in ('anthropic', 'openai')),
  system_prompt         text        not null,
  user_prompt_template  text        not null,
  is_active             boolean     not null default true,
  created_at            timestamptz not null default now(),
  unique (template_key, version)
);

-- No RLS — only service role accesses this table


-- ─────────────────────────────────────────────────────────────
-- 7. interventions  (log of bot messages sent)
-- ─────────────────────────────────────────────────────────────
create table if not exists interventions (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references users(id) on delete cascade,
  trigger_type        text        not null,
  phase               text        not null check (phase in ('morning', 'day', 'evening')),
  diagnosis           text        null,
  action_text         text        null,
  vibe_line           text        null,
  cta_types           jsonb       null,
  telegram_message_id int         null,
  sent_at             timestamptz null,
  created_at          timestamptz not null default now()
);

create index if not exists interventions_user_created on interventions (user_id, created_at desc);

alter table interventions enable row level security;
create policy "interventions_own" on interventions
  using (user_id = (select id from users where telegram_user_id =
    nullif(current_setting('app.telegram_user_id', true), '')::bigint));


-- ─────────────────────────────────────────────────────────────
-- 8. health_samples  (Apple Health bridge)
-- ─────────────────────────────────────────────────────────────
create table if not exists health_samples (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references users(id) on delete cascade,
  type         text        not null
               check (type in ('sleep_duration', 'hrv', 'steps', 'workout', 'resting_hr')),
  value        numeric     null,
  value_text   text        null,
  sample_date  date        not null,
  sample_start timestamptz null,
  sample_end   timestamptz null,
  source       text        not null default 'apple_shortcuts',
  metadata     jsonb       null,
  created_at   timestamptz not null default now()
);

create index if not exists health_samples_user_date on health_samples (user_id, sample_date);

alter table health_samples enable row level security;
create policy "health_samples_own" on health_samples
  using (user_id = (select id from users where telegram_user_id =
    nullif(current_setting('app.telegram_user_id', true), '')::bigint));


-- ─────────────────────────────────────────────────────────────
-- 9. Seed default ai_prompts
-- ─────────────────────────────────────────────────────────────
insert into ai_prompts (template_key, version, provider, system_prompt, user_prompt_template, is_active)
values
  (
    'intervention_morning', 1, 'anthropic',
    'You are a harsh but caring performance coach with rap energy. You speak directly and briefly. ' ||
    'Always respond with valid JSON matching exactly: {"diagnosis":"<1 line>","action":"<1 line>","vibe_line":"<optional rap bar>","cta_types":["open_app"]}. ' ||
    'No extra text, no markdown.',
    'Morning check for user. Phase: morning. ' ||
    'Yesterday stats: nicotine={{yesterday_nicotine}}, water={{yesterday_water_ml}}ml, quests_done={{yesterday_quests_done}}/3. ' ||
    'Today quests: {{quest_titles}}. ' ||
    'Streak: {{streak}} days. Write a short morning motivation in Russian rap coach style.',
    true
  ),
  (
    'intervention_evening', 1, 'anthropic',
    'You are a harsh but caring performance coach with rap energy. You speak directly and briefly. ' ||
    'Always respond with valid JSON matching exactly: {"diagnosis":"<1 line>","action":"<1 line>","vibe_line":"<optional rap bar>","cta_types":["open_app"]}. ' ||
    'No extra text, no markdown.',
    'Evening review for user. Phase: evening. ' ||
    'Today stats: nicotine={{nicotine_count}}, water={{water_ml}}ml, coffee={{coffee_count}}. ' ||
    'Day score: {{day_score}}/100. Quests completed: {{quests_completed}}/{{quests_total}}. ' ||
    'Streak: {{streak}} days. Write a verdict in Russian rap coach style.',
    true
  ),
  (
    'intervention_conditional', 1, 'anthropic',
    'You are a harsh but caring performance coach with rap energy. You speak directly and briefly. ' ||
    'Always respond with valid JSON matching exactly: {"diagnosis":"<1 line>","action":"<1 line>","vibe_line":"<optional rap bar>","cta_types":["log_water","open_app"]}. ' ||
    'No extra text, no markdown.',
    'Conditional alert for user. Trigger: {{trigger_type}}. Phase: {{phase}}. ' ||
    'Context: nicotine today={{nicotine_count}}, water today={{water_ml}}ml, last event={{minutes_since_last_event}}min ago. ' ||
    'Write a sharp intervention in Russian rap coach style. CTA should match the trigger.',
    true
  ),
  (
    'daily_verdict', 1, 'anthropic',
    'You are a performance analyst with rap energy. Respond with valid JSON: ' ||
    '{"diagnosis":"<2-3 sentences>","action":"<1 actionable tip for tomorrow>","vibe_line":"<rap bar summarizing the day>","cta_types":["open_app"]}. ' ||
    'No extra text, no markdown.',
    'Daily verdict for user. Date: {{date}}. ' ||
    'Day score: {{day_score}}/100 (recovery={{recovery}}, focus={{focus}}, stress={{stress}}, discipline={{discipline}}). ' ||
    'Events today: nicotine={{nicotine_count}}, water={{water_ml}}ml, coffee={{coffee_count}}. ' ||
    'Quests: {{quests_completed}}/{{quests_total}} completed. Streak: {{streak}} days. ' ||
    'Score reasons: {{score_reasons}}. Write a daily verdict in Russian rap coach style.',
    true
  ),
  (
    'weekly_summary', 1, 'anthropic',
    'You are a campaign commander reviewing weekly performance. Respond with valid JSON: ' ||
    '{"diagnosis":"<3-4 sentences>","action":"<top priority for next week>","vibe_line":"<rap bar>","cta_types":["open_app"]}. ' ||
    'No extra text, no markdown.',
    'Weekly campaign summary. Week: {{week}}. ' ||
    'Days logged: {{days_logged}}/7. Avg nicotine: {{avg_nicotine}}/day. Avg water: {{avg_water}}ml/day. ' ||
    'Training sessions: {{training_count}}. Quests completed: {{quests_completed}} total. ' ||
    'Vs last week: nicotine delta={{nicotine_delta}}, water delta={{water_delta}}ml. ' ||
    'Write a weekly campaign summary in Russian rap coach style.',
    true
  )
on conflict (template_key, version) do nothing;
