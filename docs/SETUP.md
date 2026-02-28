# habby — Setup Guide

> Neurochemistry Performance Tracker — Telegram Mini App

---

## 1. Supabase project

The project is already created: **`sfzyqdpckgyznuhunygj`** (region: eu-west-1).

If you need a fresh project:
1. Go to [supabase.com](https://supabase.com) → New project
2. Name it `habby`, pick a region close to you
3. Save the database password somewhere safe

---

## 2. Apply the SQL migration

Open the Supabase dashboard → **SQL Editor** → New query.

Paste the contents of `supabase/migrations/001_neurochemistry_tracker.sql` and click **Run**.

This creates:
- `users` — maps Telegram user ID to internal UUID
- `daily_logs` — daily tracking data
- `goals` + `goal_items` — versioned goal contracts
- `daily_goal_evaluations` — per-day evaluation snapshots (immutable history)
- `xp_events` — idempotent XP ledger

### Verify tables were created

```sql
select table_name, rls_enabled
from information_schema.tables t
join pg_class c on c.relname = t.table_name
where table_schema = 'public'
  and table_name in ('users','daily_logs','goals','goal_items','daily_goal_evaluations','xp_events');
```

### Verify RLS is enabled

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('users','daily_logs','goals','goal_items','daily_goal_evaluations','xp_events');
-- All should show rowsecurity = true
```

---

## 3. Environment variables

### 3a. Local development (`.env.local`)

Create this file in the repo root (never commit it):

```bash
# Supabase
SUPABASE_URL=https://sfzyqdpckgyznuhunygj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<get from Supabase → Settings → API → service_role>

# Telegram Bot
TELEGRAM_BOT_TOKEN=<your bot token from @BotFather>
TELEGRAM_CHAT_ID=<your Telegram user chat ID — see section 6>

# Cron security
CRON_SECRET=<generate: openssl rand -hex 32>

# App URL (for cron reminder button)
NEXT_PUBLIC_APP_URL=https://your-vercel-domain.vercel.app
```

### 3b. Vercel (production)

In Vercel dashboard → your project → **Settings → Environment Variables**, add:

| Variable | Value | Environment |
|---|---|---|
| `SUPABASE_URL` | `https://sfzyqdpckgyznuhunygj.supabase.co` | Production, Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (service role key) | Production only |
| `TELEGRAM_BOT_TOKEN` | `123456:ABC...` | Production |
| `TELEGRAM_CHAT_ID` | `123456789` | Production |
| `CRON_SECRET` | `<random hex>` | Production |
| `NEXT_PUBLIC_APP_URL` | `https://habby.vercel.app` | Production |

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never prefix it with `NEXT_PUBLIC_`. It must NOT appear in client bundles.

---

## 4. Telegram Bot setup

### Create the bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram
2. `/newbot` → name it (e.g. "habby") → get the token
3. `/setmenubutton` → set the Web App URL to your Vercel deployment URL
4. `/setdomain` → add your Vercel domain (e.g. `habby.vercel.app`)

### Configure Mini App

In BotFather:
```
/newapp → select your bot → add web app URL
```

---

## 5. Get your Telegram Chat ID

The safest way:

1. Send any message to your bot
2. Open in browser: `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Find `"chat": {"id": 123456789}` — that number is your `TELEGRAM_CHAT_ID`

Or use [@userinfobot](https://t.me/userinfobot) — it tells you your ID instantly.

---

## 6. Vercel Cron schedules

The `vercel.json` in the repo configures two cron jobs:

```json
{
  "crons": [
    { "path": "/api/cron/morning", "schedule": "30 5 * * *" },
    { "path": "/api/cron/evening", "schedule": "30 20 * * *" }
  ]
}
```

**Current schedule (UTC):**
- Morning: `30 5 * * *` = 05:30 UTC = **08:30 MSK** (UTC+3)
- Evening: `30 20 * * *` = 20:30 UTC = **23:30 MSK** (UTC+3)

**To adjust for your timezone**, calculate UTC offset and update `vercel.json`:
- UTC+0: `30 8 * * *` and `30 23 * * *`
- UTC+3 (MSK): `30 5 * * *` and `30 20 * * *` ← current
- UTC+5 (EKT): `30 3 * * *` and `30 18 * * *`

Vercel Cron requires a **Pro** or **Hobby** plan. Cron is only active on Production deployments.

### Test a cron endpoint manually

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://habby.vercel.app/api/cron/morning
```

Expected response: `{"ok":true,"period":"morning"}`

---

## 7. Deploy to Vercel

```bash
# Install Vercel CLI (optional)
npm i -g vercel

# Deploy
vercel --prod

# Or just push to main branch if connected to Vercel Git integration
git push origin main
```

---

## 8. Verification checklist

### Auth
- [ ] Open the mini app from Telegram (mobile)
- [ ] App loads without "Open from Telegram" error
- [ ] Check Vercel logs — no 401 on `/api/me`

### RLS (security)
```sql
-- Verify no anonymous access to daily_logs
-- (should return 0 rows when run as anon user)
select count(*) from daily_logs;
```
With service role this returns all rows (expected). With anon key it should return 0.

### XP idempotency
1. Save a check-in
2. Note the XP displayed
3. Save again (same day)
4. XP should NOT increase — same events, unique constraint blocks duplicates

### Logical day boundary
- At 04:59 local time → should show yesterday's date
- At 05:01 local time → should show today's date
- Test by checking what date appears in the home header

### Backfill
- Go to History → tap a date 3 days ago
- Submit check-in → verify `+15 XP` backfill bonus appears
- Try to edit a date 8 days ago → should be blocked by API (`400 Backfill window is 7 days`)

### Goals future-only
- Go to Goals → Edit Next Goals
- Try setting effective_from to today → validation message appears
- Set to tomorrow → saves successfully

### Cron reminders
- Trigger manually with curl (see above)
- Telegram bot should send a message with "Open habby" button
- Button opens the mini app

### iOS Telegram safe-area
- Open on iPhone in Telegram
- Header should not overlap the status bar
- Bottom nav should not be clipped by the home indicator

### No service_role in client bundle
```bash
npm run build
grep -r "service_role" .next/static/ || echo "Clean ✓"
```

---

## 9. Day-to-day operations

### Checking logs
Supabase dashboard → **Table Editor** → select `daily_logs`

### Monitoring XP
```sql
select date, event_type, xp
from xp_events
where user_id = (select id from users limit 1)
order by created_at desc
limit 20;
```

### Resetting for testing
```sql
-- Delete all data for your user (CAREFUL — irreversible)
delete from xp_events where user_id = (select id from users limit 1);
delete from daily_goal_evaluations where user_id = (select id from users limit 1);
delete from daily_logs where user_id = (select id from users limit 1);
```

---

## 10. Architecture notes

| Layer | Pattern |
|---|---|
| Auth | Telegram `initData` → HMAC-SHA256 verified server-side |
| User identity | `telegram_user_id` → internal UUID in `users` table |
| API | Next.js App Router API routes + service role key |
| RLS | Enabled on all tables; service role bypasses for internal ops |
| XP | Idempotent via `unique(user_id, date, event_type)` |
| Goals | Versioned; `effective_from` gate prevents retro edits |
| Streak | Computed in-memory from last 30 days; 1 shield miss per ISO week |
| Logical day | `now() - 5 hours` → boundary at 05:00 local |
