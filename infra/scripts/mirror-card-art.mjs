/** Mirror the card art mail needs, at the sizes mail asks for.
 *
 *  Mail does not hotlink Supercell's CDN. A mail client proxies or
 *  blocks a third-party image, Gmail caches it on its own terms, and a
 *  URL we do not control is a URL that can stop working in an issue
 *  somebody opens a year from now. The site hotlinks the same CDN for
 *  collector avatars and that is fine - a page can; a mail cannot.
 *
 *  Run on a machine with the internet (not CI, not Lambda: the VPC has
 *  neither NAT nor a reason). Output is committed, because 64/96/160
 *  pixel thumbnails of ~130 cards are about a megabyte and a build that
 *  reaches the network to succeed is a build that fails on a Sunday.
 *  Re-run when the catalog's as_of moves.
 *
 *    node infra/scripts/mirror-card-art.mjs [--catalog <file|url>] [--force]
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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decode, encode, resize } from "./lib/png.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const OUT = path.join(repoRoot, "apps/site/src/assets/cards");
const DEFAULT_CATALOG = "https://elixir.poapkings.com/api/public/cards";
// The widths the mail uses: a deck cell, a form beside the hero, the
// hero itself. Height follows the 2:3 card frame.
const WIDTHS = [64, 96, 160];
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

async function main() {
  const dir = arg("source-dir");
  if (dir) return fromDir(dir);
  const source = arg("catalog", DEFAULT_CATALOG);
  const catalog = await loadCatalog(source);
  const cards = catalog.cards ?? catalog;
  await mkdir(OUT, { recursive: true });
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
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        console.warn(`[art] ${card.name} ${form}: HTTP ${res.status}`);
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
    JSON.stringify({ cards: cards.length, fetched, written, skipped }),
  );
}

await main();
