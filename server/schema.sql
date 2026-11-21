CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at bigint NOT NULL,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS levels (
  key text PRIMARY KEY,
  author_id uuid REFERENCES players(id),
  source text NOT NULL CHECK (source IN ('official', 'community')),
  puzzle jsonb NOT NULL,
  published_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS levels_author ON levels(author_id, published_at DESC);
ALTER TABLE levels ADD COLUMN IF NOT EXISTS deleted_at bigint;
ALTER TABLE levels ADD COLUMN IF NOT EXISTS author_sequence integer;
ALTER TABLE levels ADD COLUMN IF NOT EXISTS featured_at bigint;
WITH existing AS (
  SELECT author_id,COALESCE(max(author_sequence),0) AS last FROM levels WHERE source='community' GROUP BY author_id
), missing AS (
  SELECT key,(existing.last+row_number() OVER (PARTITION BY l.author_id ORDER BY published_at,key))::integer AS sequence
  FROM levels l JOIN existing ON existing.author_id=l.author_id WHERE source='community' AND author_sequence IS NULL
)
UPDATE levels SET author_sequence=missing.sequence FROM missing WHERE levels.key=missing.key;
CREATE UNIQUE INDEX IF NOT EXISTS levels_author_sequence ON levels(author_id,author_sequence) WHERE source='community';
CREATE TABLE IF NOT EXISTS progress (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  level_key text NOT NULL REFERENCES levels(key),
  moves jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at bigint NOT NULL,
  PRIMARY KEY(player_id, level_key)
);
ALTER TABLE progress ADD COLUMN IF NOT EXISTS assisted boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS completions (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  level_key text NOT NULL REFERENCES levels(key),
  moves jsonb NOT NULL,
  assisted boolean NOT NULL DEFAULT false,
  completed_at bigint NOT NULL,
  PRIMARY KEY(player_id, level_key)
);
CREATE TABLE IF NOT EXISTS drafts (
  player_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  puzzle jsonb,
  revision integer NOT NULL DEFAULT 1,
  updated_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  level_key text NOT NULL REFERENCES levels(key),
  score text NOT NULL,
  moves jsonb NOT NULL,
  achieved_at bigint NOT NULL,
  UNIQUE(player_id, level_key)
);
CREATE INDEX IF NOT EXISTS records_level ON records(level_key);
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  suffix text NOT NULL,
  created_at bigint NOT NULL,
  last_used_at bigint,
  revoked_at bigint
);
CREATE INDEX IF NOT EXISTS api_keys_player ON api_keys(player_id,created_at DESC);
CREATE TABLE IF NOT EXISTS ai_runs (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  creation_request_id text NOT NULL,
  level_key text NOT NULL REFERENCES levels(key),
  puzzle jsonb NOT NULL,
  level_hash text NOT NULL,
  state jsonb NOT NULL,
  moves jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  UNIQUE(player_id,creation_request_id)
);
CREATE INDEX IF NOT EXISTS ai_runs_expiry ON ai_runs(expires_at);
CREATE TABLE IF NOT EXISTS ai_run_requests (
  run_id uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY(run_id,request_id)
);
