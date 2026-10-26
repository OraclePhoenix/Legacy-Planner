ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_interval_days INTEGER NOT NULL DEFAULT 7 CHECK (reminder_interval_days BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS reminder_lookahead_days INTEGER NOT NULL DEFAULT 7 CHECK (reminder_lookahead_days BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ;
