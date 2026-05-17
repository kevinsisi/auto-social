import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type AppDatabase = Database.Database

export function openDatabase(filename = process.env.AUTO_SOCIAL_DB ?? 'data/auto-social.db') {
  const dbPath = resolve(filename)
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  migrate(db)
  return db
}

export function openMemoryDatabase() {
  const db = new Database(':memory:')
  migrate(db)
  return db
}

export function migrate(db: AppDatabase) {
  db.exec(`
    -- Legacy MVP tables (preserved for back-compat; new pipeline does not write here)
    CREATE TABLE IF NOT EXISTS patrol_cards (
      id TEXT PRIMARY KEY,
      keyword TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patrol_runs (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES patrol_cards(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES patrol_cards(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES patrol_runs(id) ON DELETE SET NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(card_id, url)
    );

    CREATE TABLE IF NOT EXISTS analyses (
      candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      worth_replying INTEGER NOT NULL,
      reply_angle TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      risk_note TEXT NOT NULL,
      image_idea TEXT NOT NULL,
      meme_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reply_suggestions (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      tone TEXT NOT NULL,
      label TEXT NOT NULL,
      text TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      risk_note TEXT NOT NULL
    );

    -- v1.0.0 social patrol station tables
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voice_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      axes_json TEXT NOT NULL,
      no_go_zones_json TEXT NOT NULL,
      admired_accounts_json TEXT NOT NULL,
      self_descriptors_json TEXT NOT NULL,
      signature_phrases_json TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'zh-TW',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voice_feedback (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      variant_idx INTEGER NOT NULL,
      decision TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trend_candidates (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE,
      card_id TEXT REFERENCES patrol_cards(id) ON DELETE SET NULL,
      is_trending INTEGER NOT NULL DEFAULT 0,
      url TEXT NOT NULL,
      author TEXT,
      title TEXT,
      text TEXT NOT NULL,
      published_at TEXT,
      engagement_json TEXT,
      fetched_at TEXT NOT NULL,
      pipeline_status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE INDEX IF NOT EXISTS idx_trend_candidates_status ON trend_candidates(pipeline_status, fetched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trend_candidates_card ON trend_candidates(card_id, fetched_at DESC);

    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES trend_candidates(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      classify_json TEXT,
      score_json TEXT,
      variants_json TEXT,
      meme_json TEXT,
      chosen_variant_idx INTEGER,
      final_text TEXT,
      published_url TEXT,
      last_error_reason TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      published_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS threads_session (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      storage_state_ciphertext BLOB NOT NULL,
      salt BLOB NOT NULL,
      iv BLOB NOT NULL,
      auth_tag BLOB NOT NULL,
      bound_handle TEXT,
      last_login_at TEXT NOT NULL,
      healthy INTEGER NOT NULL DEFAULT 1,
      health_note TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_quotas (
      op TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (op, date)
    );

    CREATE TABLE IF NOT EXISTS scan_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      sources_summary_json TEXT,
      candidates_added INTEGER NOT NULL DEFAULT 0,
      drafts_produced INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_scan_runs_started ON scan_runs(started_at DESC);

    -- ai-core key pool schema (compatible with SqliteAdapter.createTable shape)
    CREATE TABLE IF NOT EXISTS api_keys (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      key           TEXT    NOT NULL UNIQUE,
      is_active     INTEGER NOT NULL DEFAULT 1,
      cooldown_until INTEGER NOT NULL DEFAULT 0,
      lease_until   INTEGER NOT NULL DEFAULT 0,
      lease_token   TEXT,
      usage_count   INTEGER NOT NULL DEFAULT 0
    );
  `)

  ensureColumns(db, 'trend_candidates', [
    { name: 'classify_json', type: 'TEXT' },
    { name: 'sponsored_json', type: 'TEXT' },
    { name: 'scam_json', type: 'TEXT' },
    { name: 'score_json', type: 'TEXT' },
    { name: 'draft_variants_json', type: 'TEXT' },
    { name: 'pipeline_error', type: 'TEXT' },
    { name: 'pipeline_completed_at', type: 'TEXT' },
    { name: 'images_json', type: 'TEXT' },
    { name: 'videos_json', type: 'TEXT' },
    { name: 'image_analysis_json', type: 'TEXT' }
  ])

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_drafts (
      id TEXT PRIMARY KEY,
      seed_keyword TEXT,
      seed_topic TEXT,
      angle TEXT,
      text TEXT NOT NULL,
      image_prompt TEXT,
      image_path TEXT,
      image_provider TEXT,
      image_error TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      decided_at TEXT,
      posted_at TEXT,
      posted_url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_post_drafts_status ON post_drafts(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS ai_tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 5,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      enqueued_at TEXT NOT NULL,
      claimed_at TEXT,
      completed_at TEXT,
      result_json TEXT,
      error TEXT,
      next_retry_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ai_tasks_pickable ON ai_tasks(status, priority, enqueued_at);
    CREATE INDEX IF NOT EXISTS idx_ai_tasks_type ON ai_tasks(type, status);

    CREATE TABLE IF NOT EXISTS reply_attempts (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES patrol_cards(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES trend_candidates(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES ai_tasks(id) ON DELETE SET NULL,
      target_url TEXT NOT NULL,
      reply_text TEXT NOT NULL,
      bound_handle TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      verification_method TEXT,
      reply_url TEXT,
      error TEXT,
      screenshot_path TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reply_attempts_candidate_created ON reply_attempts(candidate_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_attempts_one_success ON reply_attempts(candidate_id) WHERE status = 'succeeded';

    CREATE TABLE IF NOT EXISTS threads_search_cache (
      keyword TEXT PRIMARY KEY,
      outcome_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads_search_provider_cooldowns (
      provider TEXT PRIMARY KEY,
      blocked_until TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

function ensureColumns(db: AppDatabase, table: string, columns: Array<{ name: string; type: string }>) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  const have = new Set(existing.map((row) => row.name))
  for (const col of columns) {
    if (!have.has(col.name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`)
    }
  }
}
