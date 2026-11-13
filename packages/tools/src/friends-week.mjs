/** The week for everyone a person follows: the builder behind Home's
 *  Friends. The digest (services/jobs/src/email/build-digest.mjs, Monday
 *  11:00 UTC) replaced the Wednesday friends mail that read it too on
 *  2026-11-12. Its frame IS elixir_timeline's window,
 *  built in-process (buildTimeline) so the 48 KB door cap never applies;
 *  each person who played then gets the board's card (EmailFriends): a
 *  record per mode from battles_performance and the deck they played most
 *  from battles_decks, art and all.
 *
 *  A caller hands in `callTool(ctx, name, args)`, the registered tools its
 *  own door uses, and optionally `within()`: while it answers true more
 *  people are drawn as cards. The mail has minutes and passes none. A page
 *  has a request's deadline, and past it the rest keep their counts and lose
 *  only the card's deck (Home, 2026-11-05).
 *
 *  `by_family` marks a drawn card, and the mail draws a line for anyone
 *  without it. `mode_records` is everyone's record per mode, read with the
 *  timeline, so the cap or a deadline never takes it. */
import { buildTimeline, subjectsFor } from "./activity/entries.mjs";
import { deckIdentities } from "./tools/shared.mjs";
import { clanSummaryParts, itemText } from "./activity/summary.mjs";

/** The big firsts the digest tells one by one (Jamie, 2026-10-08,
 *  chose them for the milestone mail, retired 2026-11-12): a new arena
 *  or league, a new best trophy band, a new Evolution or Hero form, the
 *  career milestones, career wins and Collection Level steps, and a
 *  legendary badge. Card unlocks and badge levels (card_unlocked,
 *  badge_earned) are only counted (progressOf). */
export const MILESTONE_MAIL_KINDS = new Set([
  "arena_changed",
  "ranked_promotion",
  "best_trophies_band",
  "card_form_unlocked",
  "career_wins_step",
  "collection_level_step",
  "legendary_badge_earned",
]);

/** Game-mode names as the mail says them. The tool rows are keyed by the
 *  API's own mode name; the mail groups them the way a player thinks. */
export function modeLabel(gameMode = "", type = "") {
  const g = String(gameMode);
  if (/^Ladder$/i.test(g)) return "Trophy Road";
  // The timeline's mode GROUPS come through here too.
  if (/^war$/i.test(g)) return "War";
  if (/^casual$/i.test(g)) return "Casual";
  if (/^event$/i.test(g)) return "Events";
  if (/^other$/i.test(g)) return "Other";
  if (/^Ranked/i.test(g) || /pathoflegend|ranked/i.test(type))
    return "Path of Legends";
  if (/^CW_Duel/i.test(g)) return "War · Duel";
  if (/^CW_Battle/i.test(g) || /riverRacePvP/i.test(type)) return "War · 1v1";
  if (/^CW_Boat|boat/i.test(g) || /boat/i.test(type)) return "War · Boat";
  if (/friendly|trail/i.test(g) || /friendly|trail/i.test(type))
    return "Casual";
  if (/2v2|team/i.test(g) || /2v2/i.test(type)) return "2v2";
  if (/tournament/i.test(g) || /tournament/i.test(type)) return "Tournament";
  if (/challenge/i.test(g) || /challenge/i.test(type)) return "Challenge";
  return g.replace(/_/g, " ").replace(/\s+/g, " ").trim() || "Other";
}

/** Tolerant tool call: a reader that refuses (no subject, nothing
 *  recorded) yields null rather than failing the whole mail. */
async function tryTool(callTool, ctx, name, args) {
  try {
    return await callTool(ctx, name, args);
  } catch (err) {
    if (
      err?.code &&
      ["not_found", "no_subject", "bad_request", "result_too_large"].includes(
        err.code,
      )
    )
      return null;
    throw err;
  }
}

/** The small firsts a player's week held, counted (Jamie, 2026-10-08:
 *  card unlocks and badge levels roll into the weekly mail as counts):
 *  read off the timeline's own entry for the player, so the count is the
 *  entry's (every badge level-up, every card unlocked), never a second
 *  derivation. Null when there were none. A legendary badge is not
 *  counted: it is a big first, told on its own (MILESTONE_MAIL_KINDS),
 *  like an arena. */
export function progressOf(entry) {
  const unlocked = entry?.collection?.unlocked;
  const cards = (unlocked?.items?.length ?? 0) + (unlocked?.more ?? 0);
  const levels = entry?.badges?.earned ?? 0;
  return cards || levels
    ? { cards_unlocked: cards, badge_levels: levels }
    : null;
}

/** The deck the mail draws: the list row's record and the full read's
 *  cards (id, name, form) and tower troop, which the mail prints as
 *  text. Null when the full read is missing: no art is better than art
 *  guessed from names. */
export function featuredDeck(row, full) {
  if (!row || !Array.isArray(full?.cards) || full.cards.length === 0)
    return null;
  return {
    family: row.dominant_mode,
    label: full.archetype_label ?? row.archetype_label ?? null,
    battles: row.battles,
    wins: row.wins,
    losses: row.losses,
    cards: full.cards.map((c) => ({
      id: c.id,
      name: c.name,
      form: c.form ?? "base",
    })),
    tower_troop: full.tower_troop?.name ?? full.tower_troop_name ?? null,
    average_elixir: full.archetype?.average_elixir ?? null,
    level_gap: row.mean_level_gap ?? null,
  };
}

/** People drawn as cards with a deck (two tool calls each); anyone
 *  past this is a line. */
const CARD_CAP = 10;

/** The moments a card names. Card unlocks and badges are counted
 *  instead (progress, from the entry), the same split as the milestone
 *  mail (Jamie, 2026-10-08): a week of an alt's unlocks and level-5
 *  badges had crowded out everything else. The timeline itself is
 *  unchanged; this is the mail choosing what it says. */
const MOMENT_KINDS = new Set([
  ...MILESTONE_MAIL_KINDS,
  "clan_joined",
  "clan_left",
  "returned",
]);

/** A clan's block: its sentence's first clause as the headline, the next
 *  few as bullets, the rest counted (Jamie's friends mail, 2026-10-07:
 *  one paragraph of about a thousand characters). */
const CLAN_BULLETS = 3;

export async function buildFriendsWeek({
  db,
  account,
  week,
  season,
  callTool,
  within = null,
}) {
  const subjects = await subjectsFor(db, account.accountId);
  if (subjects.length === 0) return null;
  const fromMs = week.from.getTime();
  const toMs = week.to.getTime();
  const tz = account.timezone;
  const {
    entries,
    quiet,
    timeline: items,
  } = await buildTimeline(db, subjects, {
    fromMs,
    toMs,
    timezone: tz,
    // The week as it was played (A13): a clan's battles here match its
    // report and Clan's week. Moments keep their own late-capture rule.
    basis: "occurred",
    accountId: account.accountId,
    // The mail goes to the person's own address, nowhere else.
    interactive: true,
    modeRecords: true,
    // Moments only, chosen BEFORE the timeline's cap (review 2026-09-27
    // §6.8): the cap is spent on what the mail can say, and attested
    // facts (an away is never mail, DECISIONS) never enter the mail path.
    filter: (it) => MOMENT_KINDS.has(it.kind),
  });
  // Each subject's newest moments, newest first: the timeline's own
  // order, a newsfeed (Jamie, 2026-09-23).
  // A story about a followed member and their clan is one item naming
  // both (11.8.0), told under each subject as before.
  const momentsFor = (tag) =>
    items
      .filter(
        (it) =>
          it.subject_tag === tag || it.subjects?.some((s) => s.tag === tag),
      )
      .slice(0, 8)
      .map((it) => ({
        // The sentence is time-free; the when is the reader's clock.
        when: it.local ? `${it.local.weekday} ${it.local.time}` : "",
        text: it.text ?? itemText(it, tz),
      }));
  const players = entries.filter((e) => e.kind === "player_activity");
  const clans = entries.filter((e) => e.kind === "clan_activity");
  const one = (e) => ({
    tag: e.subject_tag,
    name: e.name ?? e.subject_tag,
    nickname: e.nickname ?? null,
    battles: e.battles.played,
    wins: e.battles.won,
    losses: e.battles.lost,
    sessions: e.battles.sessions,
    war_battles: e.war?.battles ?? 0,
    trophies:
      e.trophies?.from != null && e.trophies?.to != null
        ? { from: e.trophies.from, to: e.trophies.to }
        : null,
    clan: e.clan?.tag
      ? {
          tag: e.clan.tag,
          name: e.clan.name ?? e.clan.tag,
          role: e.clan.role ?? null,
        }
      : null,
    modes: modesText(e.battles.by_mode),
    mode_records: e.battles.mode_records,
    moments: momentsFor(e.subject_tag),
    progress: progressOf(e),
  });
  const primary = players.find((e) => e.relationship === "primary");
  const alts = players.filter((e) => e.relationship === "alt").map(one);
  const friends = players.filter((e) => e.relationship === "friend").map(one);
  // The cards: friends first, then the players watched, busiest first.
  const ctx = { db, account, live: null, notifyOwner: async () => {} };
  const window = { from: week.from.toISOString(), to: week.to.toISOString() };
  const played = [
    ...players.filter((e) => e.relationship === "friend"),
    ...players
      .filter((e) => e.relationship === "watching")
      .sort((a, b) => b.battles.played - a.battles.played),
  ].filter((e) => e.battles.played > 0);
  const cards = new Map();
  for (const e of played.slice(0, CARD_CAP)) {
    if (within && !within()) break;
    cards.set(
      e.subject_tag,
      await personWeek(callTool, ctx, e.subject_tag, window),
    );
  }
  if (primary && (!within || within()))
    cards.set(
      primary.subject_tag,
      await personWeek(callTool, ctx, primary.subject_tag, window, {
        deck: false,
      }),
    );
  for (const f of friends) Object.assign(f, cards.get(f.tag) ?? {});
  const watching = players
    .filter((e) => e.relationship === "watching")
    .map((e) => {
      const bits = [];
      if (e.battles.played)
        bits.push(
          `${e.battles.played} battle${e.battles.played === 1 ? "" : "s"}, ${e.battles.won}W-${e.battles.lost}L${e.battles.by_mode ? ` (${modesText(e.battles.by_mode)})` : ""}`,
        );
      else bits.push("no recorded battles");
      for (const n of e.notables ?? []) {
        if (n.kind === "returned")
          bits.push(`back after ${n.after_days} quiet days`);
        else if (n.kind === "clan_joined") bits.push(`joined ${n.clan_name}`);
        else if (n.kind === "clan_left") bits.push(`departed ${n.clan_name}`);
        else if (n.kind === "arena_changed")
          bits.push(`reached ${n.to ?? "a new arena"}`);
        else if (n.kind === "ranked_promotion")
          bits.push(`promoted to ${n.to}`);
      }
      return {
        tag: e.subject_tag,
        name: e.name ?? e.subject_tag,
        line: bits.join("; "),
        battles: e.battles.played,
        wins: e.battles.won,
        losses: e.battles.lost,
        mode_records: e.battles.mode_records,
        delta:
          e.trophies?.from != null && e.trophies?.to != null
            ? e.trophies.to - e.trophies.from
            : null,
        trophies:
          e.trophies?.from != null && e.trophies?.to != null
            ? { from: e.trophies.from, to: e.trophies.to }
            : null,
        moments: momentsFor(e.subject_tag),
        progress: progressOf(e),
        ...(cards.get(e.subject_tag) ?? {}),
      };
    })
    .sort((a, b) => (b.battles ?? 0) - (a.battles ?? 0));
  const clanRows = clans.map((e) => {
    const parts = clanSummaryParts(e, tz);
    return {
      tag: e.subject_tag,
      name: e.name ?? e.subject_tag,
      headline: parts[0] ?? "",
      bullets: parts.slice(1, 1 + CLAN_BULLETS),
      more: Math.max(0, parts.length - 1 - CLAN_BULLETS),
    };
  });
  return {
    week: {
      label: week.label,
      key: week.key,
      season,
      war_week: week.war_week ?? null,
    },
    primary: primary
      ? { ...one(primary), ...(cards.get(primary.subject_tag) ?? {}) }
      : null,
    alts,
    friends,
    watching,
    clans: clanRows,
    quiet: quiet.map((q) => ({
      tag: q.tag,
      name: q.nickname ?? q.name ?? q.tag,
      days: q.days_quiet,
      relationship: q.relationship ?? null,
    })),
    preheader: primary ? primary.summary : undefined,
    coverage: followingCoverage(subjects, entries),
  };
}

/** Who the reader follows and how many of them show no battle this week:
 *  people, so never the reader, their alts or a clan. A gap is unknown. */
function followingCoverage(subjects, entries) {
  const followed = subjects.filter(
    (s) => s.kind === "player" && !["primary", "alt"].includes(s.relationship),
  );
  const gap = "A gap means unknown. It does not mean they didn’t play.";
  if (!followed.length) return gap;
  const played = new Set(
    entries.filter((e) => e.battles?.played > 0).map((e) => e.subject_tag),
  );
  const silent = followed.filter((s) => !played.has(s.tag)).length;
  const people = `You follow ${followed.length} ${followed.length === 1 ? "person" : "people"}.`;
  if (!silent) return `${people} Each has a battle recorded this week.`;
  return `${people} ${silent} ${silent === 1 ? "has" : "have"} no battle recorded this week. ${gap}`;
}

/** One person's week the way the card draws it: a record per mode
 *  family (battles_performance's own split) and the deck played most
 *  (battles_decks, then the deck's identity read by its hash for its
 *  art). */
async function personWeek(callTool, ctx, tag, window, { deck = true } = {}) {
  const perf = await tryTool(callTool, ctx, "battles_performance", {
    player_tag: tag,
    ...window,
  });
  const by_family = Object.entries(perf?.window?.modes ?? {})
    .map(([mode, m]) => ({
      mode,
      battles: m.battles,
      wins: m.wins,
      losses: m.losses,
    }))
    .filter((m) => m.battles > 0)
    .sort((a, b) => b.battles - a.battles);
  if (!deck) return { by_family };
  const list = await tryTool(callTool, ctx, "battles_decks", {
    player_tag: tag,
    ...window,
    limit: 1,
  });
  const top = list?.decks?.[0];
  // The cards from the identity battles_decks itself reads for one deck
  // (the same deckIdentities, so the same cards, form and tower troop).
  // Asking the tool for the one deck reran the window's whole aggregate
  // for them, once per person drawn as a card (2026-11-09).
  const identity = top
    ? (await deckIdentities(ctx.db, [top.deck_hash])).get(top.deck_hash)
    : undefined;
  return {
    by_family,
    deck: featuredDeck(top, {
      ...identity,
      archetype_label: identity?.archetype?.label ?? null,
    }),
    decks_used: list?.total_decks ?? null,
    deck_battles: list?.total_battles_in_window ?? null,
  };
}

function modesText(byMode) {
  if (!byMode) return "";
  const entries = Object.entries(byMode)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  return entries.map(([m, n]) => `${n} ${modeLabel(m, "")}`).join(", ");
}
