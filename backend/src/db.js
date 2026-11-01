const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS canvases (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

CREATE INDEX IF NOT EXISTS idx_nodes_canvas ON nodes(canvas_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_node_chats_node ON node_chats(node_id);
CREATE INDEX IF NOT EXISTS idx_edges_canvas ON edges(canvas_id);
CREATE INDEX IF NOT EXISTS idx_attachments_node ON attachments(node_id);
`;

async function initSchema() {
  await pool.query(SCHEMA);
  // Migration for databases created before the linked_canvas_id column existed.
  await pool.query(
    `ALTER TABLE nodes ADD COLUMN IF NOT EXISTS linked_canvas_id UUID REFERENCES canvases(id) ON DELETE SET NULL`
  );
}

const query = (text, params) => pool.query(text, params);

module.exports = { pool, initSchema, query };
