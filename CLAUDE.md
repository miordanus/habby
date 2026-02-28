# ONE-SHOT PROMPT FOR CLAUDE CODE (Next.js App Router + Supabase + Vercel + Telegram Mini App)
You are Claude Code acting as a Senior Full-Stack Engineer + Product-minded Game Designer.
You will implement an MVP “Neurochemistry Performance Tracker” in an EXISTING repo (a duplicated repo from a previous Telegram miniapp project).
You MUST reuse existing infra: Telegram initData auth, Supabase client, UI patterns, deployment setup. Do not reinvent.

## WHAT YOU MUST DO FIRST
1) Read `/claude.md` in the repo (current). Read it fully.
2) Scan repo for:
   - Telegram initData auth verification (server route / middleware / utils)
   - Supabase client setup (client + server)
   - Existing DB tables/migrations
   - Any existing “subscriptions tracker” UI components (to reuse layout, safe-area fixes, styling)
3) Then implement the MVP using the existing patterns. Only add what’s needed.
4) Output only the code changes and migration SQL files required.

---

# HARD CONSTRAINTS
- Do NOT change the underlying methodology/protocol logic. Only implement product mechanics around it.
- Single user expected, but DO NOT weaken security:
  - NEVER put Supabase service_role in client
  - Use RLS properly
  - Telegram initData must be verified server-side
- Must work well in iOS Telegram (safe-area, no overlap).
- Day boundary: 05:00 (logical day).
- Check-ins should be fast, clicker-first, anti-shame (no penalties).

---

# PRODUCT REQUIREMENTS (LOCKED)

## Day boundary
- Logical date = date part of (now - 5 hours) in user timezone.
- All “today”, XP, streaks use logical date.

## Reminders
- Morning push: 08:30 local
- Evening push: 23:30 local
Each message includes button opening the miniapp check-in.

Implement reminders via Vercel Cron hitting API routes that call Telegram Bot API.

## Daily tracking fields
Core:
- wake_time (time)
- sleep_time (time)
- phone_free_min (0/15/30/60)
- caffeine_cups (int)
- nicotine_count (int)
- calories (int)
- protein_g (int)
- water_ml (int)
- training_type ('none'|'swim'|'gym'|'home')

Optional:
- resting_hr (int)
- weight_kg (numeric)

Vitamins (booleans):
- vitamins_adam
- magnesium
- l_theanine

Alcohol:
- alcohol_yes (boolean). “No alcohol” means false.

## Goals (editable in UI, future-only, versioned)
Default goal values (create automatically if none exist):
- caffeine_cups <= 2
- nicotine_count <= 20
- water_ml >= 2000
- protein_g >= 150
- calories == 2700 (treat as target range, see below)
- alcohol_yes == false
- vitamins_adam == true
- magnesium == true
- l_theanine == true (ONLY if caffeine_cups > 0; otherwise treat as N/A and do not evaluate)

Goals rules:
- Goal edits apply ONLY from a future effective date (tomorrow or later). No retro changes.
- Store goal versions.
- On date D, pick the latest goal version where effective_from <= D.
- Persist per-day evaluation with deltas, so later goal changes don’t rewrite history.

Calories goal evaluation:
- Use a tolerance band to avoid self-abuse: target 2700 with +/- 10% (2430–2970) counts as “met”.
- Store delta as (actual - target) numeric.

## Gamification (XP only, no penalties)
XP events are idempotent; avoid farming.
XP actions:
- Quick check-in saved: +20 XP
- Full check-in saved: +35 XP
  Criteria for “full”: daily log contains nicotine+caffeine+water+calories+protein AND at least one of wake_time/sleep_time.
- Backfill day saved: +15 XP (when editing a past date)
- Phone-free >=30 min: +10 XP (once/day)
- Caffeine goal met: +10 XP (once/day)
- Nicotine goal met: +10 XP (once/day)
- Weekly training goal: if >=2 sessions in last 7 logical days, award +40 XP once per ISO week.

Streak:
- A day counts “logged” if there is a daily_logs row for that logical date.
- Streak increments on consecutive logged logical days.
- Shield: 1 missed day per ISO week does not reset streak (auto). Missing >1 day breaks streak.

Backfill window:
- Backfill allowed up to 7 days.
- Backfill counts toward streak ONLY if entered within 72 hours of that date.

## “Me vs me” stats
Stats screen shows This week vs Last week:
- days logged
- avg nicotine/day
- avg caffeine/day
- avg calories
- avg protein
- avg water
- avg wake time + basic consistency (optional: std dev)
- training count

## Anti-shame UI
- No red failures.
- No negative XP.
- If alcohol_yes = true: do not punish; just show neutral note and still allow logging XP.

---

# MVP UX SCREENS (MUST IMPLEMENT)

## Screen 1: Home (Today)
- XP today
- Level progress bar (simple: level = floor(totalXP / 500) + 1)
- Current streak + shield status
- “Today Contract” chips (today’s goals)
- Clickers:
  - 🚬 +1, +5, -1
  - 💧 +250, +500
  - ☕ +1, -1
  - 🍽 Calories +200, +500
  - 🥩 Protein +25, +50
- Buttons:
  - Quick Check-in
  - Full Check-in (expand)
  - History (last 7 days)
  - Goals (Next Contract)

## Screen 2: Check-in (Quick + Expand)
Quick fields:
- nicotine_count (clicker)
- caffeine_cups (clicker)
- calories (clicker + manual)
- protein_g (clicker + manual)
- water_ml (clicker)
- wake_time (default now, editable)
- sleep_time (editable)
- phone_free_min (0/15/30/60)
- training_type toggle
- vitamins toggles (3)
- alcohol toggle

## Screen 3: History (last 7 days)
- list last 7 logical dates with badges (logged / backfilled)
- tap to edit day
- enforce backfill <= 7 days

## Screen 4: Goals (Next Contract)
- Show current goal version (read-only)
- Create/Edit next goal version:
  - Effective date (tomorrow default; allow pick future date)
  - Targets editable for:
    - nicotine max
    - caffeine max
    - water min
    - protein min
    - calories target (2700 default)
    - alcohol free (bool)
    - vitamins required (bools)
- Save creates new goal version; does not alter past evaluations.

## Screen 5: Stats
- This week vs Last week (cards)
- Basic charts (optional, minimal): nicotine, caffeine, calories, protein, water.

---

# IMPLEMENTATION DETAILS (YOU MUST EXECUTE)

## 1) Database + RLS (Supabase) — SQL migrations
Add migrations (Supabase CLI style if repo uses it; otherwise add `/supabase/migrations/*.sql` similarly).

### A) Table: daily_logs
Columns:
- id uuid primary key default gen_random_uuid()
- user_id uuid not null
- date date not null
- wake_time time null
- sleep_time time null
- phone_free_min int null
- caffeine_cups int not null default 0 check (caffeine_cups >= 0)
- nicotine_count int not null default 0 check (nicotine_count >= 0)
- calories int null check (calories >= 0)
- protein_g int null check (protein_g >= 0)
- water_ml int not null default 0 check (water_ml >= 0)
- training_type text not null default 'none' check (training_type in ('none','swim','gym','home'))
- resting_hr int null check (resting_hr >= 30 and resting_hr <= 200)
- weight_kg numeric(5,2) null check (weight_kg >= 30 and weight_kg <= 300)
- vitamins_adam boolean not null default false
- magnesium boolean not null default false
- l_theanine boolean not null default false
- alcohol_yes boolean not null default false
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
Constraints:
- unique(user_id, date)

Add trigger to update updated_at on update.

### B) Goals tables (versioned)
Table: goals
- id uuid pk default gen_random_uuid()
- user_id uuid not null
- effective_from date not null
- created_at timestamptz default now()
- unique(user_id, effective_from)

Table: goal_items
- id uuid pk default gen_random_uuid()
- goal_id uuid not null references goals(id) on delete cascade
- metric_key text not null
- operator text not null check (operator in ('<=','>=','==','range'))
- target_number numeric null
- target_bool boolean null
- tolerance_number numeric null  -- used for range goals (e.g., calories)
- xp_reward int not null default 10
- xp_cap int null
- is_active boolean not null default true

Metric keys to support:
- nicotine_count (<=)
- caffeine_cups (<=)
- water_ml (>=)
- protein_g (>=)
- calories (range) with target_number=2700 and tolerance_number=0.10
- alcohol_yes (== false)
- vitamins_adam (== true)
- magnesium (== true)
- l_theanine (== true, but N/A if caffeine_cups == 0)

### C) Goal evaluation persistence
Table: daily_goal_evaluations
- id uuid pk default gen_random_uuid()
- user_id uuid not null
- date date not null
- goal_id_used uuid not null references goals(id)
- metric_key text not null
- actual_number numeric null
- actual_bool boolean null
- target_number numeric null
- target_bool boolean null
- delta_number numeric null
- met boolean not null
- xp_awarded int not null default 0
- created_at timestamptz default now()
Constraints:
- unique(user_id, date, metric_key)

### D) XP events (idempotent)
Table: xp_events
- id uuid pk default gen_random_uuid()
- user_id uuid not null
- date date not null
- event_type text not null
- xp int not null check (xp >= 0)
- meta jsonb null
- created_at timestamptz default now()

Uniqueness for idempotency:
- unique(user_id, date, event_type)

Event types to implement:
- checkin_quick
- checkin_full
- checkin_backfill
- bonus_phone_free_30
- bonus_goal_caffeine
- bonus_goal_nicotine
- weekly_training_bonus

### E) Aggregate view or helper (optional)
You may create a view for:
- total_xp per user
- xp_today
- current_streak (can be computed server-side)

### RLS
Enable RLS on all tables.
Policies:
- daily_logs: user_id = auth.uid()
- goals/goal_items: user owns goals via goals.user_id = auth.uid()
- daily_goal_evaluations: user_id = auth.uid()
- xp_events: user_id = auth.uid()

## 2) Server-side logic (Next.js App Router)
Implement server actions or API routes (prefer server actions for app router) for:

### A) getLogicalDate()
Utility:
- logicalDate = new Date(Date.now() - 5*60*60*1000)
- return yyyy-mm-dd

Use it consistently.

### B) Upsert daily log
Function:
- upsert row by (user_id, date)
- return the saved row

### C) Award XP (idempotent)
On save:
- Determine if date is today or backfill.
- Insert xp_events with unique constraints to prevent duplicates.

Rules:
- If editing date < today:
  - insert `checkin_backfill` once for that day
- Insert checkin_quick or checkin_full based on criteria (idempotent).
- If phone_free_min >= 30 → award bonus_phone_free_30
- Evaluate goals for that date (see below) and persist daily_goal_evaluations:
  - Determine goal version used for that date
  - Compute met + delta for each active goal_item
  - Store evaluation row per metric_key (upsert)
  - Award XP events for caffeine + nicotine met (as per spec) via xp_events
  - Vitamins/alcohol/calories/protein/water goal XP: DO NOT add extra XP beyond the listed ones in MVP unless you decide to add as “future”, but keep it minimal. For now, only the spec’d daily bonuses + logging XP.
  - However still persist evaluations for all metrics for UI.

Special rule:
- l_theanine evaluation is N/A if caffeine_cups == 0:
  - store met=true and delta null OR store met=true with meta “na”
  - do not award/withhold any XP based on it

Weekly training bonus:
- Once per ISO week:
  - Count daily_logs in last 7 logical days with training_type != 'none'
  - If >=2 → insert weekly_training_bonus with date = logicalDate
  - Use event_type uniqueness plus a “week key” in meta if needed (or create additional unique constraint per week; simplest: event_type = `weekly_training_bonus_YYYY-WW`).

### D) Streak computation
Compute streak server-side:
- Get recent 30 days of daily_logs ordered by date desc.
- Determine logged days by existence.
- Apply shield:
  - For current ISO week: allow 1 missed day without breaking streak.
  - For previous weeks: streak breaks as soon as there is a gap > allowed shield in that week.
Simpler MVP acceptable:
- Compute streak as consecutive logged days from today backward,
  allowing one skip within current ISO week.
Persist streak value in a computed endpoint, no need table.

### E) Goals editing (future-only)
UI saves a new goals row:
- effective_from must be >= tomorrow (logical tomorrow).
- Create goal record + goal_items for all targets.
- Do not modify past evaluations.
- After saving goals, future days will use that version.

### F) Telegram reminders via cron endpoints
Create API routes:
- `/api/cron/morning`
- `/api/cron/evening`
Secured by a secret token (CRON_SECRET) in headers/query.
They call Telegram Bot API sendMessage to the single user (chat_id from env).
Message includes an inline button that opens the miniapp (web_app).
Use existing bot token env.

Env vars (server only):
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID (single user)
- CRON_SECRET
- SUPABASE_SERVICE_ROLE_KEY (server only, if needed for cron; prefer anon + user session where possible; cron can be server role if only sending message)
- SUPABASE_URL
- SUPABASE_ANON_KEY

## 3) Client UI (React, Telegram miniapp)
Reuse existing UI framework in repo.

Requirements:
- iOS safe-area handling (use env(safe-area-inset-*) or existing patterns)
- Fast interactions (clickers)
- Visible immediate feedback on Save (+XP breakdown)
- History editing with date selector (last 7 days)

### Home
- show today totals + clickers
- show XP today, total XP, level, streak, shield icon
- show goal chips for today (from evaluations or from goal version)

### Check-in
- quick mode default
- expandable sections:
  - Sleep
  - Health (HR/weight)
  - Vitamins
  - Alcohol
- Save button with success toast

### Goals screen
- show current goals
- edit next goals:
  - nicotine max
  - caffeine max
  - water min
  - protein min
  - calories target (default 2700)
  - alcohol free bool
  - vitamins required bools
- effective date picker default tomorrow
- enforce future-only with validation message

### Stats
- compute week aggregates from daily_logs
- show week-over-week cards

---

# QA CHECKLIST (YOU MUST DO)
- Test iOS Telegram safe-area: no overlapping top buttons, no clipped Save.
- Verify Telegram initData auth still works.
- Verify RLS blocks unauthenticated access.
- Verify no service role key shipped to client bundle.
- Verify XP events are idempotent (saving multiple times doesn’t farm XP).
- Verify logical day at 05:00 works (simulate late-night usage).
- Verify backfill:
  - can edit last 7 days
  - streak credit only within 72h rule

---

# ACCEPTANCE CRITERIA
1) A user can open miniapp and submit a daily log in <60 seconds using clickers.
2) Goals can be edited in UI for future date only; past does not change.
3) daily_goal_evaluations are stored per day and remain stable after goal changes.
4) XP + Level + Streak + Shield behave as spec.
5) Telegram morning/evening reminders work via cron endpoints.
6) Calories target is stored and evaluated as range (±10%).
7) Vitamins and alcohol toggles are tracked and stored daily.
8) “This week vs last week” stats screen works with real data.

---

# IMPORTANT IMPLEMENTATION NOTE
Because this repo is a duplicate of a previous miniapp, you MUST:
- reuse existing layout, theming, safe-area logic, and Telegram integration
- avoid large refactors
- add only necessary new components and pages
- keep code style consistent with existing project conventions

Proceed to implement now.

## OUTPUT REQUIREMENTS (DOCUMENTATION)
Along with code changes, create `docs/SETUP.md` that includes:
1) Supabase project creation steps (dashboard)
2) Where to paste SQL migrations (Supabase CLI or SQL editor) based on repo setup:
   - If repo uses Supabase CLI: commands `supabase init`, `supabase link`, `supabase db push`
   - Otherwise: “SQL Editor → run migrations in order”
3) How to enable RLS and verify policies (include SQL checks)
4) Required environment variables for:
   - Next.js (client + server)
   - Vercel
   - Telegram bot
   - Cron security secret
5) How to set Vercel Cron schedules for morning/evening endpoints
6) How to obtain Telegram Chat ID for the single user (safe method)
7) Verification checklist: auth works, RLS works, cron works, iOS safe-area ok
