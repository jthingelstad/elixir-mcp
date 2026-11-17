/** Mirror the card art every surface draws: byte-identical copies of
 *  the images the card catalog's iconUrls name.
 *
 *  The art is Supercell's and is never altered (Jamie, 2026-10-08: "it
 *  is important with card art that we not modify it at all. we can host
 *  them locally, but you cannot resize the images or alter them in
 *  anyway."). Each stored file is exactly the bytes the icon URL served:
 *  no decode, no resize, no re-encode, no metadata strip, no format
 *  change. One file per card and form, named by contracts' cardArtPath
 *  (<id>.png, <id>_evo.png, <id>_hero.png); a surface sizes it with
 *  HTML or CSS. Until 2026-10-08 this script decoded each icon and wrote
 *  resized copies at 128, 192 and 285 pixels; those are gone, and this
 *  file imports no image code (a test holds it to Node's own modules).
 *
 *  Every deploy runs this (deploy.mjs, before the site build) with
 *  --seed-bucket: it first copies down the originals the site bucket
 *  already holds, so a deploy from a fresh worktree ships the whole
 *  mirror and the 14-day asset prune never takes one, then fetches
 *  every form the live catalog's iconUrls name, fresh. A fetched file
 *  whose sha256 matches the copy on disk is verified; a new or changed
 *  one is written and read back, and its sha256 must equal the bytes
 *  downloaded. A form whose icon does not answer keeps the copy it has
 *  (unverified) or stays missing: Supercell lists a new card or form
 *  about two weeks before its CDN serves the image, so a missing form
 *  is expected then, and the first deploy after the image appears
 *  writes it. Until it does, surfaces draw the base card's art.
 *
 *  No surface hotlinks Supercell's CDN for card art (DECISIONS, Web,
 *  2026-10-08): a page that did would tell Supercell who reads it, a
 *  mail client proxies or blocks a third-party image, and a URL we do
 *  not control can stop working in an issue somebody opens a year from
 *  now. (Collector avatars and Verify's card faces still name the CDN;
 *  NOTES has them.)
 *
 *  Run on a machine with the internet (not CI, not Lambda: the VPC has
 *  neither NAT nor a reason). Output lands in apps/site/src/assets/cards
 *  and is never committed (.gitignore): it is a local cache, not a
 *  source, and the repo is public. Anything else in that directory (the
 *  old resized copies) is removed, so the site never ships it. The site
 *  build copies the directory in when it is there and the deploy uploads
 *  it with the site. The build itself never reaches the network for art
 *  (a build that must reach the network to succeed fails on a Sunday):
 *  the deploy runs this first, and a failure here is a warning that
 *  ships what the bucket held.
 *
 *    node infra/scripts/mirror-card-art.mjs [--catalog <file|url>]
 *    node infra/scripts/mirror-card-art.mjs --seed-bucket <bucket> [--catalog <file|url>]
 *
 *  Badge art (2026-11-17, the owner: "Yes use badge art. For sure.") is
 *  mirrored the same way, into apps/site/src/assets/badges: the icons
 *  the live badge list (/api/public/badges) names, one file per icon,
 *  named by the icon URL's own opaque id (contracts' badgeArtPath). That
 *  id changes when the image does, so a file the mirror already holds is
 *  the image and is not fetched again. A badge list that does not answer
 *  (the deploy that first ships the route) warns and ships what the
 *  bucket held.
 *
 *    node infra/scripts/mirror-card-art.mjs --seed-bucket <bucket> [--badges <file|url>]
 *
 *  Card and badge art are used under Supercell's Fan Content Policy;
 *  every surface that shows them carries the disclaimer.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
export const OUT = path.join(repoRoot, "apps/site/src/assets/cards");
export const BADGE_OUT = path.join(repoRoot, "apps/site/src/assets/badges");
const DEFAULT_CATALOG = "https://elixir.poapkings.com/api/public/cards";
const DEFAULT_BADGES = "https://elixir.poapkings.com/api/public/badges";

/** Each form, its key in the API's iconUrls and its file suffix
 *  (contracts CARD_ART_FORMS; kept here so this script runs without a
 *  build of contracts, and a test holds the two together). */
export const FORMS = [
  ["base", "medium", ""],
  ["evolution", "evolutionMedium", "_evo"],
  ["hero", "heroMedium", "_hero"],
];

/** The only names the mirror writes. */
export const ORIGINAL = /^\d+(_evo|_hero)?\.png$/;

/** A badge icon URL and the opaque id the mirrored file is named by
 *  (contracts' badgeArtPath; a test holds the two together). */
export const BADGE_ICON =
  /^https:\/\/api-assets\.clashroyale\.com\/playerbadges\/\d+\/([A-Za-z0-9_-]+)\.png$/;
export const BADGE_FILE = /^[A-Za-z0-9_-]+\.png$/;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

const readOrNull = (p) => readFile(p).catch(() => null);

/** Every form the catalog names an icon for: {card, form, url, file}. */
export function artTasks(cards) {
  const out = [];
  for (const card of cards) {
    const icons = card.iconUrls ?? card.icon_urls ?? {};
    for (const [form, key, suffix] of FORMS) {
      const url = icons[key];
      if (typeof url === "string" && url)
        out.push({ card, form, url, file: `${card.id}${suffix}.png` });
    }
  }
  return out;
}

/** Every distinct icon the badge list names: {url, file}. */
export function badgeTasks(badges) {
  const seen = new Map();
  for (const b of badges) {
    const url = b?.icon_url ?? b?.iconUrls?.large;
    const id = typeof url === "string" ? BADGE_ICON.exec(url)?.[1] : null;
    if (id && !seen.has(id)) seen.set(id, { url, file: `${id}.png` });
  }
  return [...seen.values()];
}

/** Remove what the mirror does not write (the old resized copies), so
 *  the site build never ships them. Returns the names removed. */
export async function pruneLocal(out, keep = ORIGINAL) {
  const removed = [];
  for (const name of await readdir(out).catch(() => [])) {
    if (keep.test(name)) continue;
    await rm(path.join(out, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed.sort();
}

/** Mirror one icon: fetch it, and keep exactly its bytes.
 *  @returns {Promise<{file: string, status: string, sha256?: string, bytes?: number, detail?: string}>} */
async function mirrorOne(task, { out, fetchImpl, keepHeld = false }) {
  const target = path.join(out, task.file);
  const held = await readOrNull(target);
  // A badge file is named by its image's id: one held is that image.
  if (held && keepHeld)
    return {
      file: task.file,
      status: "held",
      sha256: sha256(held),
      bytes: held.length,
    };
  const res = await fetchImpl(task.url, {
    signal: AbortSignal.timeout(30000),
  }).catch((err) => ({ ok: false, status: err.message }));
  if (!res.ok)
    return {
      file: task.file,
      status: held ? "unverified" : "missing",
      detail: `HTTP ${res.status}`,
      ...(held ? { sha256: sha256(held), bytes: held.length } : {}),
    };
  const bytes = Buffer.from(await res.arrayBuffer());
  const type = String(res.headers?.get?.("content-type") ?? "");
  // Stored as .png and served as image/png: a source that is not a PNG
  // is refused, never converted.
  if (
    !/^image\/png\b/i.test(type) ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
  )
    return {
      file: task.file,
      status: "refused",
      detail: `not a PNG (${type || "no content-type"})`,
    };
  const digest = sha256(bytes);
  if (held && sha256(held) === digest)
    return {
      file: task.file,
      status: "verified",
      sha256: digest,
      bytes: bytes.length,
    };
  await writeFile(target, bytes);
  const back = await readFile(target);
  if (sha256(back) !== digest || !back.equals(bytes))
    throw new Error(
      `[art] ${task.file}: stored bytes differ from the download`,
    );
  return {
    file: task.file,
    status: held ? "replaced" : "written",
    sha256: digest,
    bytes: bytes.length,
  };
}

/** Mirror every form the catalog names into `out`, a few at a time. */
export async function mirrorCards({
  cards,
  out = OUT,
  fetchImpl = fetch,
  concurrency = 8,
}) {
  await mkdir(out, { recursive: true });
  const pruned = await pruneLocal(out);
  const tasks = artTasks(cards);
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await mirrorOne(tasks[i], { out, fetchImpl });
      }
    }),
  );
  const count = (s) => results.filter((r) => r.status === s).length;
  const names = (s) => results.filter((r) => r.status === s).map((r) => r.file);
  return {
    results,
    summary: {
      cards: cards.length,
      forms: tasks.length,
      verified: count("verified"),
      written: count("written"),
      replaced: count("replaced"),
      unverified: names("unverified"),
      missing: names("missing"),
      refused: names("refused"),
      pruned: pruned.length,
    },
  };
}

/** Mirror every icon the badge list names into `out`: only the ones it
 *  does not hold are fetched. */
export async function mirrorBadges({
  badges,
  out = BADGE_OUT,
  fetchImpl = fetch,
  concurrency = 8,
}) {
  await mkdir(out, { recursive: true });
  const pruned = await pruneLocal(out, BADGE_FILE);
  const tasks = badgeTasks(badges);
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await mirrorOne(tasks[i], {
          out,
          fetchImpl,
          keepHeld: true,
        });
      }
    }),
  );
  const count = (s) => results.filter((r) => r.status === s).length;
  const names = (s) => results.filter((r) => r.status === s).map((r) => r.file);
  return {
    results,
    summary: {
      icons: tasks.length,
      held: count("held"),
      written: count("written"),
      missing: names("missing"),
      refused: names("refused"),
      pruned: pruned.length,
    },
  };
}

async function loadCatalog(source) {
  if (/^https?:/.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`catalog ${source}: HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(await readFile(source, "utf8"));
}

/** The originals the site bucket already holds, copied down: never the
 *  old resized copies (every one of their names has a hyphen). */
function seedFromBucket(bucket, out, prefix = "assets/cards") {
  execFileSync(
    "aws",
    [
      "s3",
      "sync",
      `s3://${bucket}/${prefix}`,
      out,
      "--only-show-errors",
      "--exclude",
      "*",
      "--include",
      "*.png",
      // The old resized card copies all have a hyphen; a badge id can.
      ...(prefix === "assets/cards" ? ["--exclude", "*-*"] : []),
    ],
    { stdio: "inherit" },
  );
}

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

async function main() {
  await mkdir(OUT, { recursive: true });
  await pruneLocal(OUT);
  const bucket = arg("seed-bucket");
  if (bucket) seedFromBucket(bucket, OUT);
  const catalog = await loadCatalog(arg("catalog", DEFAULT_CATALOG));
  const cards = catalog.cards ?? catalog;
  const { results, summary } = await mirrorCards({ cards });
  for (const r of results)
    if (r.status !== "verified")
      console.log(
        `[art] ${r.file} ${r.status}${r.detail ? ` (${r.detail})` : ""}${r.sha256 ? ` sha256 ${r.sha256}` : ""}`,
      );
  if (summary.missing.length)
    console.log(
      "[art] missing forms are expected for about two weeks after Supercell lists a card or form; surfaces draw the base card until the next deploy finds the image.",
    );
  console.log(JSON.stringify(summary));
  await mainBadges(bucket);
}

/** Badge art after card art: its own failure is a warning, so it never
 *  costs the cards a run. */
async function mainBadges(bucket) {
  try {
    await mkdir(BADGE_OUT, { recursive: true });
    await pruneLocal(BADGE_OUT, BADGE_FILE);
    if (bucket) seedFromBucket(bucket, BADGE_OUT, "assets/badges");
    const list = await loadCatalog(arg("badges", DEFAULT_BADGES));
    const { results, summary } = await mirrorBadges({
      badges: list.badges ?? list,
    });
    for (const r of results)
      if (r.status !== "held")
        console.log(
          `[badge-art] ${r.file} ${r.status}${r.detail ? ` (${r.detail})` : ""}${r.sha256 ? ` sha256 ${r.sha256}` : ""}`,
        );
    console.log(JSON.stringify(summary));
  } catch (err) {
    console.error(`WARNING: badge art mirror failed: ${err.message}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
