/**
 * Credential primitives (librarian's magic-link.mts pattern, written
 * fresh). Brute force on the 6-digit code is handled by the attempt cap
 * on the pending row, not by code entropy — six digits exist so Apple
 * Mail's code detection and one-time-code autofill engage.
 */

import crypto from "node:crypto";

export const MAGIC_TTL_SECONDS = 15 * 60;
const MAGIC_TOKEN_RE = /^[A-Za-z0-9_-]{32,256}$/;
const MAGIC_CODE_RE = /^[0-9]{6}$/;

export function normalizeEmail(email) {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

export function emailHash(email) {
  return crypto
    .createHash("sha256")
    .update(normalizeEmail(email))
    .digest("hex");
}

export function sha256hex(value) {
  return crypto
    .createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}

export function createMagicToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function validMagicToken(token) {
  const value = String(token ?? "").trim();
  return MAGIC_TOKEN_RE.test(value) ? value : "";
}

export function createMagicCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function validMagicCode(code) {
  const value = String(code ?? "")
    .replace(/[^0-9]/g, "")
    .trim();
  return MAGIC_CODE_RE.test(value) ? value : "";
}

export function timingSafeEqualHex(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
