-- ============================================================
-- 001 Neurochemistry Performance Tracker — initial schema
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. users  (telegram_user_id → internal UUID)
-- ─────────────────────────────────────────────────────────────
create table if not exists users (
  id               uuid        primary key default gen_random_uuid(),
  telegram_user_id bigint      unique not null,
  created_at       timestamptz not null default now()
);
alter table users enable row level security;
-- Service role bypasses RLS; these policies protect direct anon access
create policy "users_own" on users
  using (id = (select id from users where telegram_user_id =
    nullif(current_setting('app.telegram_user_id', true), '')::bigint));


-- ─────────────────────────────────────────────────────────────
-- 2. daily_logs
-- ─────────────────────────────────────────────────────────────
create table if not exists daily_logs (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references users(id) on delete cascade,
  date            date        not null,

  -- sleep
  wake_time       time        null,
  sleep_time      time        null,

  -- habits
  phone_free_min  int         null check (phone_free_min in (0, 15, 30, 60)),
  caffeine_cups   int         not null default 0 check (caffeine_cups >= 0),
  nicotine_count  int         not null default 0 check (nicotine_count >= 0),
  calories        int         null     check (calories >= 0),
  protein_g       int         null     check (protein_g >= 0),
  water_ml        int         not null default 0 check (water_ml >= 0),

  -- training
  training_type   text        not null default 'none'
                  check (training_type in ('none','swim','gym','home')),

  -- optional health
  resting_hr      int         null
                  check (resting_hr is null or (resting_hr >= 30 and resting_hr <= 200)),
  weight_kg       numeric(5,2) null
                  check (weight_kg is null or (weight_kg >= 30 and weight_kg <= 300)),

  -- vitamins
  vitamins_adam   boolean     not null default false,
  magnesium       boolean     not null default false,
  l_theanine      boolean     not null default false,

  -- alcohol
  alcohol_yes     boolean     not null default false,

  -- timestamps
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (user_id, date)
);

alter table daily_logs enable row level security;
create policy "daily_logs_own" on daily_logs
  using (user_id = (select id from users where telegram_user_id =
    nullif(current_setting('app.telegram_user_id', true), '')::bigint));

-- auto-update updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger daily_logs_updated_at
  before update on daily_logs
  for each row execute procedure set_updated_at();


-- ─────────────────────────────────────────────────────────────
-- 3. goals  (versioned goal sets)
-- ─────────────────────────────────────────────────────────────
create table if not exists goals (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references users(id) on delete cascade,
  effective_from date        not null,
  created_at     timestamptz not null default now(),

  unique (user_id, effective_from)
);

alter table goals enable row level security;
create policy "goals_own" on goals
  using (user_id = (select id from users where telegram_user_id =
    nullif(current_setting('app.telegram_user_id', true), '')::bigint));


-- ─────────────────────────────────────────────────────────────
-- 4. goal_items  (individual targets per goal version)
-- ─────────────────────────────────────────────────────────────
create table if not exists goal_items (
  id               uuid        primary key default gen_random_uuid(),
  goal_id          uuid        not null references goals(id) on delete cascade,
  metric_key       text        not null,
  operator         text        not null check (operator in ('<=', '>=', '==', 'range')),
  target_number    numeric     null,
  target_bool      boolean     null,
  tolerance_number numeric     null,  -- fractional tolerance for 'range' (e.g. 0.10 = ±10%)
  xp_reward        int         not null default 10,
  xp_cap           int         null,
  is_active        boolean     not null default true
);

alter table goal_items enable row level security;
create policy "goal_items_own" on goal_items
  using (goal_id in (
    select id from goals where user_id = (
      select id from users where telegram_user_id =
        nullif(current_setting('app.telegram_user_id', true), '')::bigint
    )
  ));


-- ─────────────────────────────────────────────────────────────
-- 5. daily_goal_evaluations  (snapshot per day — immune to future edits)
-- ─────────────────────────────────────────────────────────────
create table if not exists daily_goal_evaluations (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references users(id) on delete cascade,
  date          date        not null,
  goal_id_used  uuid        not null references goals(id),
  metric_key    text        not null,
  actual_number numeric     null,
  actual_bool   boolean     null,
  target_number numeric     null,
  target_bool   boolean     null,
  delta_number  numeric     null,
  met           boolean     not null,
  xp_awarded    int         not null default 0,
  created_at    timestamptz not null default now(),

  unique (user_id, date, metric_key)
);

alter table daily_goal_evaluations enable row level security;
create policy "daily_goal_evaluations_own" on daily_goal_evaluations
  using (user_id = (select id from users where telegram_user_id =
    nullif(current_setting('app.telegram_user_id', true), '')::bigint));


-- ─────────────────────────────────────────────────────────────
-- 6. xp_events  (idempotent via unique constraint)
-- ─────────────────────────────────────────────────────────────
create table if not exists xp_events (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references users(id) on delete cascade,
  date        date        not null,
  event_type  text        not null,
  xp          int         not null check (xp >= 0),
  meta        jsonb       null,
  created_at  timestamptz not null default now(),

  unique (user_id, date, event_type)
);

alter table xp_events enable row level security;
create policy "xp_events_own" on xp_events
  using (user_id = (select id from users where telegram_user_id =
    nullif(current_setting('app.telegram_user_id', true), '')::bigint));
