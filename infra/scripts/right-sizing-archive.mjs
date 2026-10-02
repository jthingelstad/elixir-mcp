/** Read every payload object version and marker into a private inventory.
 * AWS_PROFILE=cloud-engineer node infra/scripts/right-sizing-archive.mjs
 *   --cutoff=<ISO UTC> --directory=<new absolute private directory>
 * No payload body is read, overwritten or deleted. */
import {
  S3Client,
  GetBucketVersioningCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function archiveInventory({
  s3,
  bucket,
  cutoff,
  write,
  progress = () => {},
}) {
  if (
    !Number.isFinite(Date.parse(cutoff)) ||
    new Date(cutoff).toISOString() !== cutoff ||
    Date.parse(cutoff) > Date.now()
  )
    throw new Error("inventory needs a canonical past cutoff");
  const settings = await s3.send(
    new GetBucketVersioningCommand({ Bucket: bucket }),
  );
  if (settings.Status !== "Enabled")
    throw new Error("archive versioning must be enabled");
  const hash = createHash("sha256"),
    endpoints = {},
    seen = new Set();
  let marker = {},
    pages = 0,
    versions = 0,
    markers = 0,
    bytes = 0,
    newer = 0;
  for (;;) {
    const response = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: "payloads/",
        MaxKeys: 1000,
        ...marker,
      }),
    );
    pages++;
    for (const [kind, items] of [
      ["version", response.Versions ?? []],
      ["marker", response.DeleteMarkers ?? []],
    ])
      for (const item of items) {
        if (
          !item.Key?.startsWith("payloads/endpoint=") ||
          typeof item.VersionId !== "string" ||
          !item.LastModified ||
          !Number.isFinite(new Date(item.LastModified).getTime())
        )
          throw new Error("incomplete archive version identity");
        if (new Date(item.LastModified).getTime() > Date.parse(cutoff)) {
          newer++;
          continue;
        }
        const endpoint = item.Key.split("/")[1].slice("endpoint=".length);
        endpoints[endpoint] ??= { versions: 0, markers: 0, bytes: 0 };
        if (kind === "version") {
          versions++;
          bytes += item.Size;
          endpoints[endpoint].versions++;
          endpoints[endpoint].bytes += item.Size;
        } else {
          markers++;
          endpoints[endpoint].markers++;
        }
        const line =
          JSON.stringify({
            kind,
            key: item.Key,
            version_id: item.VersionId,
            is_latest: item.IsLatest,
            last_modified: new Date(item.LastModified).toISOString(),
            ...(kind === "version"
              ? {
                  bytes: item.Size,
                  etag: item.ETag,
                  storage_class: item.StorageClass,
                }
              : {}),
          }) + "\n";
        hash.update(line);
        await write(line);
      }
    if (response.IsTruncated === false) break;
    if (response.IsTruncated !== true || !response.NextKeyMarker)
      throw new Error("archive pagination has no completion proof");
    const pair = JSON.stringify([
      response.NextKeyMarker,
      response.NextVersionIdMarker,
    ]);
    if (seen.has(pair)) throw new Error("archive pagination repeated");
    seen.add(pair);
    marker = {
      KeyMarker: response.NextKeyMarker,
      ...(response.NextVersionIdMarker
        ? { VersionIdMarker: response.NextVersionIdMarker }
        : {}),
    };
    progress({ pages, versions, markers, bytes, newer });
  }
  return {
    version: 1,
    bucket,
    cutoff,
    pages,
    versions,
    markers,
    bytes,
    newer,
    sha256: hash.digest("hex"),
    endpoints,
    complete: true,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.env.AWS_PROFILE !== "cloud-engineer")
    throw new Error("use AWS_PROFILE=cloud-engineer");
  const args = Object.fromEntries(
    process.argv.slice(2).map((x) => {
      const i = x.indexOf("=");
      return [x.slice(2, i), x.slice(i + 1)];
    }),
  );
  if (!args.directory || !path.isAbsolute(args.directory))
    throw new Error("inventory needs an absolute new private directory");
  await mkdir(args.directory, { mode: 0o700 });
  const output = path.join(args.directory, "archive-versions.ndjson");
  const file = await open(output, "wx", 0o600);
  try {
    const summary = await archiveInventory({
      s3: new S3Client({ region: "us-east-1" }),
      bucket: "elixir-mcp-archive-999153317627",
      cutoff: args.cutoff,
      write: (line) => file.write(line),
      progress: (r) => {
        if (r.pages % 25 === 0) console.log(JSON.stringify(r));
      },
    });
    await file.sync();
    await writeFile(
      path.join(args.directory, "archive-summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.log(JSON.stringify({ ...summary, file: output }));
  } finally {
    await file.close();
  }
}
