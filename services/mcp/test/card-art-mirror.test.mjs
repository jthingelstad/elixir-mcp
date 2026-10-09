// Card art is Supercell's and is never altered (Jamie, 2026-10-08: "it
// is important with card art that we not modify it at all. we can host
// them locally, but you cannot resize the images or alter them in
// anyway."). Until that day the mirror decoded each icon and wrote
// resized copies at 128, 192 and 285 pixels; these tests hold it to
// byte-identical copies and keep image code out of every card-art path.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CARD_ART_FORMS, cardArtPath } from "@elixir-mcp/contracts";
import {
  FORMS,
  ORIGINAL,
  artTasks,
  mirrorCards,
} from "../../../infra/scripts/mirror-card-art.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// A source fixture: a PNG signature and bytes no encoder would write the
// same way twice, so any decode and re-encode would change the digest.
const png = () => Buffer.concat([SIG, randomBytes(4096)]);

const CDN = "https://api-assets.clashroyale.com";
const cards = [
  {
    id: 26000042,
    name: "Electro Wizard",
    iconUrls: {
      medium: `${CDN}/cards/300/ew.png`,
      heroMedium: `${CDN}/cardheroes/300/ew.png`,
    },
  },
  {
    id: 26000085,
    name: "Electro Giant",
    iconUrls: {
      medium: `${CDN}/cards/300/eg.png`,
      evolutionMedium: `${CDN}/cardevolutions/300/eg.png`,
    },
  },
];

/** A CDN that serves `files` (url -> bytes) as image/png and 404s the rest. */
function cdn(files, { type = "image/png" } = {}) {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const body = files.get(url);
    if (!body) return { ok: false, status: 404 };
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": type }),
      arrayBuffer: async () =>
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
  return { fetchImpl, asked };
}

async function scratch() {
  return mkdtemp(path.join(tmpdir(), "card-art-"));
}

test("the mirror's forms and names are contracts' own", () => {
  assert.deepEqual(
    FORMS,
    CARD_ART_FORMS.map((f) => [...f]),
  );
  for (const t of artTasks(cards))
    assert.equal(`/assets/cards/${t.file}`, cardArtPath(t.card.id, t.form));
  for (const t of artTasks(cards)) assert.match(t.file, ORIGINAL);
});

test("the mirror stores each icon's exact bytes, sha256 equal to the source", async () => {
  const out = await scratch();
  try {
    const files = new Map([
      [cards[0].iconUrls.medium, png()],
      [cards[0].iconUrls.heroMedium, png()],
      [cards[1].iconUrls.medium, png()],
      [cards[1].iconUrls.evolutionMedium, png()],
    ]);
    const { fetchImpl } = cdn(files);
    const { results, summary } = await mirrorCards({ cards, out, fetchImpl });
    assert.equal(summary.written, 4);
    for (const t of artTasks(cards)) {
      const stored = await readFile(path.join(out, t.file));
      const source = files.get(t.url);
      assert.ok(stored.equals(source), `${t.file} is byte-identical`);
      assert.equal(sha(stored), sha(source));
      const r = results.find((x) => x.file === t.file);
      assert.equal(
        r.sha256,
        sha(source),
        "the recorded digest is the source's",
      );
      assert.equal(r.bytes, source.length);
    }
    assert.deepEqual(
      (await readdir(out)).sort(),
      ["26000042.png", "26000042_hero.png", "26000085.png", "26000085_evo.png"],
      "one file per card and form, no widths",
    );
    // The next run re-fetches and verifies against the fresh bytes.
    const again = await mirrorCards({ cards, out, fetchImpl });
    assert.equal(again.summary.verified, 4);
    assert.equal(again.summary.written, 0);
    // A changed source replaces the copy, still byte for byte.
    const redrawn = png();
    files.set(cards[0].iconUrls.medium, redrawn);
    const third = await mirrorCards({ cards, out, fetchImpl });
    assert.equal(third.summary.replaced, 1);
    assert.ok((await readFile(path.join(out, "26000042.png"))).equals(redrawn));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("a listed form Supercell has not published is missing, and asked again every run", async () => {
  // Hero Electro Wizard and Evo Electro Giant on 2026-10-08: listed in
  // iconUrls about two weeks before the CDN answers.
  const out = await scratch();
  try {
    const files = new Map([
      [cards[0].iconUrls.medium, png()],
      [cards[1].iconUrls.medium, png()],
    ]);
    const { fetchImpl, asked } = cdn(files);
    const first = await mirrorCards({ cards, out, fetchImpl });
    assert.deepEqual(first.summary.missing.sort(), [
      "26000042_hero.png",
      "26000085_evo.png",
    ]);
    assert.ok(!existsSync(path.join(out, "26000042_hero.png")));
    asked.length = 0;
    const hero = png();
    files.set(cards[0].iconUrls.heroMedium, hero);
    const second = await mirrorCards({ cards, out, fetchImpl });
    assert.ok(asked.includes(cards[0].iconUrls.heroMedium), "retried");
    assert.ok(asked.includes(cards[1].iconUrls.evolutionMedium), "retried");
    assert.deepEqual(second.summary.missing, ["26000085_evo.png"]);
    assert.ok(
      (await readFile(path.join(out, "26000042_hero.png"))).equals(hero),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("a copy the CDN no longer answers is kept, unverified; a non-PNG is refused, never converted", async () => {
  const out = await scratch();
  try {
    const held = png();
    await writeFile(path.join(out, "26000042.png"), held);
    const { fetchImpl } = cdn(new Map());
    const r = await mirrorCards({ cards: [cards[0]], out, fetchImpl });
    assert.deepEqual(r.summary.unverified, ["26000042.png"]);
    assert.ok((await readFile(path.join(out, "26000042.png"))).equals(held));
    const jpeg = cdn(new Map([[cards[1].iconUrls.medium, png()]]), {
      type: "image/jpeg",
    });
    const refused = await mirrorCards({
      cards: [cards[1]],
      out,
      fetchImpl: jpeg.fetchImpl,
    });
    assert.deepEqual(refused.summary.refused, ["26000085.png"]);
    assert.ok(!existsSync(path.join(out, "26000085.png")));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("the old resized copies are removed from the cache, so the site never ships them", async () => {
  const out = await scratch();
  try {
    for (const f of [
      "26000042-128.png",
      "26000042-192.png",
      "26000042-285.png",
      "26000042_hero-128.png",
    ])
      await writeFile(path.join(out, f), png());
    const { fetchImpl } = cdn(new Map([[cards[0].iconUrls.medium, png()]]));
    const r = await mirrorCards({ cards: [cards[0]], out, fetchImpl });
    assert.equal(r.summary.pruned, 4);
    assert.deepEqual(await readdir(out), ["26000042.png"]);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// The boundary: no card-art path can reach image code. The mirror
// imports only Node's own modules, the PNG codec it once used is gone,
// and no surface asks for a width.
const CARD_ART_PATHS = [
  "infra/scripts/mirror-card-art.mjs",
  "packages/contracts/src/card-art.ts",
  "packages/ui/src/Cards.tsx",
  "packages/mail/src/cards.mjs",
  "apps/site/src/_lib/cards.mjs",
  "apps/site/src/assets/cards-index.js",
  "apps/web/src/components/CardArtSource.jsx",
];

test("no card-art code path imports or calls image code", async () => {
  assert.ok(
    !existsSync(path.join(repoRoot, "infra/scripts/lib/png.mjs")),
    "the resizing PNG codec is gone",
  );
  const mirror = await readFile(
    path.join(repoRoot, "infra/scripts/mirror-card-art.mjs"),
    "utf8",
  );
  for (const [, spec] of mirror.matchAll(/^import [^;]*?from "([^"]+)"/gms))
    assert.match(spec, /^node:/, `the mirror imports only Node: ${spec}`);
  for (const rel of CARD_ART_PATHS) {
    const src = await readFile(path.join(repoRoot, rel), "utf8");
    assert.doesNotMatch(src, /\b(resize|encode|decode)\(/, rel);
    assert.doesNotMatch(
      src,
      /from "[^"]*(png\.mjs|sharp|jimp|pngjs|canvas|resvg|image-js)[^"]*"/,
      rel,
    );
    assert.doesNotMatch(src, /srcset/i, rel);
    assert.doesNotMatch(src, /-(128|192|285)\.png/, `${rel} names no width`);
  }
});
