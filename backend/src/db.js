const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  google_id TEXT,
  avatar TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canvases (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nodes (
  id UUID PRIMARY KEY,
  canvas_id UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  x DOUBLE PRECISION NOT NULL DEFAULT 0,
  y DOUBLE PRECISION NOT NULL DEFAULT 0,
  depth INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_canvas_id UUID REFERENCES canvases(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edges (
  id UUID PRIMARY KEY,
  canvas_id UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  canvas_id UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  extracted_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'uploaded',
  applied_action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS node_chats (
  id UUID PRIMARY KEY,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'You',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canvas_chats (
  id UUID PRIMARY KEY,
  canvas_id UUID NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'You',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nodes_canvas ON nodes(canvas_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_node_chats_node ON node_chats(node_id);
CREATE INDEX IF NOT EXISTS idx_canvas_chats_canvas ON canvas_chats(canvas_id);
CREATE INDEX IF NOT EXISTS idx_edges_canvas ON edges(canvas_id);
CREATE INDEX IF NOT EXISTS idx_attachments_node ON attachments(node_id);
CREATE INDEX IF NOT EXISTS idx_categories_owner ON categories(owner_id);
CREATE INDEX IF NOT EXISTS idx_feedback_owner ON feedback(owner_id);
`;

async function initSchema() {
  await pool.query(SCHEMA);
  // Migration for databases created before the linked_canvas_id column existed.
  await pool.query(
    `ALTER TABLE nodes ADD COLUMN IF NOT EXISTS linked_canvas_id UUID REFERENCES canvases(id) ON DELETE SET NULL`
  );
  // Migration for databases created before user accounts / ownership existed.
  await pool.query(
    `ALTER TABLE canvases ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE CASCADE`
  );
  // Migration for owned-but-public canvases (public no longer requires dropping ownership).
  await pool.query(
    `ALTER TABLE canvases ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false`
  );
  // Migration for canvas categories ("tabs"). The column is added here (rather than in
  // the base schema) so pre-existing databases are upgraded without a full rebuild.
  await pool.query(
    `ALTER TABLE canvases ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_canvases_category ON canvases(category_id)`
  );
}

const query = (text, params) => pool.query(text, params);

module.exports = { pool, initSchema, query };
