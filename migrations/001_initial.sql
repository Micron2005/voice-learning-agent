PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS operators (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES operators(id), kind TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)), created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS records_owner_kind ON records(owner, kind, created);
CREATE TRIGGER IF NOT EXISTS immutable_drafts BEFORE UPDATE ON records WHEN OLD.kind = 'draft'
BEGIN SELECT RAISE(ABORT, 'Call drafts are immutable'); END;
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES operators(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES operators(id), kind TEXT NOT NULL, target TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', lease INTEGER NOT NULL DEFAULT 0, error TEXT, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_clients (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE IF NOT EXISTS oauth_codes (hash TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_tokens (hash TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES operators(id), scopes TEXT NOT NULL, resource TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS provider_events (id TEXT PRIMARY KEY, received INTEGER NOT NULL, kind TEXT NOT NULL);
PRAGMA user_version = 1;
