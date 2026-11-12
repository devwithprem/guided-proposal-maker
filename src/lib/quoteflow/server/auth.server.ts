import crypto from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";

export const SESSION_COOKIE_NAME = "qf_admin_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getAdminPasscode(): string {
  const code = process.env["QUOTEFLOW_ADMIN_PASSCODE"];
  if (code && code.trim().length > 0) {
    return code.trim();
  }
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "[QuoteFlow Auth] QUOTEFLOW_ADMIN_PASSCODE environment variable must be set in production.",
    );
  }
  return "admin123";
}

function getSessionSecret(): string {
  const secret = process.env["QUOTEFLOW_SESSION_SECRET"];
  if (secret && secret.trim().length > 0) {
    return secret.trim();
  }
  return "quoteflow-dev-secret-do-not-use-in-production";
}

function signSession(data: string): string {
  const secret = getSessionSecret();
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

export function verifyAdminPasscode(passcode: string): boolean {
  if (!passcode || typeof passcode !== "string") return false;
  const expected = getAdminPasscode();
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
