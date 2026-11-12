/** The digest of the people you follow (social slice 9, #767): the mail
 *  that replaces the friends mail under its kind, `tracking_report`.
 *  Jamie, 2026-11-12, asked "Slice 9, the digest: should a digest of the
 *  people you follow replace the friends (tracking) mail, so there are
 *  still seven mail kinds? And what cadence?", answered "Weekly default
 *  (Recommended)": "Replaces friends mail. Weekly by default, daily or
 *  off by choice, never an empty week."
 *
 *  Its frame is the reader's own timeline for the window (buildTimeline,
 *  in-process, as Home's feed and elixir_timeline read it): for each
 *  person they follow, their sittings and battles counted, then the
 *  moments worth a line, each with the battle that made it when the
 *  record knows it, and their highlights with their own words. Then the
 *  clans they track, as the timeline's clan sentence, and their own
 *  week. Nothing is derived a second time: every number is the timeline
 *  entry's, every sentence the timeline's (itemText).
 *
 *  Null when nothing happened: no one followed played or posted, and
 *  neither did the reader. A null is no mail (never an empty week). */
import { buildTimeline, subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { clanSummaryParts, itemText } from "@elixir-mcp/tools/activity/summary";
import {
  MILESTONE_MAIL_KINDS,
  progressOf,
} from "@elixir-mcp/tools/friends-week";
import { battleLinks } from "@elixir-mcp/record/battle-links";

/** The items a digest tells: a highlight (the player's post), the big
 *  firsts the milestone mail tells (each with the battle that made it),
 *  and a person's clan moves and return. Chosen before the timeline's
 *  cap, so the cap is spent on what the mail can say; card unlocks and
 *  badge levels are counted (progress), as the friends mail counted
 *  them (DECISIONS "Mail collapses; the timeline does not"); attested
 *  facts never enter mail. [engineering, 2026-11-12] */
const DIGEST_KINDS = new Set([
  "battle_highlight",
  ...MILESTONE_MAIL_KINDS,
  "clan_joined",
  "clan_left",
  "returned",
]);

/** How far back each cadence looks: a week, or a day. The window also
 *  starts no earlier than the reader's last digest, so a switch between
 *  cadences never tells the same item twice. [engineering, 2026-11-12] */
const DIGEST_SPAN_MS = {
  weekly: 7 * 86400_000,
  daily: 86400_000,
};

/** Items a person shows, newest highlights first; the rest counted. */
const ITEMS_PER_PERSON = 3;
/** People drawn in one digest, busiest first; the rest counted. */
const PEOPLE_CAP = 12;
/** A clan's block: its headline and at most three bullets, as the
 *  friends mail drew it (DECISIONS "Mail collapses"). */
const CLAN_BULLETS = 3;

/** The window a digest covers for one reader. */
export function digestWindow(now, cadence, lastSentAt = null) {
  const toMs = now.getTime();
  const span = DIGEST_SPAN_MS[cadence] ?? DIGEST_SPAN_MS.weekly;
  const floor = toMs - span;
  const last = lastSentAt ? new Date(lastSentAt).getTime() : null;
  const fromMs = last && last > floor && last < toMs ? last : floor;
  return { fromMs, toMs };
}

const battleRef = (f) =>
  f?.battle?.battle_id ??
  f?.promoted_by?.battle_id ??
  f?.crossed_by?.battle_id ??
  null;

/** One item as the digest prints it: the timeline's time-free sentence,
 *  and for a highlight the player's words beside it (escaped at the
 *  render, never here), and the battle's public page when the record
 *  knows the battle. A highlight's share link is never carried: a
 *  follower's digest is not the owner's. */
function digestItem(it, tz, links) {
  const f = it.facts ?? {};
  const isHighlight = it.kind === "battle_highlight";
  const text = isHighlight
    ? itemText({ ...it, facts: { ...f, words: "" } }, tz)
    : (it.text ?? itemText(it, tz));
  const ref = battleRef(f);
  return {
    kind: it.kind,
    at: it.at,
    text,
    ...(isHighlight && f.words ? { words: String(f.words) } : {}),
    battle_url: f.battle?.url ?? (ref ? (links.get(ref)?.url ?? null) : null),
  };
}

export async function buildDigest({ db, account, cadence, window }) {
  const subjects = await subjectsFor(db, account.accountId);
  if (subjects.length === 0) return null;
  const tz = account.timezone;
  const { entries, timeline: items } = await buildTimeline(db, subjects, {
    fromMs: window.fromMs,
    toMs: window.toMs,
    timezone: tz,
    // What the record learned since the last digest: a battle recorded
    // late is told once, in the digest after it was learned, never
    // skipped. [engineering, 2026-11-12]
    basis: "observed",
    accountId: account.accountId,
    // The mail goes to the person's own address, nowhere else.
    interactive: true,
    filter: (it) => DIGEST_KINDS.has(it.kind),
  });
  const links = await battleLinks(
    db,
    items.map((it) => battleRef(it.facts)).filter(Boolean),
  );
  const itemsFor = (tag) => {
    const mine = items.filter(
      (it) => it.subject_tag === tag || it.subjects?.some((s) => s.tag === tag),
    );
    // Highlights first (the player's own post), then the rest; each
    // group newest first, the timeline's own order.
    const ordered = [
      ...mine.filter((it) => it.kind === "battle_highlight"),
      ...mine.filter((it) => it.kind !== "battle_highlight"),
    ];
    return {
      items: ordered
        .slice(0, ITEMS_PER_PERSON)
        .map((it) => digestItem(it, tz, links)),
      more_items: Math.max(0, ordered.length - ITEMS_PER_PERSON),
    };
  };
  const person = (e) => ({
    tag: e.subject_tag,
    name: e.name ?? e.subject_tag,
    nickname: e.nickname ?? null,
    relationship: e.relationship,
    sessions: e.battles.sessions ?? 0,
    battles: e.battles.played ?? 0,
    wins: e.battles.won ?? 0,
    losses: e.battles.lost ?? 0,
    trophies:
      e.trophies?.from != null && e.trophies?.to != null
        ? { from: e.trophies.from, to: e.trophies.to }
        : null,
    progress: progressOf(e),
    ...itemsFor(e.subject_tag),
  });
  // The timeline's entries are the subjects that played (or moved) in
  // the window; an item can still come from a subject with no entry: a
  // highlight of an older battle, posted or edited now. Such a subject
  // stands with no battles, so a post alone is still told (Codex on
  // #783).
  const entered = new Set(
    entries
      .filter((e) => e.kind === "player_activity")
      .map((e) => e.subject_tag),
  );
  const told = new Set(items.map((it) => it.subject_tag));
  const bare = subjects.filter(
    (s) => s.kind === "player" && !entered.has(s.tag) && told.has(s.tag),
  );
  const names = bare.length
    ? new Map(
        (
          await db.query(
            `select player_tag, name from player where player_tag = any($1::text[])`,
            [bare.map((s) => s.tag)],
          )
        ).rows.map((r) => [r.player_tag, r.name]),
      )
    : new Map();
  const players = [
    ...entries.filter((e) => e.kind === "player_activity"),
    ...bare.map((s) => ({
      kind: "player_activity",
      subject_tag: s.tag,
      name: names.get(s.tag) ?? null,
      nickname: s.nickname,
      relationship: s.relationship,
      battles: {},
      trophies: null,
    })),
  ];
  const followed = players
    .filter((e) => e.relationship === "friend" || e.relationship === "watching")
    .map(person)
    .filter((p) => p.battles > 0 || p.items.length > 0)
    // Friends first, then whoever has the most to tell, then the
    // busiest.
    .sort(
      (a, b) =>
        (a.relationship === "friend" ? 0 : 1) -
          (b.relationship === "friend" ? 0 : 1) ||
        b.items.length + b.more_items - (a.items.length + a.more_items) ||
        b.battles - a.battles,
    );
  const primary = players.find((e) => e.relationship === "primary");
  const alts = players
    .filter((e) => e.relationship === "alt")
    .map(person)
    .filter((p) => p.battles > 0 || p.items.length > 0)
    .map((p) => ({ tag: p.tag, name: p.name, battles: p.battles }));
  // A quiet primary has no entry; an alt that played still makes the
  // reader's own stretch, under the primary's name (Codex on #783).
  const primarySubject = subjects.find(
    (s) => s.kind === "player" && s.relationship === "primary",
  );
  let you = primary ? person(primary) : null;
  if (!you && alts.length > 0 && primarySubject) {
    const { rows } = await db.query(
      `select name from player where player_tag = $1`,
      [primarySubject.tag],
    );
    you = person({
      subject_tag: primarySubject.tag,
      name: rows[0]?.name ?? null,
      nickname: null,
      relationship: "primary",
      battles: {},
      trophies: null,
    });
  }
  const youHas = Boolean(
    you && (you.battles > 0 || you.items.length > 0 || alts.length > 0),
  );
  // Never an empty week (Jamie, 2026-11-12): no one followed played or
  // posted and neither did the reader, so no mail.
  if (followed.length === 0 && !youHas) return null;
  const clans = entries
    .filter((e) => e.kind === "clan_activity")
    .filter(
      (e) =>
        (e.activity?.battles ?? 0) > 0 ||
        e.roster?.joined?.items?.length ||
        e.roster?.left?.items?.length ||
        e.war?.resolved?.length,
    )
    .map((e) => {
      const parts = clanSummaryParts(e, tz);
      return {
        tag: e.subject_tag,
        name: e.name ?? e.subject_tag,
        headline: parts[0] ?? "",
        bullets: parts.slice(1, 1 + CLAN_BULLETS),
        more: Math.max(0, parts.length - 1 - CLAN_BULLETS),
      };
    });
  const following = subjects.filter(
    (s) => s.kind === "player" && !["primary", "alt"].includes(s.relationship),
  ).length;
  return {
    cadence,
    window: {
      from: new Date(window.fromMs).toISOString(),
      to: new Date(window.toMs).toISOString(),
    },
    people: followed.slice(0, PEOPLE_CAP),
    more_people: Math.max(0, followed.length - PEOPLE_CAP),
    clans,
    you: youHas
      ? {
          ...you,
          clan: primary?.clan?.tag ? { tag: primary.clan.tag } : null,
          alts,
        }
      : null,
    following,
    coverage: coverageOf(following, followed.length, cadence),
  };
}

/** What the digest could see: how many people the reader follows and
 *  how many had something recorded. A gap is unknown. */
function coverageOf(following, told, cadence) {
  const span = cadence === "daily" ? "day" : "week";
  const gap = "A gap means unknown. It does not mean they didn’t play.";
  if (!following)
    return `You follow nobody yet, so this ${span} is yours alone. ${gap}`;
  const people = `You follow ${following} ${following === 1 ? "person" : "people"}`;
  return `${people}; ${told} ${told === 1 ? "has" : "have"} something recorded this ${span}. ${gap}`;
}
