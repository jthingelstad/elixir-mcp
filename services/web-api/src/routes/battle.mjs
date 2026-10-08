/** A battle's own page, /battle/<short id> (Jamie, 2026-10-01): the app
 *  shell the console runs in, with the battle's preview tags written into
 *  it, so a link pasted in a chat unfurls as the battle and not as
 *  Elixir's home. The page itself is the app's (apps/web BattlePage),
 *  reading /api/public/battles/<ref>; this route only names it. */
import { readFile } from "node:fs/promises";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readPublicBattle } from "../battle-page.mjs";
import { SHARE_FILES } from "../share-files.mjs";

/** How a battle's mode reads to a person (the page's mode chip). */
const MODE_LABEL = {
  ladder: "Trophy Road",
  ranked: "Path of Legends",
  war: "War",
  casual: "Friendly",
  challenge: "Challenge",
  event: "Event",
  tournament: "Tournament",
};

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const names = (side) =>
  side.players.map((p) => p.name ?? p.player_tag).join(" and ") || "Unknown";

/** The preview a link unfurls into: who played, the score, the mode. */
export function previewOf(read) {
  const { battle, sides, games } = read;
  const [l, r] = sides;
  const mode = MODE_LABEL[battle.mode_group] ?? battle.game_mode?.name ?? "";
  const score = games
    ? `${games.filter((g) => g.winner === "left").length}–${games.filter((g) => g.winner === "right").length}`
    : `${l.crowns ?? "?"}–${r.crowns ?? "?"}`;
  const title = `${names(l)} ${score} ${names(r)}${mode ? `, ${mode}` : ""}`;
  const labels = [l, r].map((s) => {
    const p = s.players[0];
    return p?.deck?.label ?? p?.rounds?.[0]?.label ?? null;
  });
  const parts = [];
  if (labels[0] && labels[1]) parts.push(`${labels[0]} against ${labels[1]}.`);
  if (battle.duration?.basis === "king_tower_fell")
    parts.push("Ended by a King Tower.");
  else if (battle.duration?.basis === "regulation_ran")
    parts.push("Went to time.");
  else if (battle.duration?.basis === "overtime_expired")
    parts.push("Overtime ran out.");
  if (battle.arena?.name) parts.push(battle.arena.name + ".");
  return { title, description: parts.join(" ") || title };
}

/** The tags the app shell's own preview tags give way to. */
const SHELL_TAGS =
  /<title>[\s\S]*?<\/title>|<meta\s[^>]*?(?:property="og:[^"]*"|name="(?:twitter:[^"]*|description|robots)")[^>]*>/g;

export function namedShell(shell, read) {
  const { title, description } = previewOf(read);
  const url = read.battle.url;
  // The battle's own picture; the site's when it has no link to hang
  // one on.
  const image =
    read.battle.image ?? "https://elixir.poapkings.com/assets/og.png";
  const tags = [
    `<title>${esc(title)} - Elixir</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    // A battle is public to anyone with its link, not a page for search.
    `<meta name="robots" content="noindex" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Elixir" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ].join("\n    ");
  return shell
    .replace(SHELL_TAGS, "")
    .replace("</head>", `    ${tags}\n  </head>`);
}

/** The built app shell, from the site bucket: read once a minute at most,
 *  so a deploy's new shell is served within a minute and a page view
 *  rarely costs an S3 read. `key` reads another built document the same
 *  way (the site's 404.html, routes/site-miss.mjs). */
export function makeSiteShell(
  bucket,
  { ttlMs = 60_000, key = "app.html" } = {},
) {
  if (!bucket) return null;
  const s3 = new S3Client({});
  let cached = null;
  return async () => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.html;
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const html = await res.Body.transformToString("utf8");
    cached = { html, at: Date.now() };
    return html;
  };
}

/** Each card's art from the site bucket's mirror
 *  (infra/scripts/mirror-card-art.mjs), at the 128-pixel width: the
 *  picture draws a card 78 wide. Read once per card and form for the
 *  life of the function; a card the mirror lacks is null, and the
 *  picture writes its name in the frame. */
const SUFFIX = { base: "", evolution: "_evo", hero: "_hero" };
export function makeCardArt(bucket) {
  if (!bucket) return async () => null;
  const s3 = new S3Client({});
  const seen = new Map();
  return (card) => {
    const key = `assets/cards/${card.id}${SUFFIX[card.form] ?? ""}-128.png`;
    if (!seen.has(key))
      seen.set(
        key,
        s3
          .send(new GetObjectCommand({ Bucket: bucket, Key: key }))
          .then((res) => res.Body.transformToByteArray())
          .catch(() => null),
      );
    return seen.get(key);
  };
}

/** The renderer and fonts from a directory holding SHARE_FILES: the
 *  bundle's share/ in the function (infra/scripts/build.mjs). */
export function shareAssetsIn(dir) {
  let loaded = null;
  return () =>
    (loaded ??= (async () => {
      const out = {};
      for (const [k, name] of Object.entries(SHARE_FILES))
        out[k] = await readFile(new URL(name, dir));
      return out;
    })());
}

const page = (statusCode, body, maxAge) => ({
  statusCode,
  headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": `public, max-age=${maxAge}`,
  },
  body,
});

/** The share picture: a PNG, base64 for the gateway. A battle does not
 *  change once recorded, so the edge keeps it a day; a name it carries
 *  is the name as last recorded, and a day is how stale that may get. */
async function picture(db, ref, shareImage) {
  const text = (statusCode, body, maxAge) => ({
    statusCode,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
    },
    body,
  });
  if (!shareImage) return text(503, "The share picture is not set up.", 0);
  const read = await readPublicBattle(db, ref, { around: false });
  if (read.status !== 200) return text(404, "No battle at this address.", 60);
  const png = await shareImage(read);
  return {
    statusCode: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    },
    body: Buffer.from(png).toString("base64"),
    isBase64Encoded: true,
  };
}

export function battleRoutes({ siteShell, shareImage }) {
  return {
    "GET /battle/*": async (db, event) => {
      const ref = String(event.pathParam ?? "");
      if (ref.endsWith(".png"))
        return picture(db, ref.slice(0, -".png".length), shareImage);
      if (!siteShell)
        return page(503, "<!doctype html><title>Elixir</title>", 0);
      const shell = await siteShell();
      const read = await readPublicBattle(db, ref);
      // Not a battle Elixir holds: the app says so in its own words, and
      // the edge forgets the answer soon, since the battle may yet arrive.
      if (read.status !== 200) return page(404, shell, 60);
      return page(200, namedShell(shell, read), 3600);
    },
  };
}
