import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { getDb } from "./db.server";

export const SESSION_COOKIE_NAME = "qf_admin_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 mins
export const RATE_LIMIT_MAX_ATTEMPTS = 5;
export const GLOBAL_RATE_LIMIT_MAX = 25;
export const RATE_LIMIT_LOCKOUT_MS = 15 * 60 * 1000; // 15 mins

export function cleanupExpiredRateLimits(dbInstance?: DatabaseSync): void {
  try {
    const db = dbInstance ?? getDb();
    const now = Date.now();
    const threshold = now - RATE_LIMIT_WINDOW_MS;
    const stmt = db.prepare(`
      DELETE FROM auth_rate_limits
      WHERE (locked_until IS NOT NULL AND locked_until < ?)
         OR (locked_until IS NULL AND first_failed_at < ?)
    `);
    stmt.run(now, threshold);
  } catch {
    // ignore
  }
}

export function checkLoginRateLimit(
  scopeKey: string,
  dbInstance?: DatabaseSync,
): { allowed: boolean; retryAfterSeconds?: number | undefined } {
  const db = dbInstance ?? getDb();
  cleanupExpiredRateLimits(db);

  const now = Date.now();
  const stmt = db.prepare(
    "SELECT scope_key, failed_count, first_failed_at, locked_until FROM auth_rate_limits WHERE scope_key IN (?, 'global_admin_login')",
  );
  const rows = stmt.all(scopeKey) as Array<{
    scope_key: string;
    failed_count: number;
    first_failed_at: number;
    locked_until: number | null;
  }>;

  for (const row of rows) {
    if (row.locked_until && row.locked_until > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((row.locked_until - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
  }

  return { allowed: true };
}

export function recordFailedLoginAttempt(
  scopeKey: string,
  dbInstance?: DatabaseSync,
): { locked: boolean; failedCount: number; retryAfterSeconds?: number | undefined } {
  const db = dbInstance ?? getDb();
  const now = Date.now();

  const recordForScope = (targetKey: string, maxAttempts: number) => {
    const select = db.prepare(
      "SELECT failed_count, first_failed_at, locked_until FROM auth_rate_limits WHERE scope_key = ?",
    );
    const row = select.get(targetKey) as
      | { failed_count: number; first_failed_at: number; locked_until: number | null }
      | undefined;

    let newCount = 1;
    let firstFailedAt = now;
    let lockedUntil: number | null = null;

    if (row) {
      if (now - row.first_failed_at < RATE_LIMIT_WINDOW_MS) {
        newCount = row.failed_count + 1;
        firstFailedAt = row.first_failed_at;
      } else {
        newCount = 1;
        firstFailedAt = now;
      }
    }

    if (newCount >= maxAttempts) {
      lockedUntil = now + RATE_LIMIT_LOCKOUT_MS;
    }

    const upsert = db.prepare(`
      INSERT INTO auth_rate_limits (scope_key, failed_count, first_failed_at, locked_until)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET
        failed_count = excluded.failed_count,
        first_failed_at = excluded.first_failed_at,
        locked_until = excluded.locked_until
    `);
    upsert.run(targetKey, newCount, firstFailedAt, lockedUntil);

    return { locked: lockedUntil !== null, failedCount: newCount, lockedUntil };
  };

  const scopeRes = recordForScope(scopeKey, RATE_LIMIT_MAX_ATTEMPTS);
  recordForScope("global_admin_login", GLOBAL_RATE_LIMIT_MAX);

  const retryAfterSeconds = scopeRes.lockedUntil
    ? Math.max(1, Math.ceil((scopeRes.lockedUntil - now) / 1000))
    : undefined;
  return {
    locked: scopeRes.locked,
    failedCount: scopeRes.failedCount,
    retryAfterSeconds,
  };
}

export function clearLoginRateLimit(scopeKey: string, dbInstance?: DatabaseSync): void {
  try {
    const db = dbInstance ?? getDb();
    const stmt = db.prepare("DELETE FROM auth_rate_limits WHERE scope_key = ?");
    stmt.run(scopeKey);
  } catch {
    // ignore
  }
}


let envFilesLoaded = false;

export function loadEnvFiles(force = false): void {
  if ((envFilesLoaded && !force) || process.env["VITEST"]) {
    return;
  }
  envFilesLoaded = true;
  // If already set in process.env, nothing to do
  if (process.env["QUOTEFLOW_ADMIN_PASSCODE"] && process.env["QUOTEFLOW_SESSION_SECRET"]) {
    return;
  }
  // Try loading via Node's native process.loadEnvFile if available
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // ignore
    }
    try {
      process.loadEnvFile(".env");
    } catch {
      // ignore
    }
  }
}

export function isAuthConfigured(): boolean {
  loadEnvFiles();
  const code = process.env["QUOTEFLOW_ADMIN_PASSCODE"];
  const secret = process.env["QUOTEFLOW_SESSION_SECRET"];
  return Boolean(code && code.trim().length > 0 && secret && secret.trim().length > 0);
}

function getAdminPasscode(): string {
  loadEnvFiles();
  const code = process.env["QUOTEFLOW_ADMIN_PASSCODE"];
  if (code && code.trim().length > 0) {
    return code.trim();
  }
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "[QuoteFlow Auth] QUOTEFLOW_ADMIN_PASSCODE environment variable must be set in production.",
    );
  }
  return "";
}

function getSessionSecret(): string {
  loadEnvFiles();
  const secret = process.env["QUOTEFLOW_SESSION_SECRET"];
  if (secret && secret.trim().length > 0) {
    return secret.trim();
  }
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "[QuoteFlow Auth] QUOTEFLOW_SESSION_SECRET environment variable must be set in production.",
    );
  }
  return "";
}

function signSession(data: string): string {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error(
      "[QuoteFlow Auth] QUOTEFLOW_SESSION_SECRET environment variable is not configured.",
    );
  }
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

export function verifyAdminPasscode(passcode: string): boolean {
  if (!passcode || typeof passcode !== "string") return false;
  const expected = getAdminPasscode();
  if (!expected) return false;
  const bufA = Buffer.from(passcode.trim());
  const bufB = Buffer.from(expected);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createAdminSessionToken(): string {
  const timestamp = Date.now().toString();
  const signature = signSession(timestamp);
  return `${timestamp}.${signature}`;
}

export function verifyAdminSessionToken(token: string | undefined | null): boolean {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const timestampStr = parts[0];
  const signature = parts[1];
  if (!timestampStr || !signature) return false;

  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp)) return false;

  // Check expiration (7 days)
  if (Date.now() - timestamp > SESSION_MAX_AGE_SECONDS * 1000) {
    return false;
  }

  const expectedSignature = signSession(timestampStr);
  const bufA = Buffer.from(signature);
  const bufB = Buffer.from(expectedSignature);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function requireAdminSession(tokenOrCookieHeader?: string | null): void {
  let token = tokenOrCookieHeader;
  if (token === undefined) {
    try {
      token = getCookie(SESSION_COOKIE_NAME);
    } catch {
      token = undefined;
    }
  }

  if (!verifyAdminSessionToken(token)) {
    throw new Error("UNAUTHORIZED: Valid administrator session required.");
  }
}

export function setAdminSessionCookie(token: string): void {
  try {
    setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  } catch {
    // Graceful fallback for direct testing
  }
}

export function clearAdminSessionCookie(): void {
  try {
    deleteCookie(SESSION_COOKIE_NAME, {
      path: "/",
    });
  } catch {
    // Graceful fallback
  }
}
