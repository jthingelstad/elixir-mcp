/** The digest (social slice 9, #767): Elixir's one scheduled mail, under
 *  the friends mail's kind, `tracking_report`. Since 2026-11-12 it is also
 *  the clan's week and your own: Jamie, "One digest email and merging clan
 *  and those you follow is really needed since it will be common for
 *  someone to follow all members of their clan." The Monday clan report,
 *  Tuesday's Arena week and the milestone mail stopped as mails that day.
 *  The merge: each player's week is told once, under the person (a
 *  clanmate you follow is marked as one), and the clan has a short part of
 *  its own news only: its finished race, who joined and departed, role
 *  changes. A clan's battle count and gone-quiet list are its members'
 *  play, so they are left to the people and to Clan.
 *
 *  The first ruling (slice 9):
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
 *  clans they track, their own news only (clanNews), and their own week.
 *  Nothing is derived a second time: every number is the timeline
 *  entry's, every person's sentence the timeline's (itemText).
 *
 *  Null when nothing happened: no one followed played or posted, the
 *  reader did not, and no clan has news that sends (see `fold`). A null
 *  is no mail (never an empty week). */
import { buildTimeline, subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { itemText } from "@elixir-mcp/tools/activity/summary";
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
/** Names a clan line lists before "+N more". */
const CLAN_NAMES = 5;

const ordinal = (k) => {
  const t = k % 100;
  if (t >= 11 && t <= 13) return `${k}th`;
  return `${k}${{ 1: "st", 2: "nd", 3: "rd" }[k % 10] ?? "th"}`;
};

/** A list of members as a clan line names them, the people the reader
 *  follows first, the rest counted; `tags` are the ones it names. */
function memberNames(list, first) {
  const all = list?.items ?? [];
  const items = [
    ...all.filter((m) => first.has(m.tag)),
    ...all.filter((m) => !first.has(m.tag)),
  ];
  const shown = items.slice(0, CLAN_NAMES);
  const rest = Math.max(0, items.length - CLAN_NAMES) + (list?.more ?? 0);
  return {
    text: `${shown.map((m) => m.name ?? m.tag).join(", ")}${rest ? ` +${rest} more` : ""}`,
    tags: shown.map((m) => m.tag),
  };
}

/** The clan's own news for the digest, from the clan entry's structured
 *  facts: a finished river race, who joined and departed, role changes.
 *  Never its battles or who went quiet: that is its members' play, told
 *  once under each person you follow (2026-11-12, the merge). Each part
 *  is plain text; the render escapes it. `named` lists, beside each
 *  part, the moves it names by tag (`joined` or `left`), so a person's
 *  own move is dropped only when a line the reader sees names it; the
 *  people in `first` (those the reader follows) are named first.
 *  [engineering, 2026-11-12] */
export function clanNews(e, first = new Set()) {
  const parts = [];
  const named = [];
  for (const x of e.war?.resolved ?? []) {
    named.push([]);
    parts.push(
      `${x.is_colosseum ? "Colosseum" : "River race"}${x.season_id ? ` (season ${x.season_id}, week ${x.week})` : ""}: finished${x.rank ? ` ${ordinal(x.rank)}` : ""}${x.fame != null ? ` with ${Number(x.fame).toLocaleString("en-US")} fame` : ""}`,
    );
  }
  const r = e.roster ?? {};
  for (const [key, label] of [
    ["joined", "joined"],
    ["left", "departed"],
  ]) {
    if (!r[key]?.items?.length) continue;
    const { text, tags } = memberNames(r[key], first);
    parts.push(`${label}: ${text}`);
    named.push(tags.map((tag) => `${key}|${tag}`));
  }
  if (r.role_changes?.items?.length) {
    named.push([]);
    parts.push(
      `roles: ${r.role_changes.items
        .slice(0, 3)
        .map((m) => `${m.name ?? m.tag} ${m.from} → ${m.to}`)
        .join(
          ", ",
        )}${r.role_changes.items.length > 3 || r.role_changes.more ? " and more" : ""}`,
    );
  }
  return {
    race: (e.war?.resolved?.length ?? 0) > 0,
    parts,
    named,
  };
}

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

/** What the digest folds in for this reader. A reader who had turned
 *  the clan report off (`clan: false`) gets no more clan mail than before:
 *  their digest never comes for a clan's news alone. One who had turned
 *  Arena week off (`arena: false`) gets their alts as before, a name and
 *  a count, with no firsts or progress under them. Both default on, as
 *  the switches did. [engineering, 2026-11-12] */
const FOLD_ALL = { clan: true, arena: true };

export async function buildDigest({
  db,
  account,
  cadence,
  window,
  fold = FOLD_ALL,
}) {
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
  // The clan's own news, one block a clan you track, each told once: a
  // clan with none (only battles, or nothing) has no block.
  const followedTags = new Set(
    subjects.filter((s) => s.kind === "player").map((s) => s.tag),
  );
  const blocks = entries
    .filter((e) => e.kind === "clan_activity")
    .map((e) => ({ e, news: clanNews(e, followedTags) }))
    .filter(({ news }) => news.parts.length > 0)
    .map(({ e, news }) => ({
      tag: e.subject_tag,
      name: e.name ?? e.subject_tag,
      race: news.race,
      headline: news.parts[0],
      bullets: news.parts.slice(1, 1 + CLAN_BULLETS),
      more: Math.max(0, news.parts.length - 1 - CLAN_BULLETS),
      // The moves the drawn lines name: a line counted in "more" names
      // no one the reader can see.
      told: new Set(news.named.slice(0, 1 + CLAN_BULLETS).flat()),
    }));
  const clanTags = new Set(
    subjects.filter((s) => s.kind === "clan").map((s) => s.tag),
  );
  const toldClans = new Map(blocks.map((k) => [k.tag, k.told]));
  const clans = blocks.map(({ told: _told, ...k }) => k);
  // A move into or out of a clan whose block names that person is that
  // block's news, never the person's too; one the block only counts in
  // "+N more" stays under the person.
  const toldByClan = (it) =>
    (it.kind === "clan_joined" || it.kind === "clan_left") &&
    (toldClans
      .get(it.facts?.clan_tag)
      ?.has(
        `${it.kind === "clan_joined" ? "joined" : "left"}|${it.subject_tag}`,
      ) ??
      false);
  const itemsFor = (tag) => {
    const mine = items.filter(
      (it) =>
        (it.subject_tag === tag || it.subjects?.some((s) => s.tag === tag)) &&
        !toldByClan(it),
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
    // In a clan you track: the person's week is told here, once, and the
    // clan's block keeps to the clan's own news.
    ...(e.clan?.tag && clanTags.has(e.clan.tag)
      ? { clanmate: { tag: e.clan.tag, name: e.clan.name ?? null } }
      : {}),
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
  // Your alts: Arena week's part that had no other mail (D12, an alt's
  // firsts), so each alt that played or reached something carries its
  // firsts and its cards and badges counted. With Arena week off, as
  // before: a name and a count.
  const alts = players
    .filter((e) => e.relationship === "alt")
    .map(person)
    .filter((p) => p.battles > 0 || (fold.arena && p.items.length > 0))
    .map((p) =>
      fold.arena
        ? {
            tag: p.tag,
            name: p.name,
            battles: p.battles,
            wins: p.wins,
            losses: p.losses,
            progress: p.progress,
            items: p.items,
            more_items: p.more_items,
          }
        : { tag: p.tag, name: p.name, battles: p.battles },
    );
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
  // A clan's news sends a digest of its own only where the clan report
  // would have come: the reader kept it on, and for a daily reader only a
  // finished race (once a week), so no one gets more mail than the
  // Monday report gave them. [engineering, 2026-11-12]
  const clanSends =
    fold.clan && clans.some((k) => cadence !== "daily" || k.race);
  // Never an empty week (Jamie, 2026-11-12): no one followed played or
  // posted, neither did the reader, and no clan has news, so no mail.
  if (followed.length === 0 && !youHas && !clanSends) return null;
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
