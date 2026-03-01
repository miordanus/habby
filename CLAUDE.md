# habby — Neurochemistry Performance Tracker
## Architecture Reference for AI Assistants

This document describes the **actual implemented state** of the codebase. It supersedes any prior specification documents. Do not assume intended vs. actual — read this file and then the source.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js App Router | 16.1.6 |
| React | React | 19.2.3 |
| Database | Supabase (PostgreSQL) | @supabase/supabase-js ^2.98.0 |
| Styling | Tailwind CSS | 4.x |
| Language | TypeScript | 5.9.3 |
| Font | Geist Sans / Geist Mono | 1.7.0 |
| Deployment | Vercel | — |

No middleware.ts. No Supabase Auth (JWT). Auth is Telegram initData + service-role Supabase client on the server.

---

## Directory Layout

```
/
├── app/
│   ├── globals.css              # Tailwind 4 + CSS vars (dark/light, safe-area)
│   ├── layout.tsx               # Root layout: Geist font, viewport cover, NavBar
│   ├── page.tsx                 # Home: clickers + XPBar + GoalChips + StreakBadge
│   ├── checkin/page.tsx         # Full check-in form (supports ?date= backfill)
│   ├── history/page.tsx         # Last 7 logical days list
│   ├── goals/page.tsx           # Current goals + next-version editor
│   ├── stats/page.tsx           # This week vs last week comparison
│   └── api/
│       ├── auth/telegram/route.ts   # POST: HMAC-SHA256 Telegram initData verify
│       ├── me/route.ts              # GET: upsert user, return internal UUID
│       ├── logs/route.ts            # GET/POST: daily log upsert + XP engine
│       ├── xp/route.ts             # GET: XP totals, level, streak
│       ├── stats/route.ts          # GET: week aggregates
│       ├── goals/route.ts          # GET/POST: versioned goal management
│       ├── evaluations/route.ts    # GET: daily_goal_evaluations for a date
│       └── cron/
│           ├── morning/route.ts    # GET: Telegram reminder (05:30 UTC)
│           └── evening/route.ts    # GET: Telegram reminder (20:30 UTC)
├── components/
│   ├── Clicker.tsx              # Increment/decrement widget with emoji label
│   ├── XPBar.tsx               # Level + XP progress bar
│   ├── GoalChips.tsx           # Inline chips showing goal evaluation status
│   ├── StreakBadge.tsx         # Streak count + shield indicator
│   └── NavBar.tsx              # Fixed bottom nav (5 tabs, iOS safe-area)
├── hooks/
│   └── useAuth.ts              # Telegram auth hook + apiHeaders helper
├── lib/
│   ├── supabaseServer.ts       # Service-role Supabase singleton + getUserId()
│   ├── logicalDate.ts          # Day boundary logic (05:00 offset)
│   ├── streak.ts               # Streak computation (ISO-week shield)
│   ├── xpEngine.ts             # XP award functions (all idempotent)
│   ├── defaultGoals.ts         # Creates default goal version if none exists
│   └── telegram.ts             # Telegram Mini App env detection + initData helpers
├── types/
│   └── database.ts             # TypeScript interfaces for all DB rows
├── supabase/
│   └── migrations/
│       └── 001_neurochemistry_tracker.sql  # Complete schema with RLS
├── docs/
│   └── SETUP.md                # Deployment guide
└── vercel.json                 # Cron schedules
```

---

## Database Schema

Migration file: `supabase/migrations/001_neurochemistry_tracker.sql`

### Table: `users`
```sql
id               uuid        primary key default gen_random_uuid()
telegram_user_id bigint      unique not null
created_at       timestamptz not null default now()
```
Maps Telegram user IDs to internal UUIDs. All other tables reference `users.id`.

### Table: `daily_logs`
```sql
id              uuid         primary key default gen_random_uuid()
user_id         uuid         not null references users(id) on delete cascade
date            date         not null

wake_time       time         null
sleep_time      time         null

phone_free_min  int          null  -- CHECK: in (0, 15, 30, 60)
caffeine_cups   int          not null default 0  -- CHECK: >= 0
nicotine_count  int          not null default 0  -- CHECK: >= 0
calories        int          null  -- CHECK: >= 0
protein_g       int          null  -- CHECK: >= 0
water_ml        int          not null default 0  -- CHECK: >= 0

training_type   text         not null default 'none'
                             -- CHECK: in ('none','swim','gym','home')

resting_hr      int          null  -- CHECK: 30–200 (nullable allowed)
weight_kg       numeric(5,2) null  -- CHECK: 30–300 (nullable allowed)

vitamins_adam   boolean      not null default false
magnesium       boolean      not null default false
l_theanine      boolean      not null default false
alcohol_yes     boolean      not null default false

created_at      timestamptz  not null default now()
updated_at      timestamptz  not null default now()

UNIQUE (user_id, date)
```
`updated_at` is automatically refreshed by trigger `daily_logs_updated_at` which calls `set_updated_at()`.

### Table: `goals`
```sql
id             uuid        primary key default gen_random_uuid()
user_id        uuid        not null references users(id) on delete cascade
effective_from date        not null
created_at     timestamptz not null default now()

UNIQUE (user_id, effective_from)
```
One row per goal version. To pick the active version for date D: latest `effective_from <= D`.

### Table: `goal_items`
```sql
id               uuid        primary key default gen_random_uuid()
goal_id          uuid        not null references goals(id) on delete cascade
metric_key       text        not null
operator         text        not null  -- CHECK: in ('<=', '>=', '==', 'range')
target_number    numeric     null
target_bool      boolean     null
tolerance_number numeric     null  -- fractional, e.g. 0.10 = ±10%
xp_reward        int         not null default 10
xp_cap           int         null
is_active        boolean     not null default true
```
No primary key uniqueness on `(goal_id, metric_key)` — upserts delete all items then re-insert.

**Default goal items** (created by `lib/defaultGoals.ts` on first `GET /api/goals`):

| metric_key | operator | target_number | target_bool | tolerance_number | xp_reward |
|---|---|---|---|---|---|
| nicotine_count | <= | 20 | — | — | 10 |
| caffeine_cups | <= | 2 | — | — | 10 |
| water_ml | >= | 2000 | — | — | 0 |
| protein_g | >= | 150 | — | — | 0 |
| calories | range | 2700 | — | 0.10 | 0 |
| alcohol_yes | == | — | false | — | 0 |
| vitamins_adam | == | — | true | — | 0 |
| magnesium | == | — | true | — | 0 |
| l_theanine | == | — | true | — | 0 |

### Table: `daily_goal_evaluations`
```sql
id            uuid        primary key default gen_random_uuid()
user_id       uuid        not null references users(id) on delete cascade
date          date        not null
goal_id_used  uuid        not null references goals(id)
metric_key    text        not null
actual_number numeric     null
actual_bool   boolean     null
target_number numeric     null
target_bool   boolean     null
delta_number  numeric     null      -- actual - target (numeric goals)
met           boolean     not null
xp_awarded    int         not null default 0
created_at    timestamptz not null default now()

UNIQUE (user_id, date, metric_key)
```
Written on every `POST /api/logs`. The `UNIQUE` constraint makes upserts idempotent. Past rows are never modified when goals change.

### Table: `xp_events`
```sql
id          uuid        primary key default gen_random_uuid()
user_id     uuid        not null references users(id) on delete cascade
date        date        not null
event_type  text        not null
xp          int         not null  -- CHECK: >= 0
meta        jsonb       null
created_at  timestamptz not null default now()

UNIQUE (user_id, date, event_type)
```
Idempotency is enforced by the unique constraint. All writes use `upsert(..., { ignoreDuplicates: true })`.

---

## RLS Policies

RLS is enabled on all 6 tables. **There is no Supabase Auth JWT.** All policies resolve the user via a custom PostgreSQL setting:

```sql
current_setting('app.telegram_user_id', true)
```

The API routes do **not** set this setting directly — they use the service-role client (`SUPABASE_SERVICE_ROLE_KEY`), which bypasses RLS entirely. RLS policies exist to block direct database access from unauthenticated clients.

Policy pattern (same for `daily_logs`, `goals`, `daily_goal_evaluations`, `xp_events`):
```sql
using (user_id = (
  select id from users
  where telegram_user_id = nullif(current_setting('app.telegram_user_id', true), '')::bigint
))
```

`goal_items` policy joins through `goals`:
```sql
using (goal_id in (
  select id from goals where user_id = (
    select id from users where telegram_user_id = nullif(current_setting(...), '')::bigint
  )
))
```

---

## Authentication

### Server: Telegram initData HMAC-SHA256

File: `app/api/auth/telegram/route.ts`

**POST `/api/auth/telegram`** — Body: `{ initData: string }`

Two initData formats are handled:
- **Wrapper** (from URL pass-through): `tgWebAppData=<percent-encoded>&tgWebAppVersion=...`
  → extracted via regex, single `decodeURIComponent` pass
- **Raw**: standard `query_id=...&user=...&auth_date=...&hash=...`

Verification steps:
1. Parse as URLSearchParams, extract `hash`
2. Delete `hash` from params
3. Sort remaining entries alphabetically, join as `key=value\n`
4. `secret_key = HMAC-SHA256("WebAppData", TELEGRAM_BOT_TOKEN)`
5. `computed = HMAC-SHA256(data_check_string, secret_key)` → hex
6. Timing-safe compare via `crypto.timingSafeEqual()`

Returns: `{ telegram_user_id, username, first_name, last_name }` or 401.

### Server: User Resolution

File: `lib/supabaseServer.ts`

```typescript
getSupabase()   // Lazily initialised service-role client singleton
getUserId(telegramUserId: number): Promise<string>
  // SELECT id FROM users WHERE telegram_user_id = ?
  // If not found: INSERT INTO users (telegram_user_id) and return new id
```

All API routes call `getUserId(tgId)` to resolve the internal UUID before any DB query.

### Client: Auth Hook

File: `hooks/useAuth.ts`

States: `"checking" | "authed" | "no_initdata" | "invalid_initdata" | "error"`

Fast path: if `localStorage["tg_user_id"]` and `localStorage["habby_user_id"]` exist, skip the auth roundtrip and emit `"authed"` immediately.

Slow path: retries `window.Telegram.WebApp` detection up to 10 times (200ms intervals), then calls `POST /api/auth/telegram` → `GET /api/me`, caches results in localStorage.

Helper exported from the same file:
```typescript
apiHeaders(telegramUserId: number | null): HeadersInit
// Returns { "Content-Type": "application/json", "x-telegram-user-id": "..." }
```

All page components pass `x-telegram-user-id` header to every API call. API routes read it via `req.headers.get("x-telegram-user-id")`.

---

## Logical Day Boundary

File: `lib/logicalDate.ts`

The logical day starts at **05:00** (not midnight). Every date-related operation subtracts 5 hours from UTC before extracting the date component.

```typescript
getLogicalDate(): string
  // new Date(Date.now() - 5*60*60*1000).toISOString().slice(0, 10)

getLogicalDateFor(ts: number | string): string
  // Same offset applied to a specific timestamp

isoWeek(dateStr: string): string
  // Returns "YYYY-WW" using Jan 4 anchor method (ISO 8601 weeks)

addDays(dateStr: string, n: number): string
  // Date arithmetic using T12:00:00Z to avoid DST edge cases

dateDiff(a: string, b: string): number
  // (a - b) in days, also uses T12:00:00Z
```

All API routes that involve dates call `getLogicalDate()` for "today". The client passes explicit date strings (YYYY-MM-DD) in request bodies.

---

## XP Engine

File: `lib/xpEngine.ts`

All functions take a service-role `SupabaseClient`. All XP writes use:
```typescript
sb.from("xp_events").upsert(
  { user_id, date, event_type, xp, meta },
  { onConflict: "user_id,date,event_type", ignoreDuplicates: true }
)
```

### Event Types and Amounts

| event_type | XP | Trigger condition |
|---|---|---|
| `checkin_quick` | +20 | Log saved and not "full" |
| `checkin_full` | +35 | Log saved and qualifies as full |
| `checkin_backfill` | +15 | Log date < logical today |
| `bonus_phone_free_30` | +10 | `phone_free_min >= 30` |
| `bonus_goal_caffeine` | +10 | `caffeine_cups` goal met |
| `bonus_goal_nicotine` | +10 | `nicotine_count` goal met |
| `weekly_training_YYYY-WW` | +40 | ≥2 training sessions in last 7 days |

Note: `checkin_quick` and `checkin_full` are mutually exclusive on any given date (unique constraint). `checkin_backfill` stacks with one of them.

**Full check-in criteria** (`isFull()`):
- `calories != null` AND `protein_g != null` AND `nicotine_count` defined AND `caffeine_cups` defined AND `water_ml` defined
- AND at least one of `wake_time` or `sleep_time` is non-null

**Weekly training bonus**: event_type includes the ISO week string (`weekly_training_2026-W09`). Uniqueness is `(user_id, date, event_type)` — the date is the current logical today when awarded. Multiple saves on different days in the same week can each trigger the check; the event_type being per-week means different dates would not conflict. Count is from `daily_logs` where `training_type != 'none'` in the last 7 days (`date >= today - 6`).

### Goal Evaluation (`evaluateAndPersistGoals`)

1. Find applicable goal version: latest `goals.effective_from <= date`
2. Load all `goal_items` where `is_active = true`
3. For each item, call `evaluateMetric()`:
   - `operator == "=="` + `target_bool`: boolean equality
   - `operator == "range"`: `|actual - target| <= target * tolerance`
   - `operator == "<="` or `">="`: numeric comparison
   - Special: `l_theanine` is auto-`met=true, xp_awarded=0` when `caffeine_cups == 0`
4. Upsert `daily_goal_evaluations` row (conflict on `user_id,date,metric_key`)
5. Award XP events **only for `caffeine_cups` and `nicotine_count`** goals (not vitamins, alcohol, calories, protein, water)

### XP Computation (`GET /api/xp`)

```typescript
totalXp = sum(xp_events.xp) for user
xpToday = sum where date == logicalToday
level = floor(totalXp / 500) + 1
xpIntoLevel = totalXp % 500
xpForNextLevel = 500  // constant
```

Streak is computed from `daily_logs.date` for last 30 days (not from `xp_events`).

---

## Streak Algorithm

File: `lib/streak.ts`

```typescript
computeStreak(loggedDates: string[], today: string): { streak: number, shieldActive: boolean }
```

Walks backward from `today` for up to 60 days:

1. For each day (i = 0..59), check `logged.has(date)`
2. If logged: `streak++`, continue
3. If not logged: check `shieldUsed` map for this ISO year+week key
   - If shield not yet used for this week: mark used, continue (shield consumed)
   - If in current week: set `shieldActive = true`
   - If shield already used for this week: **break** (streak ends)

`shieldActive = true` means the user's current-week shield has already been consumed (one missed day was forgiven). The streak count does not include the shielded day itself — it only counts logged days.

Input `loggedDates` comes from `daily_logs.date` filtered to the last 30 days. Only dates with an existing log row count as "logged".

---

## API Routes

All routes except `/api/auth/telegram` and `/api/cron/*` require `x-telegram-user-id` header (Telegram user ID as a number string).

### `POST /api/auth/telegram`
- Body: `{ initData: string }`
- Returns: `{ telegram_user_id, username, first_name, last_name }`
- No auth header required

### `GET /api/me`
- Returns: `{ user_id: string }` (internal UUID)

### `GET /api/logs`
- `?date=YYYY-MM-DD` → returns single log row or `null`
- `?from=YYYY-MM-DD&to=YYYY-MM-DD` → returns array ordered by date desc

### `POST /api/logs`
- Body: all `daily_logs` fields (all optional, defaults applied)
- `date` field optional (defaults to logical today)
- Validation: `date > today` → 400; `date < today - 7 days` → 400
- On success: runs XP engine (errors swallowed, don't fail the request)
- Returns: `{ log: DailyLog, xpEarned: number }`

XP engine call order on POST:
```
awardCheckinXP(sb, userId, date, today, payload)
awardBonusXP(sb, userId, date, payload)
evaluateAndPersistGoals(sb, userId, date, payload)
checkWeeklyTrainingBonus(sb, userId, today)
```

### `GET /api/xp`
- Returns: `{ totalXp, xpToday, level, xpIntoLevel, xpForNextLevel, streak, shieldActive }`

### `GET /api/goals`
- `?date=YYYY-MM-DD` (default: logical today)
- Calls `ensureDefaultGoals(sb, userId)` on every GET
- Returns: `{ id, effective_from, items: GoalItem[] }` or `null`

### `POST /api/goals`
- Body: `{ effective_from?: string, items: [{ metric_key, operator, target_number?, target_bool?, tolerance_number?, xp_reward? }] }`
- Validation: `effective_from` must be > logical today (tomorrow minimum)
- Upserts `goals` row, then deletes all old `goal_items` and re-inserts
- Returns: `{ id, effective_from, items }`

### `GET /api/evaluations`
- `?date=YYYY-MM-DD` (required)
- Returns: array of `daily_goal_evaluations` rows for that date

### `GET /api/stats`
- Returns:
  ```typescript
  {
    this_week: { days_logged, avg_nicotine, avg_caffeine, avg_calories,
                 avg_protein, avg_water, training_count, from, to },
    last_week: { /* same shape */ }
  }
  ```
- "This week" = last 7 logical days ending today
- "Last week" = 7 days before that
- Averages are `Math.round()`, null if no data for the period

### `GET /api/cron/morning` and `GET /api/cron/evening`
- Auth: `x-vercel-cron` header present OR `Authorization: Bearer <CRON_SECRET>`
- Sends Telegram `sendMessage` with inline `web_app` button to `TELEGRAM_CHAT_ID`
- Returns: `{ ok: true, period: "morning" | "evening" }`

---

## Cron Schedules

File: `vercel.json`
```json
{
  "crons": [
    { "path": "/api/cron/morning", "schedule": "30 5 * * *" },
    { "path": "/api/cron/evening", "schedule": "30 20 * * *" }
  ]
}
```

- `30 5 * * *` = 05:30 UTC ≈ 08:30 Moscow (UTC+3)
- `30 20 * * *` = 20:30 UTC ≈ 23:30 Moscow (UTC+3)

Cron only fires on Vercel production deployments.

---

## Environment Variables

### Server-only (never exposed to client bundle)
```
SUPABASE_URL                 Supabase project URL
SUPABASE_SERVICE_ROLE_KEY    Service role key (bypasses RLS)
TELEGRAM_BOT_TOKEN           Bot token from BotFather
TELEGRAM_CHAT_ID             Telegram chat ID of the single user
CRON_SECRET                  Random secret for cron endpoint auth
```

### Client-safe (must be prefixed NEXT_PUBLIC_)
```
NEXT_PUBLIC_APP_URL          Deployed app URL (used in cron reminder button)
```

`SUPABASE_ANON_KEY` is **not used** — the app uses service-role for all server operations. There is no client-side Supabase SDK usage.

---

## UI Components

### `Clicker`
Props: `label`, `value`, `unit?`, `increments: number[]`, `onAdd(n)`, `onSub?(n)`
Renders emoji label + current value + decrement/increment buttons. Decrement is disabled at 0.

### `XPBar`
Props: `totalXp`, `xpToday`, `level`, `xpIntoLevel`, `xpForNextLevel`
Renders level badge, XP today (green), total XP, and CSS progress bar.

### `GoalChips`
Props: `evaluations: DailyGoalEvaluation[]`
Renders inline chips. Green = met, muted = not met. Emoji per metric key.

### `StreakBadge`
Props: `streak`, `shieldActive`
Renders "🔥 N day streak" with optional "🛡" shield emoji.

### `NavBar`
Fixed bottom navigation: Home / Log / History / Goals / Stats.
Uses `env(safe-area-inset-bottom)` for iOS Telegram safe area.

---

## Styling Conventions

File: `app/globals.css` (Tailwind CSS 4)

CSS variables (auto dark/light via `prefers-color-scheme`):
```css
--bg-page, --bg-card, --bg-input
--text, --text-muted
--border, --input-border
--accent: #00FF85   /* neon green */
```

Safe area in root layout (`app/layout.tsx`):
```typescript
viewport: { viewportFit: "cover" }  // Next.js metadata export
```

NavBar bottom padding: `pb-[env(safe-area-inset-bottom)]`

---

## Key Conventions

- **All date strings are `YYYY-MM-DD`**, never `Date` objects passed across boundaries.
- **All times use `T12:00:00Z`** anchor when constructing `Date` objects from date strings (avoids DST off-by-one).
- **No client-side Supabase**: all DB access goes through API routes using the service-role singleton in `lib/supabaseServer.ts`.
- **XP errors are non-fatal**: `POST /api/logs` wraps the entire XP engine in try/catch and returns `xpEarned: 0` if it fails, but still returns the saved log.
- **Goal evaluation is re-run on every save**: upsert semantics on `daily_goal_evaluations` mean re-saving a day recalculates evaluations. Past evaluations are stable only once you stop editing that day.
- **Default goals are created lazily**: `ensureDefaultGoals()` runs on every `GET /api/goals`. If a goals row already exists for the user, it returns immediately (SELECT id LIMIT 1 check).
- **No penalties**: XP check is always `xp >= 0` (DB constraint). No negative XP events exist in the engine.
- **Anti-shame**: `alcohol_yes = true` is stored and evaluated against the goal, but no XP is docked. The goal evaluation just records `met: false`.

---

## Development Workflow

```bash
npm run dev     # Next.js dev server
npm run build   # Production build
npm run lint    # ESLint
```

Path alias `@/*` maps to project root (configured in `tsconfig.json`).

Supabase migrations are in `supabase/migrations/`. Apply via Supabase dashboard SQL editor or `supabase db push` if CLI is configured.

To test cron endpoints locally:
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/morning
```
