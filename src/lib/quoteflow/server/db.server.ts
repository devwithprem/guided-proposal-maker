import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { migrateWorkspaceData } from "../migrations";
import { seedData } from "../seed";
import type { WorkspaceData } from "../types";

const DEFAULT_DB_PATH = path.resolve(process.cwd(), ".data", "quoteflow.db");

let activeDbInstance: DatabaseSync | null = null;
let activeDbPath: string | null = null;

export function getDb(customPath?: string): DatabaseSync {
  const targetPath = customPath || process.env["QUOTEFLOW_DB_PATH"] || DEFAULT_DB_PATH;

  if (activeDbInstance && activeDbPath === targetPath) {
    return activeDbInstance;
  }

  if (activeDbInstance) {
    try {
      activeDbInstance.close();
    } catch {
      // ignore close errors on switch
    }
    activeDbInstance = null;
  }

  if (targetPath !== ":memory:") {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      enquiry_id TEXT NOT NULL,
      proposal_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS proposal_tokens (
      token_hash TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      enquiry_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);

  activeDbInstance = db;
  activeDbPath = targetPath;
  return db;
}

export function closeDb(): void {
  if (activeDbInstance) {
    try {
      activeDbInstance.close();
    } catch {
      // ignore
    }
    activeDbInstance = null;
    activeDbPath = null;
  }
}

export function hashPublicToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

export function generateSecureProposalToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashPublicToken(rawToken);
  return { rawToken, tokenHash };
}

export function getServerWorkspace(workspaceId = "ws_default", dbInstance?: DatabaseSync): WorkspaceData {
  const db = dbInstance ?? getDb();
  const stmt = db.prepare("SELECT data FROM workspaces WHERE id = ?");
  const row = stmt.get(workspaceId) as { data: string } | undefined;

  if (!row) {
    const initial = migrateWorkspaceData(seedData());
    const now = new Date().toISOString();
    const insert = db.prepare("INSERT INTO workspaces (id, data, updated_at) VALUES (?, ?, ?)");
    insert.run(workspaceId, JSON.stringify(initial), now);
    return initial;
  }

  try {
    const parsed = JSON.parse(row.data);
    return migrateWorkspaceData(parsed);
  } catch (err) {
    throw new Error(
      `[QuoteFlow Server] Corrupted workspace data in SQLite for '${workspaceId}': ${(err as Error).message}`,
    );
  }
}

export function updateServerWorkspace(
  updater: (current: WorkspaceData) => WorkspaceData,
  workspaceId = "ws_default",
  dbInstance?: DatabaseSync,
): WorkspaceData {
  const db = dbInstance ?? getDb();

  db.exec("BEGIN IMMEDIATE");
  try {
    const stmt = db.prepare("SELECT data FROM workspaces WHERE id = ?");
    const row = stmt.get(workspaceId) as { data: string } | undefined;

    let current: WorkspaceData;
    if (!row) {
      current = migrateWorkspaceData(seedData());
    } else {
      current = migrateWorkspaceData(JSON.parse(row.data));
    }

    const updated = updater(current);
    const now = new Date().toISOString();

    const upsert = db.prepare(`
      INSERT INTO workspaces (id, data, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `);
    upsert.run(workspaceId, JSON.stringify(updated), now);

    db.exec("COMMIT");
    return updated;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getIdempotencyRecord(
  key: string,
  dbInstance?: DatabaseSync,
): { key: string; enquiry_id: string; proposal_id?: string; created_at: string } | null {
  const db = dbInstance ?? getDb();
  const stmt = db.prepare("SELECT key, enquiry_id, proposal_id, created_at FROM idempotency_keys WHERE key = ?");
  const row = stmt.get(key) as
    | { key: string; enquiry_id: string; proposal_id?: string; created_at: string }
    | undefined;
  return row ?? null;
}

export function recordIdempotencyKey(
  key: string,
  enquiryId: string,
  proposalId?: string,
  dbInstance?: DatabaseSync,
): void {
  const db = dbInstance ?? getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO idempotency_keys (key, enquiry_id, proposal_id, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  stmt.run(key, enquiryId, proposalId ?? null, now);
}

export function recordProposalTokenMapping(
  opts: {
    tokenHash: string;
    proposalId: string;
    enquiryId: string;
    revision: number;
    expiresAt: string;
  },
  dbInstance?: DatabaseSync,
): void {
  const db = dbInstance ?? getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO proposal_tokens (token_hash, proposal_id, enquiry_id, revision, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(token_hash) DO UPDATE SET
      proposal_id = excluded.proposal_id,
      enquiry_id = excluded.enquiry_id,
      revision = excluded.revision,
      expires_at = excluded.expires_at
  `);
  stmt.run(opts.tokenHash, opts.proposalId, opts.enquiryId, opts.revision, now, opts.expiresAt);
}

export function getProposalTokenMapping(
  tokenHash: string,
  dbInstance?: DatabaseSync,
): {
  token_hash: string;
  proposal_id: string;
  enquiry_id: string;
  revision: number;
  created_at: string;
  expires_at: string;
} | null {
  const db = dbInstance ?? getDb();
  const stmt = db.prepare(
    "SELECT token_hash, proposal_id, enquiry_id, revision, created_at, expires_at FROM proposal_tokens WHERE token_hash = ?",
  );
  const row = stmt.get(tokenHash) as
    | {
        token_hash: string;
        proposal_id: string;
        enquiry_id: string;
        revision: number;
        created_at: string;
        expires_at: string;
      }
    | undefined;
  return row ?? null;
}
