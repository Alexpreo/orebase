-- migrate:up
CREATE TABLE app.users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id   text UNIQUE NOT NULL,                   -- Clerk user id, synced via webhook
  email      text,
  name       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.chats (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  title      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id    uuid NOT NULL REFERENCES app.chats(id) ON DELETE CASCADE,
  role       text NOT NULL,                          -- user | assistant | system | tool
  content    text,
  citations  jsonb,                                  -- [{"document_id":"...","page":14}]
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.watchlists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- watchlist_items reference either a project or a company (at least one).
CREATE TABLE app.watchlist_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES app.watchlists(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES core.projects(id) ON DELETE CASCADE,
  company_id   uuid REFERENCES core.companies(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT watchlist_items_target_ck CHECK (project_id IS NOT NULL OR company_id IS NOT NULL)
);

CREATE TABLE app.alerts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  criteria   jsonb NOT NULL,                         -- serialized screener/watchlist criteria
  channel    text,                                   -- email | slack | in_app
  created_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE IF EXISTS app.alerts;
DROP TABLE IF EXISTS app.watchlist_items;
DROP TABLE IF EXISTS app.watchlists;
DROP TABLE IF EXISTS app.chat_messages;
DROP TABLE IF EXISTS app.chats;
DROP TABLE IF EXISTS app.users;
