/** A session's public page (2026-11-17): /session/<tag>/<id>/<start>, the
 *  link a person shares, open to anyone with it and no account, as a
 *  battle's /battle/<short id> is (DECISIONS "A session's public page").
 *
 *  The gate is the battle page's, made exact for a sitting: the player is
 *  one Elixir records, the item is a sitting on the player's public
 *  timeline (the player page's own read, public items only), and the
 *  address's start is the sitting's start to the second, inside the
 *  player page's 30 days. A wrong id, a wrong start or a session past 30
 *  days is a 404, so the address cannot be walked from a tag. It is read
 *  as nobody: UTC, game names only, never a nickname, a cheer, a comment
 *  or the reader's own marks. The page itself is the app's (apps/web
 *  PublicSession), reading /api/public/sessions/...; this module only
 *  reads and names it. */
import { normalizeTag, InvalidTagError } from "@elixir-mcp/contracts";
import {
  deckCaption,
  sessionHeadline,
  signedCount,
  trophyNet,
} from "@elixir-mcp/ui/session-story";
import { whenAt } from "@elixir-mcp/ui/time";
import { readSitting } from "./routes/player.mjs";
import { publicSessionLinks } from "./session-links.mjs";

/** A sitting is open while its last battle is within the gap that would
 *  end it (the timeline's SESSION_GAP_MS): its page and picture are kept
 *  a minute at the edge then, an hour (a day for the picture) once it
 *  has ended. */
const OPEN_MS = 30 * 60_000;

/** `<tag>/<id>/<start seconds>`, with the optional paging segments
 *  `/<offset>/<evidence version>` on the JSON (the edge forwards no query
 *  string). Null when it is not that shape. */
export function parseSessionRef(rest, { paging = false } = {}) {
  const parts = String(rest ?? "")
    .replace(/^\/+/, "")
    .split("/");
  const n = paging ? [3, 5] : [3];
  if (!n.includes(parts.length)) return null;
  const [rawTag, id, start, offset, version] = parts;
  let tag;
  try {
    tag = normalizeTag(decodeURIComponent(rawTag));
  } catch (err) {
    if (err instanceof InvalidTagError || err instanceof URIError) return null;
    throw err;
  }
  if (!/^tl_[0-9a-f]{20}$/.test(id)) return null;
  if (!/^\d{9,11}$/.test(start)) return null;
  const out = { tag, id, start: Number(start) };
  if (parts.length === 5) {
    if (!/^\d{1,5}$/.test(offset) || !/^[A-Za-z0-9_-]{1,80}$/.test(version))
      return null;
    out.offset = Number(offset);
    out.version = version;
  }
  return out;
}

/** The public read of one session, or `{ status: 404 }`. `{ status: 409 }`
 *  when an older page's version no longer matches (a battle was recorded
 *  since). */
export async function readPublicSession(db, ref, now = Date.now()) {
  if (!ref) return { status: 404 };
  const at = new Date(ref.start * 1000).toISOString();
  const read = await readSitting(
    db,
    ref.tag,
    {
      id: ref.id,
      at,
      offset: ref.offset ?? 0,
      expectedVersion: ref.version,
      timezone: "UTC",
      publicOnly: true,
    },
    now,
  );
  if (!read || (!read.error && !read.shareable)) return { status: 404 };
  // The start, exact to the second: the address names one sitting.
  const started = Date.parse(String(read.item?.facts?.started_at ?? ""));
  if (!Number.isFinite(started) || Math.floor(started / 1000) !== ref.start)
    return { status: 404 };
  if (read.error)
    return { status: read.error === "evidence_changed" ? 409 : 404 };
  const ended = Date.parse(String(read.item.facts?.ended_at ?? ""));
  return {
    status: 200,
    session: true,
    player: read.player,
    item: read.item,
    games: read.games,
    marks: read.marks,
    open: Number.isFinite(ended) ? now - ended < OPEN_MS : false,
    ...publicSessionLinks(read),
  };
}

const n = (v) => Number(v ?? 0).toLocaleString("en-US");

/** How a session's link unfurls: the player's game name and the headline,
 *  and one factual line. Plain strings; namedShell escapes each. */
export function sessionPreview(read) {
  const f = read.item.facts ?? {};
  const who = read.player.name ?? read.player.tag;
  const parts = [
    `${n(f.battles)} ${f.battles === 1 ? "battle" : "battles"}: ${n(f.won)} won, ${n(f.lost)} lost${(f.drawn ?? 0) > 0 ? `, ${n(f.drawn)} drawn` : ""}`,
  ];
  const net = trophyNet(f);
  if (net !== null && net !== 0) parts.push(`${signedCount(net)} trophies`);
  let line = `${parts.join(", ")}.`;
  const deck = deckCaption(f);
  if (deck?.label) line += ` Played ${deck.label}.`;
  if (f.started_at) line += ` ${whenAt(f.started_at, null, { now: 0 })}.`;
  return {
    title: `${who}: ${sessionHeadline(f)}`,
    description: line,
  };
}

/** The edge's keep for an answer: a minute while the session is open. */
export const sessionMaxAge = (read, closed) => (read.open ? 60 : closed);
