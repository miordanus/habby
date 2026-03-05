-- ============================================================
-- 003 Extended event types — bridge legacy log fields to events
-- ============================================================
-- Adds 8 new event types that cover fields previously only tracked
-- in daily_logs: calories, protein, training, phone-free time,
-- weight, resting HR, and wake/sleep times.
-- These enable POST /api/logs to dual-write to the events table
-- and GET /api/logs to reconstruct DailyLog from the event stream.

-- Drop the old constraint and recreate with the full set of types.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;

ALTER TABLE events ADD CONSTRAINT events_type_check CHECK (type IN (
  -- original 11 types
  'nicotine', 'coffee_cup', 'water_ml',
  'vitamins_adam', 'magnesium', 'l_theanine',
  'workout', 'alcohol_yes',
  'self_rating_energy', 'self_rating_focus', 'self_rating_stress',
  -- new aggregate types (latest-value-wins semantics in aggregateDay)
  'calories_kcal',      -- value: kcal total (number)
  'protein_g',          -- value: grams (number)
  'training_session',   -- value_text: 'swim'|'gym'|'home'
  'phone_free_min',     -- value: 0|15|30|60
  'weight_kg',          -- value: kg (number)
  'resting_hr_manual',  -- value: bpm (number) — manual entry alongside health_samples
  'wake_time',          -- value_text: 'HH:MM'
  'sleep_time'          -- value_text: 'HH:MM'
));
