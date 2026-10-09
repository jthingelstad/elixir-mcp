/** Mirror the card art every surface draws, at the sizes they ask for.
 *
 *  Since 2026-10-08 every deploy runs this (deploy.mjs, before the site
 *  build) with --seed-bucket: it first copies down what the site bucket
 *  already holds, so a deploy from a fresh worktree ships the whole
 *  mirror (and the prune never takes art a checkout did not have), then
 *  fetches each form the live catalog's iconUrls name that is still
 *  missing. Until then it was a hand step, last run 2026-09-22, and the
 *  forms Supercell added after it (Hero Electro Wizard, Evo Electro
 *  Giant) were text on Ladder and the battle page. The card responses
 *  carry each form's address (contracts card-art.ts); this is what
 *  makes those addresses answer.
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
 *  source, and the repo is public. The site build copies it in when it
 *  is there and the deploy uploads it with the site. The build itself
 *  never reaches the network for art (a build that must reach the
 *  network to succeed fails on a Sunday): the deploy runs this first,
 *  and a failure here is a warning that ships what the bucket held.
 *
 *    node infra/scripts/mirror-card-art.mjs [--catalog <file|url>] [--force]
 *    node infra/scripts/mirror-card-art.mjs --seed-bucket <bucket> [--catalog <file|url>]
 *    node infra/scripts/mirror-card-art.mjs --source-dir <dir> [--force]
 *
 *  --source-dir takes card art already on disk, named <id>.png,
 *  <id>_evo.png, <id>_hero.png, and only resizes it: no catalog, no
 *  network. That is how a machine with no catalog endpoint yet is
 *  seeded.
 *
 *  Card art is used under Supercell's Fan Content Policy; every surface
 *  that shows it carries the disclaimer.
 */
import { mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decode, encode, resize } from "./lib/png.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const OUT = path.join(repoRoot, "apps/site/src/assets/cards");
const DEFAULT_CATALOG = "https://elixir.poapkings.com/api/public/cards";
// Assets are stored at TWICE the size they are displayed at, because a
// 160px image shown at 160 CSS pixels is upscaled 2x on every retina
// screen and looks soft - which is exactly how it looked. The source
// art is 285 wide, so the 160px hero cannot reach a true 2x and takes
// the native 285 instead: the sharpest that exists.
const WIDTHS = [128, 192, 285];
const FORMS = [
  ["base", "medium", ""],
  ["evolution", "evolutionMedium", "_evo"],
  ["hero", "heroMedium", "_hero"],
];

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const force = process.argv.includes("--force");

async function loadCatalog(source) {
  if (/^https?:/.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`catalog ${source}: HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(await readFile(source, "utf8"));
}

const exists = (p) =>
  stat(p).then(
    () => true,
    () => false,
  );

/** Resize art already on disk: no catalog, no network. */
async function fromDir(dir) {
  await mkdir(OUT, { recursive: true });
  const files = (await readdir(dir)).filter((f) => f.endsWith(".png"));
  let written = 0;
  let skipped = 0;
  for (const file of files.sort()) {
    const stem = file.replace(/\.png$/, "");
    if (!/^\d+(_evo|_hero)?$/.test(stem)) continue;
    const img = decode(await readFile(path.join(dir, file)));
    for (const w of WIDTHS) {
      const target = path.join(OUT, `${stem}-${w}.png`);
      if (!force && (await exists(target))) {
        skipped += 1;
        continue;
      }
      await writeFile(target, encode(resize(img, w)));
      written += 1;
    }
  }
  console.log(
    JSON.stringify({ source: dir, files: files.length, written, skipped }),
  );
}

/** What the site bucket already holds, copied down: only files whose
 *  size differs or that are missing here travel. */
function seedFromBucket(bucket) {
  execFileSync(
    "aws",
    [
      "s3",
      "sync",
      `s3://${bucket}/assets/cards`,
      OUT,
      "--size-only",
      "--only-show-errors",
      "--exclude",
      "*",
      "--include",
      "*.png",
    ],
    { stdio: "inherit" },
  );
}

async function main() {
  const dir = arg("source-dir");
  if (dir) return fromDir(dir);
  await mkdir(OUT, { recursive: true });
  const bucket = arg("seed-bucket");
  if (bucket) seedFromBucket(bucket);
  const source = arg("catalog", DEFAULT_CATALOG);
  const catalog = await loadCatalog(source);
  const cards = catalog.cards ?? catalog;
  const missing = [];
  let fetched = 0;
  let written = 0;
  let skipped = 0;
  for (const card of cards) {
    const icons = card.iconUrls ?? card.icon_urls ?? {};
    for (const [form, key, suffix] of FORMS) {
      const url = icons[key];
      if (!url) continue;
      const targets = WIDTHS.map((w) => ({
        w,
        file: path.join(OUT, `${card.id}${suffix}-${w}.png`),
      }));
      const need = force
        ? targets
        : (
            await Promise.all(
              targets.map(async (t) => ((await exists(t.file)) ? null : t)),
            )
          ).filter(Boolean);
      if (need.length === 0) {
        skipped += targets.length;
        continue;
      }
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30000),
      }).catch((err) => ({ ok: false, status: err.message }));
      if (!res.ok) {
        console.warn(`[art] ${card.name} ${form}: HTTP ${res.status}`);
        missing.push(`${card.id}${suffix}`);
        continue;
      }
      fetched += 1;
      const img = decode(Buffer.from(await res.arrayBuffer()));
      for (const t of need) {
        await writeFile(t.file, encode(resize(img, t.w)));
        written += 1;
      }
      console.log(
        `[art] ${card.name}${suffix ? ` (${form})` : ""} -> ${need.map((t) => t.w).join(", ")}`,
      );
    }
  }
  console.log(
    JSON.stringify({ cards: cards.length, fetched, written, skipped, missing }),
  );
}

await main();
