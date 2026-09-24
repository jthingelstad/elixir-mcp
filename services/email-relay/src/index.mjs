/** Lambda entrypoint: the non-VPC relay — sends mail over SES from the
 *  outbox and enrolls opted-in sign-ins with Buttondown. */

import { createHash } from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { makeSesSender } from "./ses.mjs";
import { makeHandler } from "./handler.mjs";

/** Buttondown answers 400 for both "you already have this address" and
 *  "this request is wrong". Treating the whole status as success (as we
 *  did) made a validation error or a schema change look like a healthy
 *  enrollment, and nothing anywhere would say otherwise. Read the code:
 *  an existing address is the benign one, everything else throws so it
 *  lands in the log. Unrecognised shapes throw too — a mystery 400 is
 *  worth a log line, and enrollment is best-effort either way. */
const BUTTONDOWN_EXISTS_CODES = new Set([
  "email_already_exists",
  "subscriber_already_exists",
  "duplicate",
]);

async function buttondownExists(res) {
  let body;
  try {
    body = await res.json();
  } catch {
    return false;
  }
  const code = String(body?.code ?? "");
  if (BUTTONDOWN_EXISTS_CODES.has(code)) return true;
  // Buttondown has moved this wording before; the code is the contract
  // and this is only a backstop for a renamed one.
  return /already\s+(exists|subscribed)/i.test(`${code} ${body?.detail ?? ""}`);
}

/** Buttondown enrollment (Jamie, 2026-09-05 — Drop's mailing-list
 *  model, written fresh with services/api/src/buttondown.ts open):
 *  idempotent POST. An EXISTING address — including an unsubscribed one
 *  — is left untouched, so an unsubscribe is never overridden. Only a
 *  login whose account opted in ever reaches here (issue #27).
 *  Newsletter selection rides the token (set BUTTONDOWN_NEWSLETTER_ID
 *  only for a multi-newsletter key). */
export function makeButtondownEnroller({
  token,
  newsletterId = null,
  fetchImpl = fetch,
}) {
  if (!token) return null;
  return async (email) => {
    const idem = createHash("sha256").update(email.toLowerCase()).digest("hex");
    const res = await fetchImpl("https://api.buttondown.com/v1/subscribers", {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "elixir-mcp-relay",
        "X-Idempotency-Key": `elixir-mcp-login-${idem}`,
        ...(newsletterId ? { "Buttondown-Context": newsletterId } : {}),
      },
      body: JSON.stringify({
        email_address: email,
        type: "regular",
        metadata: { source: "elixir-mcp-login" },
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) return;
    if (res.status === 400 && (await buttondownExists(res))) return;
    throw new Error(`buttondown ${res.status}`);
  };
}

const s3 = new S3Client({});

export const handler = makeHandler({
  send: makeSesSender({
    fromEmail: process.env.FROM_EMAIL ?? "elixir@poapkings.com",
    configurationSet: process.env.SES_CONFIGURATION_SET ?? "elixir-mcp",
  }),
  readObject: async ({ bucket, key }) => {
    try {
      const out = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return await out.Body.transformToString();
    } catch (err) {
      if (err?.name === "NoSuchKey") return null;
      throw err;
    }
  },
  deleteObject: ({ bucket, key }) =>
    s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
  enroll: makeButtondownEnroller({
    token: process.env.BUTTONDOWN_API_TOKEN,
    newsletterId: process.env.BUTTONDOWN_NEWSLETTER_ID || null,
  }),
});
