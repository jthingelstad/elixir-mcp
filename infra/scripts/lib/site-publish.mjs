/**
 * Publishing the merged site tree to its bucket, in an order that never
 * breaks a page somebody has open (review 2026-09-27 §8.4, #73).
 *
 * Until #73 the deploy ran one `aws s3 sync --delete` with no
 * Cache-Control and then invalidated. The sync removed the previous
 * build's lazy chunks while an open console, or an edge still holding
 * the old app.html, could ask for them: a blank page mid-session. Now:
 *
 *   1. assets/ first, never deleting: Vite's content-hashed chunks as
 *      immutable, everything else under assets/ revalidated;
 *   2. the documents, revalidated, deleting what the build no longer
 *      has, but never touching assets/;
 *   3. the .txt charset rewrite, which replaces the metadata and so
 *      must restate Cache-Control;
 *   4. (deploy.mjs) the invalidation, then the prune below.
 *
 * Only a name that changes with its content can be immutable. The
 * site's own assets (site.css, chrome-menu.js, card art, fonts) keep one
 * name and are busted by `?v=<hash>`, and CachingOptimized leaves the
 * query string out of the edge's cache key: marked immutable, a browser
 * could keep the old bytes under the new `?v=` for a year. They
 * revalidate instead, which at max-age=0 also keeps the edge within the
 * policy's one-second minimum of the bucket.
 */

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const REVALIDATE = "public, max-age=0, must-revalidate";

/** How long an asset the build no longer ships stays in the bucket: an
 *  open console tab from before the deploy can still lazy-load it. */
export const PRUNE_AFTER_DAYS = 14;

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

/**
 * The aws CLI calls that publish the tree, in order.
 *
 * @param {{ dir: string, bucket: string, hashed: Set<string> }} args
 * @returns {string[][]} argument arrays for `aws`
 */
export function publishSteps({ dir, bucket, hashed }) {
  const names = [...hashed].map((rel) => rel.slice("assets/".length)).sort();
  const assetsSync = ["s3", "sync", `${dir}/assets`, `s3://${bucket}/assets`];
  return [
    [
      ...assetsSync,
      "--exclude",
      "*",
      ...names.flatMap((n) => ["--include", n]),
      "--cache-control",
      IMMUTABLE,
    ],
    [
      ...assetsSync,
      ...names.flatMap((n) => ["--exclude", n]),
      "--cache-control",
      REVALIDATE,
    ],
    [
      "s3",
      "sync",
      dir,
      `s3://${bucket}`,
      "--delete",
      "--exclude",
      "assets/*",
      "--cache-control",
      REVALIDATE,
    ],
    // `s3 sync` types an object by extension and never names a charset,
    // and a `text/plain` with no charset is read as Latin-1 by browsers
    // and most agents: llms.txt showed "adding â€¦" for a UTF-8 ellipsis.
    // HTML carries <meta charset>, JSON and XML are UTF-8 by their specs;
    // the .txt surfaces are the ones that need it said in the header.
    // REPLACE rewrites every header, so Cache-Control is stated again.
    [
      "s3",
      "cp",
      `s3://${bucket}`,
      `s3://${bucket}`,
      "--recursive",
      "--exclude",
      "*",
      "--include",
      "*.txt",
      "--exclude",
      "assets/*",
      "--content-type",
      "text/plain; charset=utf-8",
      "--cache-control",
      REVALIDATE,
      "--metadata-directive",
      "REPLACE",
    ],
  ];
}

/**
 * The assets to delete: under assets/, not in this build, and not
 * uploaded for `days`. Every sync re-uploads each file the build ships
 * (the merged tree is written fresh, so every local file is newer than
 * its object), so an object's LastModified is the last deploy that
 * shipped it, and "older than N days" means "gone from the build for N
 * days".
 *
 * @param {{ objects: {Key: string, LastModified: Date}[], current: Set<string>, now: number, days: number }} args
 * @returns {string[]} keys
 */
export function pruneCandidates({ objects, current, now, days }) {
  // A build with no assets is a broken build, not an empty site.
  if (current.size === 0) return [];
  const cutoff = now - days * 86_400_000;
  return objects
    .filter(
      (o) =>
        o.Key.startsWith("assets/") &&
        !current.has(o.Key) &&
        new Date(o.LastModified).getTime() < cutoff,
    )
    .map((o) => o.Key)
    .sort();
}
