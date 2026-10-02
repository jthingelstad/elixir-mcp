/** tracking_report, "Your friends this week" since 2026-10-01: the week
 *  for everyone the recipient follows. Its frame IS elixir_timeline's
 *  window, built in-process (buildTimeline) so the 48 KB door cap never
 *  applies; each person who played then gets the board's card
 *  (EmailFriends): a record per mode from battles_performance and the
 *  deck they played most from battles_decks, art and all. */
import { buildTimeline, subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { itemText } from "@elixir-mcp/tools/activity/summary";
import { accountCtx, callTool } from "./ctx.mjs";
import { featuredDeck } from "./build-arena.mjs";
import { modeLabel, tryTool } from "./shared.mjs";

/** People drawn as cards with a deck (three tool calls each); anyone
 *  past this is a line. */
const CARD_CAP = 10;

const MOMENT_KINDS = new Set([
  "badge_earned",
  "legendary_badge_earned",
  "arena_changed",
  "ranked_promotion",
  "best_trophies_band",
  "collection_level_step",
  "career_wins_step",
  "card_unlocked",
  "card_form_unlocked",
  "clan_joined",
  "clan_left",
  "returned",
]);

export async function buildTracking({ db, account, week, season }) {
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
    accountId: account.accountId,
    // The mail goes to the person's own address, nowhere else.
    interactive: true,
    // Moments only, chosen BEFORE the timeline's cap (review 2026-09-27
    // §6.8): the cap is spent on what the mail can say, and attested
    // facts (an away is never mail, DECISIONS) never enter the mail path.
    filter: (it) => MOMENT_KINDS.has(it.kind),
  });
  // Each subject's newest moments, newest first: the timeline's own
  // order, a newsfeed (Jamie, 2026-09-23).
  const momentsFor = (tag) =>
    items
      .filter((it) => it.subject_tag === tag)
      .slice(0, 8)
      .map((it) => {
        const text = it.text ?? itemText(it, tz);
        // "Wed 22:57 thingles joined Elixir Kings." -> when + the rest
        const m = /^(\w{3} \d{2}:\d{2})\s+(.*)$/.exec(text);
        return m ? { when: m[1], text: m[2] } : { when: "", text };
      });
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
    moments: momentsFor(e.subject_tag),
  });
  const primary = players.find((e) => e.relationship === "primary");
  const alts = players.filter((e) => e.relationship === "alt").map(one);
  const friends = players.filter((e) => e.relationship === "friend").map(one);
  // The cards: friends first, then the players watched, busiest first.
  const ctx = accountCtx(db, account);
  const window = { from: week.from.toISOString(), to: week.to.toISOString() };
  const played = [
    ...players.filter((e) => e.relationship === "friend"),
    ...players
      .filter((e) => e.relationship === "watching")
      .sort((a, b) => b.battles.played - a.battles.played),
  ].filter((e) => e.battles.played > 0);
  const cards = new Map();
  for (const e of played.slice(0, CARD_CAP))
    cards.set(e.subject_tag, await personWeek(ctx, e.subject_tag, window));
  if (primary)
    cards.set(
      primary.subject_tag,
      await personWeek(ctx, primary.subject_tag, window, { deck: false }),
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
        else if (n.kind === "clan_left") bits.push(`left ${n.clan_name}`);
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
        delta:
          e.trophies?.from != null && e.trophies?.to != null
            ? e.trophies.to - e.trophies.from
            : null,
        trophies:
          e.trophies?.from != null && e.trophies?.to != null
            ? { from: e.trophies.from, to: e.trophies.to }
            : null,
        moments: momentsFor(e.subject_tag),
        ...(cards.get(e.subject_tag) ?? {}),
      };
    })
    .sort((a, b) => (b.battles ?? 0) - (a.battles ?? 0));
  const clanRows = clans.map((e) => ({
    tag: e.subject_tag,
    name: e.name ?? e.subject_tag,
    line: e.summary ? e.summary.replace(/^[^:]+:\s*/, "") : "",
  }));
  return {
    week: { label: week.label, key: week.key, season },
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
    })),
    preheader: primary ? primary.summary : undefined,
    coverage: `${subjects.length} subjects tracked; ${quiet.length ? `${quiet.length} with nothing recorded this week (read days since poll before calling the silence theirs)` : "every tracked player was polled inside the week"}.`,
  };
}

/** One person's week the way the card draws it: a record per mode
 *  family (battles_performance's own split) and the deck played most
 *  (battles_decks, then the deck read by its hash for its art). */
async function personWeek(ctx, tag, window, { deck = true } = {}) {
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
  const full = top
    ? await tryTool(callTool, ctx, "battles_decks", {
        player_tag: tag,
        ...window,
        deck_hash: top.deck_hash,
      })
    : null;
  return {
    by_family,
    deck: featuredDeck(top, full?.decks?.[0]),
    decks_used: list?.total_decks ?? null,
    deck_battles: list?.total_battles_in_window ?? null,
  };
}

function modesText(byMode) {
  if (!byMode) return "";
  const entries = Object.entries(byMode)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  return entries
    .map(([m, n]) => `${n} ${modeLabel(m, "").toLowerCase()}`)
    .join(", ");
}
