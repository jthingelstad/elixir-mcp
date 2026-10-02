/** A battle's own page, /battle/<short id> (Jamie, 2026-10-01): the app
 *  shell the console runs in, with the battle's preview tags written into
 *  it, so a link pasted in a chat unfurls as the battle and not as
 *  Elixir's home. The page itself is the app's (apps/web BattlePage),
 *  reading /api/public/battles/<ref>; this route only names it. */
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { readPublicBattle } from "../battle-page.mjs";

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
    `<meta property="og:image" content="https://elixir.poapkings.com/assets/og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join("\n    ");
  return shell
    .replace(SHELL_TAGS, "")
    .replace("</head>", `    ${tags}\n  </head>`);
}

/** The built app shell, from the site bucket: read once a minute at most,
 *  so a deploy's new shell is served within a minute and a page view
 *  rarely costs an S3 read. */
export function makeSiteShell(bucket, { ttlMs = 60_000 } = {}) {
  if (!bucket) return null;
  const s3 = new S3Client({});
  let cached = null;
  return async () => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.html;
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: "app.html" }),
    );
    const html = await res.Body.transformToString("utf8");
    cached = { html, at: Date.now() };
    return html;
  };
}

const page = (statusCode, body, maxAge) => ({
  statusCode,
  headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": `public, max-age=${maxAge}`,
  },
  body,
});

export function battleRoutes({ siteShell }) {
  return {
    "GET /battle/*": async (db, event) => {
      if (!siteShell)
        return page(503, "<!doctype html><title>Elixir</title>", 0);
      const shell = await siteShell();
      // The share picture is not drawn yet: its address is not the page.
      if (String(event.pathParam ?? "").endsWith(".png"))
        return page(404, shell, 60);
      const read = await readPublicBattle(db, event.pathParam);
      // Not a battle Elixir holds: the app says so in its own words, and
      // the edge forgets the answer soon, since the battle may yet arrive.
      if (read.status !== 200) return page(404, shell, 60);
      return page(200, namedShell(shell, read), 3600);
    },
  };
}
