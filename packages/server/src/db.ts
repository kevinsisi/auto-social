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
  `)
}
