/** Explicit private import; defaults to preview. Never returns item bodies,
 * player ids, free text, keys or obsolete session/token pairs. */
import pg from "pg";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { importSnapshot, compareSnapshot } from "@elixir-mcp/clan-state/import";
export async function clanImport(
  databaseUrl,
  spec,
  { bucket = process.env.ARCHIVE_BUCKET, s3 = new S3Client({}) } = {},
) {
  if (!/^clan-migration\/v1\/[a-f0-9-]{36}\.json$/.test(spec?.key ?? ""))
    throw new Error("clan import needs a private snapshot key");
  const object = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: spec.key }),
  );
  if (object.ContentLength > 5_000_000) {
    object.Body.destroy?.();
    throw new Error("clan snapshot exceeds the bounded import size");
  }
  const bytes = await object.Body.transformToByteArray();
  if (bytes.byteLength > 5_000_000)
    throw new Error("clan snapshot exceeds the bounded import size");
  const snapshot = JSON.parse(Buffer.from(bytes).toString("utf8"));
  const frozenAt = Date.parse(snapshot.source?.freeze_completed_at);
  const exportedAt = Date.parse(snapshot.source?.exported_at);
  if (
    snapshot.source?.frozen !== true ||
    !Number.isFinite(frozenAt) ||
    !Number.isFinite(exportedAt) ||
    exportedAt - frozenAt < 300_000 ||
    exportedAt > Date.now() + 1000
  )
    throw new Error(
      "clan import needs a frozen snapshot after the inflight quiet period",
    );
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    return spec.compare === true
      ? await compareSnapshot(db, bytes, spec.sha256)
      : await importSnapshot(db, bytes, spec.sha256, {
          apply: spec.apply === true,
        });
  } finally {
    await db.end();
  }
}
