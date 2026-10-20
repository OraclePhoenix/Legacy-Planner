-- Emergency contacts ("trustees"): people with their own accounts whom an
-- owner trusts to report that something has happened or to confirm a send.
CREATE TABLE IF NOT EXISTS trustees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  trustee_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'declined')),
  can_report BOOLEAN NOT NULL DEFAULT true,
  can_confirm BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, email)
);
CREATE INDEX IF NOT EXISTS trustees_email_idx ON trustees(lower(email));
CREATE INDEX IF NOT EXISTS trustees_trustee_idx ON trustees(trustee_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS require_trustee_confirmation BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE activations ADD COLUMN IF NOT EXISTS reported_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE activations DROP CONSTRAINT IF EXISTS activations_source_check;
ALTER TABLE activations ADD CONSTRAINT activations_source_check
  CHECK (source IN ('manual', 'inactivity', 'trustee'));

ALTER TABLE activations DROP CONSTRAINT IF EXISTS activations_status_check;
ALTER TABLE activations ADD CONSTRAINT activations_status_check CHECK (status IN
  ('checkin_pending', 'awaiting_admin', 'awaiting_trustee', 'scheduled', 'dispatching', 'sent', 'failed', 'cancelled'));

DROP INDEX IF EXISTS activations_one_open_per_user;
CREATE UNIQUE INDEX activations_one_open_per_user
  ON activations(user_id)
  WHERE status IN ('checkin_pending', 'awaiting_admin', 'awaiting_trustee', 'scheduled', 'dispatching');
