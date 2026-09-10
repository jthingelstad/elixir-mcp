/**
 * Call capture: the request and response of every tool call, gzipped to
 * the archive bucket (docs/REVIEW-2026-09-10-DOCS-TOOLS-SEAM.md, Part 5).
 *
 * Bodies do not belong in the audit row - players_collection averages
 * 37 KB and a partner tier is entitled to 15,000 calls a day - so the
 * house split applies: S3 is the system of record, Postgres keeps the
 * hot pointer (mcp_call_audit.captured). Written from the invoker's
 * `finally`, after the response is composed, so capture never sits in
 * front of an answer; a failed write logs call_capture_failed and the
 * row says captured=false. A call is never refused because capture
 * failed.
 *
 * Absent bucket (local dev, tests) = no capture: captureCall() is a
 * no-op that reports false, so nothing here needs S3 to run.
 */

import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** The archive key for one call. Partitioned by the call's UTC day so a
 *  lifecycle rule on `calls/` can expire it and a reader can find it from
 *  the audit row's created_at alone. */
export function captureKey(at, requestId) {
  const dt = new Date(at).toISOString().slice(0, 10);
  return `calls/dt=${dt}/request_id=${requestId}.json.gz`;
}

/** The S3 client for the archive bucket, or null when no bucket is
 *  configured. Mirrors services/ingest/src/handler.mjs makeArchive. */
export function makeCaptureStore(bucket = process.env.ARCHIVE_BUCKET) {
  if (!bucket) return null;
  return { s3: new S3Client({}), bucket };
}

/**
 * Write one call. Resolves true when the object landed, false otherwise
 * - never throws. `request` must already be redacted by the caller (the
 * invoker's redactArgs); this module does not know which keys are
 * secrets.
 */
export async function captureCall({
  s3,
  bucket,
  requestId,
  at = Date.now(),
  request,
  response,
  timings,
  meta = {},
}) {
  if (!s3 || !bucket) return false;
  try {
    const body = await gzipAsync(
      JSON.stringify({
        request,
        response,
        timings,
        ...meta,
        captured_at: new Date().toISOString(),
      }),
    );
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: captureKey(at, requestId),
        Body: body,
        ContentType: "application/json",
        ContentEncoding: "gzip",
      }),
    );
    return true;
  } catch (err) {
    console.error("call_capture_failed", requestId, err?.message);
    return false;
  }
}

/** Read one captured call back as the object that was written. Throws
 *  on a miss; the web API decides how to render that. */
export async function readCapture({ s3, bucket, at, requestId }) {
  const out = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: captureKey(at, requestId) }),
  );
  const raw = await out.Body.transformToByteArray();
  return JSON.parse((await gunzipAsync(raw)).toString("utf8"));
}
