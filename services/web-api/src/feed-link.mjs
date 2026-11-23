/**
 * Your timeline as an RSS feed (social slice 7, #765; DECISIONS "Your
 * timeline is an RSS feed"): one private link per account, to its own
 * timeline, everyone it follows together. There is no feed per player.
 *
 * A feed reader cannot sign in, so the link's token is the credential.
 * Elixir keeps only its SHA-256 (0243): the link is shown once, when it is
 * made or reset, and Settings can reset it or turn it off (the old one
 * stops here at once, and at CloudFront's edge within the hour it keeps a
 * feed). The feed carries what Home's feed says, in the game's
 * names: never a nickname, an email or the account's own administration
 * (sign-ins, connections, feedback answers), and every name is escaped.
 */
import { createHash, randomBytes } from "node:crypto";
import { ELIXIR_ORIGIN } from "@elixir-mcp/contracts";
import { sessionPathOf } from "@elixir-mcp/ui/session-story";
import { memberPostUrl } from "@elixir-mcp/posts/paths";

/** 24 random bytes, base64url: 32 characters, 192 bits. */
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const FEED_PATH = "/api/rss";

/** Feed reads one link may make of Elixir in an hour: a reader polls every
 *  few minutes at most; this leaves room for several. Reads the edge
 *  answers from its copy never reach the count. */
export const FEED_READS_PER_HOUR = 60;
/** Links one account may make or reset in an hour. */
export const FEED_RESETS_PER_HOUR = 10;
/** Items one read carries, newest first. */
export const FEED_ITEMS = 50;

export const hashToken = (token) =>
  createHash("sha256").update(String(token)).digest("hex");

const feedUrl = (token) => `${ELIXIR_ORIGIN}${FEED_PATH}/${token}`;

/** Whether the account has a link, and since when. Never the link: only
 *  its hash is kept. */
export async function feedLinkState(db, accountId) {
  const { rows } = await db.query(
    `select created_at from timeline_feed_link where account_id = $1`,
    [accountId],
  );
  return rows[0]
    ? { on: true, created_at: rows[0].created_at.toISOString() }
    : { on: false, created_at: null };
}

/** Make the account's link, or reset it: a new token replaces the old
 *  one's hash, so Elixir refuses the old link at once (the edge's copy
 *  lasts at most its hour). The token is answered here
 *  and nowhere else. */
export async function resetFeedLink(db, accountId) {
  const token = randomBytes(24).toString("base64url");
  const { rows } = await db.query(
    `insert into timeline_feed_link (account_id, token_hash)
     values ($1, $2)
     on conflict (account_id)
     do update set token_hash = excluded.token_hash, created_at = now()
     returning created_at`,
    [accountId, hashToken(token)],
  );
  return {
    on: true,
    url: feedUrl(token),
    created_at: rows[0].created_at.toISOString(),
  };
}

export async function removeFeedLink(db, accountId) {
  await db.query(`delete from timeline_feed_link where account_id = $1`, [
    accountId,
  ]);
  return { on: false, created_at: null };
}

/** The account a link's token opens, or null. A token of the wrong shape
 *  is never looked up. Only an approved person's link opens. */
export async function accountForToken(db, token) {
  const t = String(token ?? "").replace(/\.xml$/, "");
  if (!TOKEN_RE.test(t)) return null;
  const { rows } = await db.query(
    `select a.account_id, a.timezone
       from timeline_feed_link l
       join account a on a.account_id = l.account_id
      where l.token_hash = $1 and a.kind = 'person' and a.status = 'approved'`,
    [hashToken(t)],
  );
  return rows[0] ?? null;
}

/** XML 1.0 text: the five escapes, and the control characters XML cannot
 *  carry at all dropped (a game name can hold them). */
export function xmlText(value) {
  return (
    String(value ?? "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  );
}

const tagPath = (tag) => String(tag ?? "").replace(/^#/, "");

/** Who an item is about, by the game's name: a player, else a clan, else
 *  nobody (never a nickname: the item's nickname field is not read). */
function whoOf(it) {
  const subjects = it.subjects ?? [];
  const player = subjects.find((s) => s.kind === "player");
  if (player) return { name: player.name ?? player.tag, tag: player.tag };
  const clan = subjects.find((s) => s.kind === "clan");
  if (clan) return { name: clan.name ?? clan.tag, tag: null };
  return null;
}

/** Where an item opens: a sitting's own page (2026-11-16), the battle
 *  that proved it, a battle post's battle, else the player's page, else
 *  the Timeline. */
function linkOf(it) {
  if (it.kind === "post") return memberPostUrl(it.facts.post_id);
  const session = sessionPathOf(it);
  if (session) return `${ELIXIR_ORIGIN}${session}`;
  const battle = it.battle_url ?? it.facts?.battle?.url ?? null;
  if (typeof battle === "string" && battle.startsWith(`${ELIXIR_ORIGIN}/`))
    return battle;
  const who = whoOf(it);
  if (who?.tag) return `${ELIXIR_ORIGIN}/home/player/${tagPath(who.tag)}`;
  return `${ELIXIR_ORIGIN}/timeline`;
}

/** The feed's items: the Timeline's (the read leaves out the account's own
 *  administration, accountLines: false), newest first, at most FEED_ITEMS. */
export const feedItems = (timeline) =>
  (timeline ?? [])
    .filter((it) => it.id)
    .sort(
      (a, b) =>
        Date.parse(b.observed_at ?? b.at) - Date.parse(a.observed_at ?? a.at),
    )
    .slice(0, FEED_ITEMS);

/** The feed's validator: a weak ETag over the document without its build
 *  instant, so the same items are the same tag at any time. Weak because
 *  CloudFront compresses the response, which weakens a strong one anyway. */
export const feedEtag = (xml) =>
  `W/"${createHash("sha256")
    .update(xml.replace(/<lastBuildDate>[^<]*<\/lastBuildDate>\n?/, ""))
    .digest("base64url")
    .slice(0, 27)}"`;

/** Whether an If-None-Match header names this tag (weak comparison,
 *  RFC 9110 13.1.2): a list, a W/ prefix on either side, or `*`. */
export function etagMatches(header, etag) {
  const opaque = (t) => t.trim().replace(/^W\//, "");
  const ours = opaque(etag);
  return String(header ?? "")
    .split(",")
    .some((t) => t.trim() === "*" || (t.trim() !== "" && opaque(t) === ours));
}

/** RSS 2.0 for the items, untitled. Each item's guid is its story id, so a sitting
 *  that grows is the same entry, updated, not a new one. */
export function renderRss(items, { now = new Date() } = {}) {
  const entries = items.map((it) => {
    const who = whoOf(it);
    const text = String(it.text ?? "").trim();
    const question = it.kind === "post" && it.facts.question;
    // A post is the writer's own words and never names them; every other
    // line names its player already.
    const lead =
      it.kind === "post" && who
        ? `${who.name}${question ? " asked" : ""}: ${text}`
        : question
          ? `Question: ${text}`
          : text;
    const attachment =
      it.kind === "post"
        ? [
            ...(it.facts.deck
              ? [
                  `Deck: ${it.facts.deck.cards.map((c) => c.name).join(", ")}`,
                  ...(it.facts.deck.tower_troop
                    ? [`Tower Troop: ${it.facts.deck.tower_troop.name}`]
                    : []),
                ]
              : []),
            ...(it.facts.cards.length
              ? [`Cards: ${it.facts.cards.map((c) => c.name).join(", ")}`]
              : []),
            ...(it.facts.moment
              ? [
                  `Recorded milestone: ${it.facts.moment.text}`,
                  `Recorded at: ${it.facts.moment.at}`,
                ]
              : []),
            ...(question && it.facts.answered ? ["Answered"] : []),
          ]
        : [];
    // No <title>: it only repeated the line. RSS 2.0 needs a title or a
    // description, not both; readers show an untitled item as a post, and
    // dc:creator as its author.
    const description = [lead, ...attachment].join("\n\n");
    // RSS item descriptions are HTML after XML decoding. Keep names and
    // authored words literal in that HTML, then encode it for the XML.
    const descriptionHtml = xmlText(description);
    const at = new Date(Date.parse(it.observed_at ?? it.at) || now.getTime());
    return [
      "<item>",
      `<link>${xmlText(linkOf(it))}</link>`,
      `<guid isPermaLink="false">${xmlText(it.id)}</guid>`,
      ...(who ? [`<dc:creator>${xmlText(who.name)}</dc:creator>`] : []),
      `<pubDate>${at.toUTCString()}</pubDate>`,
      `<description>${xmlText(descriptionHtml)}</description>`,
      "</item>",
    ].join("");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "<channel>",
    "<title>Your Elixir timeline</title>",
    `<link>${ELIXIR_ORIGIN}/timeline</link>`,
    "<description>Everyone you follow on Elixir, your clan and you: the last seven days. This material is unofficial and is not endorsed by Supercell. For more information see Supercell&apos;s Fan Content Policy: www.supercell.com/fan-content-policy.</description>",
    `<lastBuildDate>${now.toUTCString()}</lastBuildDate>`,
    "<ttl>30</ttl>",
    ...entries,
    "</channel>",
    "</rss>",
  ].join("\n");
}
