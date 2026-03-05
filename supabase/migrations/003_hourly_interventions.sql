-- Migration 003: Hourly intervention system enhancements
-- Adds response tracking columns to interventions table and a performance index.

-- Track whether the user responded to a callback button and what they tapped.
ALTER TABLE interventions
  ADD COLUMN IF NOT EXISTS responded_at  timestamptz,
  ADD COLUMN IF NOT EXISTS response_data text;   -- stores raw callback_data string, e.g. "log_water:500"

-- Fast cooldown lookup: "did we already send trigger X in the last N hours?"
-- Used by the hourly cron to skip rules that are within their cooldown window.
CREATE INDEX IF NOT EXISTS interventions_user_trigger_created
  ON interventions (user_id, trigger_type, created_at DESC);
