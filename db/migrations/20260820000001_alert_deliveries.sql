-- migrate:up
-- Idempotent email (and later Slack) deliveries for watchlist project_events.
CREATE TABLE app.alert_deliveries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id   uuid NOT NULL REFERENCES app.alerts(id) ON DELETE CASCADE,
  event_id   uuid NOT NULL REFERENCES core.project_events(id) ON DELETE CASCADE,
  channel    text NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, event_id, channel)
);

CREATE INDEX alert_deliveries_event_id_idx ON app.alert_deliveries (event_id);

-- migrate:down
DROP INDEX IF EXISTS app.alert_deliveries_event_id_idx;
DROP TABLE IF EXISTS app.alert_deliveries;
