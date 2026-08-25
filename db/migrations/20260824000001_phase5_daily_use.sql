-- migrate:up
-- Phase 5: watchlist last-visit markers and event created_at for "new since last view".

ALTER TABLE app.watchlists
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

ALTER TABLE core.project_events
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

UPDATE core.project_events
   SET created_at = COALESCE(event_date::timestamptz, now())
 WHERE created_at IS NULL;

ALTER TABLE core.project_events
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE core.project_events
  ALTER COLUMN created_at SET NOT NULL;

-- migrate:down
ALTER TABLE core.project_events DROP COLUMN IF EXISTS created_at;
ALTER TABLE app.watchlists DROP COLUMN IF EXISTS last_seen_at;
