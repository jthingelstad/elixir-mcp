/** Map every cutoff-inventoried battle-log version to ingest's battle IDs.
 * Reads archive bodies, writes only private evidence, never game rows. */
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { canonicalBattleIdentity } from "../../packages/ingest/src/battles.mjs";
import { payloadHash } from "../../packages/ingest/src/hash.mjs";
import { normalizeTag } from "@elixir-mcp/contracts";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFile, mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function observerEvidence(item, compressed) {
  const match =
    /^payloads\/endpoint=player_battlelog\/entity=([^/]+)\/dt=\d{4}-\d{2}-\d{2}\/[^/]+-([a-f0-9]{16})\.json\.gz$/.exec(
      item.key,
    );
  if (
    !match ||
    item.kind !== "version" ||
    !item.version_id ||
    compressed.length !== item.bytes ||
    compressed.length > 16_000_000
  )
    throw new Error("incomplete observer object identity");
  const body = gunzipSync(compressed, { maxOutputLength: 128_000_000 });
  const payload = JSON.parse(body.toString("utf8"));
  if (!Array.isArray(payload)) throw new Error("battle log is not an array");
  const hash = payloadHash(payload);
  if (!hash.startsWith(match[2]))
    throw new Error("observer payload hash differs from archive key");
  return {
    key: item.key,
    version_id: item.version_id,
    observer_tag: normalizeTag(match[1]),
    payload_hash: hash,
    compressed_sha256: sha(compressed),
    battles: payload.map(canonicalBattleIdentity),
  };
}

export async function mapObservers({
  inventoryBytes,
  inventorySummary,
  read,
  write,
  progress = () => {},
  concurrency = 12,
}) {
  if (
    !inventorySummary.complete ||
    sha(inventoryBytes) !== inventorySummary.sha256 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 32
  )
    throw new Error("incomplete or altered archive inventory");
  const items = inventoryBytes
    .toString("utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter(
      (item) =>
        item.kind === "version" &&
        item.key.startsWith("payloads/endpoint=player_battlelog/"),
    );
  if (
    items.length !==
    (inventorySummary.endpoints.player_battlelog?.versions ?? 0)
  )
    throw new Error("observer inventory count differs");
  let objects = 0,
    failed = 0,
    entries = 0,
    position = 0,
    pendingWrite = Promise.resolve();
  const outputHash = createHash("sha256");
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (position < items.length) {
        const item = items[position++];
        let evidence;
        try {
          evidence = observerEvidence(item, await read(item));
          entries += evidence.battles.length;
        } catch {
          failed++;
          evidence = {
            key: item.key,
            version_id: item.version_id,
            unresolved: true,
          };
        }
        const line = JSON.stringify(evidence) + "\n";
        pendingWrite = pendingWrite.then(async () => {
          await write(line);
          outputHash.update(line);
        });
        await pendingWrite;
        objects++;
        if (objects % 2000 === 0)
          progress({ objects, total: items.length, entries, failed });
      }
    }),
  );
  await pendingWrite;
  return {
    version: 1,
    cutoff: inventorySummary.cutoff,
    inventory_sha256: inventorySummary.sha256,
    objects,
    entries,
    failed,
    complete: failed === 0,
    sha256: outputHash.digest("hex"),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.env.AWS_PROFILE !== "cloud-engineer")
    throw new Error("use AWS_PROFILE=cloud-engineer");
  const args = Object.fromEntries(
    process.argv.slice(2).map((x) => {
      const i = x.indexOf("=");
      if (i < 3 || !["--inventory", "--directory"].includes(x.slice(0, i)))
        throw new Error("unknown observer argument");
      return [x.slice(2, i), x.slice(i + 1)];
    }),
  );
  if (![args.inventory, args.directory].every((p) => path.isAbsolute(p ?? "")))
    throw new Error("observer evidence needs absolute private paths");
  const inventoryBytes = await readFile(
    path.join(args.inventory, "archive-versions.ndjson"),
  );
  const inventorySummary = JSON.parse(
    await readFile(path.join(args.inventory, "archive-summary.json"), "utf8"),
  );
  await mkdir(args.directory, { mode: 0o700 });
  const output = await open(
      path.join(args.directory, "observer-map.ndjson"),
      "wx",
      0o600,
    ),
    s3 = new S3Client({ region: "us-east-1" });
  try {
    const summary = await mapObservers({
      inventoryBytes,
      inventorySummary,
      write: (line) => output.write(line),
      read: async (item) => {
        const r = await s3.send(
          new GetObjectCommand({
            Bucket: inventorySummary.bucket,
            Key: item.key,
            VersionId: item.version_id,
          }),
        );
        if (r.VersionId !== item.version_id || r.ContentLength > 16_000_000) {
          r.Body.destroy?.();
          throw new Error("observer version differs");
        }
        return Buffer.from(await r.Body.transformToByteArray());
      },
      progress: (p) => console.log(JSON.stringify(p)),
    });
    await output.sync();
    await writeFile(
      path.join(args.directory, "observer-summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    console.log(JSON.stringify(summary));
    if (!summary.complete) process.exitCode = 1;
  } finally {
    await output.close();
  }
}
