/**
 * Publishing the merged site tree to its bucket, in an order that never
 * breaks a page somebody has open (#73), uploading only what changed
 * (2026-10-21).
 *
 * Until #73 the deploy ran one `aws s3 sync --delete` with no
 * Cache-Control and then invalidated. The sync removed the previous
 * build's lazy chunks while an open console, or an edge still holding
 * the old app.html, could ask for them: a blank page mid-session. The
 * order since:
 *
 *   1. assets/ first, never deleting: Vite's content-hashed chunks as
 *      immutable, everything else under assets/ revalidated;
 *   2. the documents, revalidated;
 *   3. the documents the build no longer has are deleted, never
 *      anything under assets/;
 *   4. (deploy.mjs) the invalidation, then the prune below.
 *
 * Until 2026-10-21 those were four `aws` CLI calls, and `s3 sync`
 * compares size and mtime: the build writes every file fresh, so every
 * deploy re-uploaded all ~1,360 files, one CLI process at a time, and
 * then rewrote the .txt surfaces' headers with a copy. Now one planner
 * compares each file's MD5 with the object's ETag (the site bucket is
 * SSE-S3 and nothing in it is multipart, so the ETag is the MD5), and
 * its headers with what the last publish recorded
 * (`deploys/site-published.json` in the code bucket; a file the record
 * does not cover is checked with HEAD). Only a difference is uploaded,
 * with its Content-Type and Cache-Control set on the PUT, a bounded
 * number at a time.
 *
 * Only a name that changes with its content can be immutable. The
 * site's own assets (site.css, chrome-menu.js, card art, fonts) keep one
 * name and are busted by `?v=<hash>`, and CachingOptimized leaves the
 * query string out of the edge's cache key: marked immutable, a browser
 * could keep the old bytes under the new `?v=` for a year. They
 * revalidate instead, which at max-age=0 also keeps the edge within the
 * policy's one-second minimum of the bucket.
 *
 * The prune (2026-10-21): an asset is deleted only when this build does
 * not ship it, no deploy in the last PRUNE_AFTER_DAYS shipped it (each
 * deploy writes the assets it ships to `deploys/site-assets/`), and it
 * was not uploaded in that window either. The old rule read "not
 * uploaded for 14 days" as "not shipped for 14 days", which held only
 * while every deploy re-uploaded every file.
 */

import { createHash } from "node:crypto";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const REVALIDATE = "public, max-age=0, must-revalidate";

/** How long an asset the build no longer ships stays in the bucket: an
 *  open console tab from before the deploy can still lazy-load it. */
export const PRUNE_AFTER_DAYS = 14;

/** Uploads, HEADs and manifest reads in flight at once. */
const CONCURRENCY = 16;

/** What the last publish wrote: each key's MD5 and headers. */
const SITE_PUBLISHED_KEY = "deploys/site-published.json";

/** One manifest per deploy: the assets/ keys it shipped. */
export const SITE_ASSETS_PREFIX = "deploys/site-assets/";
export const siteAssetsKey = (startedAt, sha) =>
  `${SITE_ASSETS_PREFIX}${startedAt.replace(/[:.]/g, "-")}-${sha.slice(0, 12)}.json`;

/**
 * Each kind of file the site ships, typed as `aws s3 sync` typed it
 * (read from the bucket 2026-10-21), and every .txt with its charset: a
 * text/plain with no charset is read as Latin-1 by browsers and most
 * agents (llms.txt showed "adding â€¦" for a UTF-8 ellipsis). HTML
 * carries <meta charset>; JSON and XML are UTF-8 by their specs. A file
 * of any other kind fails the site build (build-site.mjs) rather than
 * reach the bucket as application/octet-stream.
 */
export const CONTENT_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown",
  ".webp": "image/webp",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".otf": "font/otf",
};

/** @param {string} rel @returns {string | undefined} */
export function contentType(rel) {
  const dot = rel.lastIndexOf(".");
  const slash = rel.lastIndexOf("/");
  return dot > slash ? CONTENT_TYPES[rel.slice(dot).toLowerCase()] : undefined;
}

/** Vite's hash: eight base64url characters before the extension. */
const HASHED = /^[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/;

/**
 * The assets that are content-addressed: at the top of assets/, emitted
 * by Vite (apps/web/dist/assets), and named with its hash. Both, so a
 * site file whose name happens to look hashed is never made immutable.
 *
 * @param {Iterable<string>} files every path in the merged tree, relative
 * @param {Iterable<string>} viteAssets the names in apps/web/dist/assets
 * @returns {Set<string>} relative paths, e.g. assets/index-BTm8TzAt.js
 */
export function hashedAssets(files, viteAssets) {
  const vite = new Set(viteAssets);
  const out = new Set();
  for (const rel of files) {
    if (!rel.startsWith("assets/")) continue;
    const name = rel.slice("assets/".length);
    if (vite.has(name) && HASHED.test(name)) out.add(rel);
  }
  return out;
}

/** @param {Buffer} body */
export const md5 = (body) => createHash("md5").update(body).digest("hex");

/** An S3 ETag as the MD5 it is, or null when it is not one (multipart). */
export function etagMd5(etag) {
  const bare = String(etag ?? "").replace(/"/g, "");
  return /^[0-9a-f]{32}$/.test(bare) ? bare : null;
}

/**
 * What to publish, in order, and what to delete.
 *
 * @param {{
 *   files: { rel: string, md5: string }[],
 *   listing: Map<string, { etag: string | null }>,
 *   published: Record<string, { md5: string, contentType: string, cacheControl: string }>,
 *   hashed: Set<string>,
 *   removeMissing?: boolean,
 * }} input
 * @returns {{
 *   upload: { rel: string, md5: string, contentType: string, cacheControl: string }[],
 *   confirm: { rel: string, md5: string, contentType: string, cacheControl: string }[],
 *   unchanged: { rel: string, md5: string, contentType: string, cacheControl: string }[],
 *   remove: string[],
 * }} upload: content differs or the object is missing, in publish order
 *   (hashed assets, other assets, documents); confirm: the content
 *   matches but the record does not vouch for the headers, so HEAD it;
 *   unchanged: content and recorded headers match; remove: documents the
 *   bucket has and the build does not (never under assets/), when
 *   removeMissing.
 */
export function publishPlan({
  files,
  listing,
  published,
  hashed,
  removeMissing = false,
}) {
  const rank = (rel) =>
    hashed.has(rel) ? 0 : rel.startsWith("assets/") ? 1 : 2;
  const upload = [];
  const confirm = [];
  const unchanged = [];
  for (const { rel, md5: sum } of [...files].sort(
    (a, b) => rank(a.rel) - rank(b.rel) || a.rel.localeCompare(b.rel),
  )) {
    const type = contentType(rel);
    if (!type) throw new Error(`no content type for ${rel}`);
    const want = {
      rel,
      md5: sum,
      contentType: type,
      cacheControl: hashed.has(rel) ? IMMUTABLE : REVALIDATE,
    };
    if (listing.get(rel)?.etag !== sum) {
      upload.push(want);
      continue;
    }
    const was = published[rel];
    if (
      was?.md5 === sum &&
      was.contentType === want.contentType &&
      was.cacheControl === want.cacheControl
    )
      unchanged.push(want);
    else confirm.push(want);
  }
  const shipped = new Set(files.map((f) => f.rel));
  const remove = removeMissing
    ? [...listing.keys()]
        .filter((key) => !key.startsWith("assets/") && !shipped.has(key))
        .sort()
    : [];
  return { upload, confirm, unchanged, remove };
}

/** Run `fn` over `items`, at most `limit` at a time; the first failure
 *  rejects once the calls in flight have settled. */
export async function eachLimit(items, limit, fn) {
  let next = 0;
  let failure = null;
  const worker = async () => {
    while (failure === null && next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  if (failure) throw failure;
}

/** Every object under a prefix: key -> { etag, lastModified }. */
export async function listObjects(s3, bucket, { prefix, startAfter } = {}) {
  const out = new Map();
  let ContinuationToken;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        StartAfter: ContinuationToken ? undefined : startAfter,
        ContinuationToken,
      }),
    );
    for (const o of page.Contents ?? [])
      out.set(o.Key, {
        etag: etagMd5(o.ETag),
        lastModified: new Date(o.LastModified).getTime(),
      });
    ContinuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (ContinuationToken);
  return out;
}

async function readJson(s3, bucket, key) {
  const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return JSON.parse(await got.Body.transformToString());
}

/** The last publish's record, or an empty one: a missing or unreadable
 *  record only means every matching file is checked with HEAD. */
export async function readPublished(s3, bucket) {
  try {
    const record = await readJson(s3, bucket, SITE_PUBLISHED_KEY);
    return record && typeof record.objects === "object" && record.objects
      ? record.objects
      : {};
  } catch (error) {
    if (error?.name === "NoSuchKey" || error instanceof SyntaxError) return {};
    throw error;
  }
}

export async function writePublished(s3, bucket, objects) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: SITE_PUBLISHED_KEY,
      Body: `${JSON.stringify({ objects })}\n`,
      ContentType: "application/json",
    }),
  );
}

/**
 * Carry out a plan: HEAD each `confirm` and upload it too when its
 * headers differ, upload in order (each group finished before the next
 * starts, so no document names an asset that is not there yet), then
 * delete. Returns the record entries now true of the bucket.
 *
 * @param {{ s3: any, bucket: string, plan: ReturnType<typeof publishPlan>,
 *   read: (rel: string) => Promise<Buffer>, concurrency?: number }} input
 */
export async function publish({
  s3,
  bucket,
  plan,
  read,
  concurrency = CONCURRENCY,
}) {
  const entries = {};
  const record = ({ rel, md5: sum, contentType: ct, cacheControl: cc }) => {
    entries[rel] = { md5: sum, contentType: ct, cacheControl: cc };
  };
  plan.unchanged.forEach(record);
  const stale = [];
  await eachLimit(plan.confirm, concurrency, async (want) => {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: want.rel }),
    );
    if (
      etagMd5(head.ETag) === want.md5 &&
      head.ContentType === want.contentType &&
      head.CacheControl === want.cacheControl
    )
      record(want);
    else stale.push(want);
  });
  const upload = [...plan.upload, ...stale];
  const group = (w) =>
    w.cacheControl === IMMUTABLE ? 0 : w.rel.startsWith("assets/") ? 1 : 2;
  for (const g of [0, 1, 2]) {
    await eachLimit(
      upload.filter((w) => group(w) === g),
      concurrency,
      async (want) => {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: want.rel,
            Body: await read(want.rel),
            ContentType: want.contentType,
            CacheControl: want.cacheControl,
          }),
        );
        record(want);
      },
    );
  }
  for (let i = 0; i < plan.remove.length; i += 1000)
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: plan.remove.slice(i, i + 1000).map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  return {
    entries,
    uploaded: upload.length,
    confirmed: plan.confirm.length - stale.length,
    unchanged: plan.unchanged.length,
    removed: plan.remove.length,
  };
}

/** Write this deploy's manifest of the assets/ keys it ships. */
export async function writeAssetManifest(s3, bucket, { key, sha, assets }) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: `${JSON.stringify({ sha, assets: [...assets].sort() })}\n`,
      ContentType: "application/json",
    }),
  );
}

/**
 * Every asset a deploy in the window shipped, from the manifests whose
 * names (their deploy's start) fall inside it. Throws on any manifest it
 * cannot read, and when `own` is not among them: a prune with a partial
 * view of what is referenced must not run.
 */
export async function referencedAssets(s3, bucket, { now, days, own }) {
  const cutoff = new Date(now - days * 86_400_000).toISOString();
  const keys = [
    ...(
      await listObjects(s3, bucket, {
        prefix: SITE_ASSETS_PREFIX,
        startAfter: `${SITE_ASSETS_PREFIX}${cutoff.replace(/[:.]/g, "-")}`,
      })
    ).keys(),
  ];
  if (!keys.includes(own))
    throw new Error(`this deploy's asset manifest ${own} is not listed`);
  const referenced = new Set();
  await eachLimit(keys, CONCURRENCY, async (key) => {
    const manifest = await readJson(s3, bucket, key);
    if (!Array.isArray(manifest?.assets))
      throw new Error(`${key} lists no assets`);
    for (const asset of manifest.assets) referenced.add(asset);
  });
  return referenced;
}

/**
 * The assets to delete: under assets/, not in this build, shipped by no
 * deploy in the window (`referenced`, from the manifests), and not
 * uploaded in it either.
 *
 * @param {{ objects: {Key: string, LastModified: Date | number}[], current: Set<string>, referenced: Set<string>, now: number, days: number }} args
 * @returns {string[]} keys
 */
export function pruneCandidates({ objects, current, referenced, now, days }) {
  // A build with no assets is a broken build, not an empty site.
  if (current.size === 0) return [];
  const cutoff = now - days * 86_400_000;
  return objects
    .filter(
      (o) =>
        o.Key.startsWith("assets/") &&
        !current.has(o.Key) &&
        !referenced.has(o.Key) &&
        new Date(o.LastModified).getTime() < cutoff,
    )
    .map((o) => o.Key)
    .sort();
}
