/**
 * What the clan's own model is told (Jamie, 2026-10-11: "The intent is to
 * become even more contextual and pull in the variety of data elixir
 * has"). One builder for both of its uses: the leaders' reviewed drafts
 * (words.mjs) and the activity posts in the clan's Discord
 * (activity.mjs). Both receive the same labelled, verified facts from
 * Elixir's record:
 *
 *  - the clan (`clanContext`): its name, its own words and goals, its
 *    member count and its last finished war weeks (week and place). The
 *    same text for every request of a clan, in a stable order, so it is
 *    the prompt's cached prefix;
 *  - a member (`memberLines`): their name, trophies and best, arena,
 *    career wins, collection level, time in the clan (and an earlier
 *    stint), their recent war weeks (decks used and points: never a
 *    member's share of fame), their recent moments in the clan's
 *    timeline and the awards they hold here;
 *  - what happened: an Action's own evidence (`actionLines`) or a
 *    timeline item's facts (`itemLines`).
 *
 * What never enters a packet: another leader's note, a hold, a removal's
 * rationale or inactivity numbers, what a demotion's review counted, the
 * last battle's bookkeeping, any private Clan state beyond the Action's
 * own evidence, fame per member, corpus statistics. Absence over
 * a guess: a fact the record does not hold is left out, never filled in.
 *
 * And the checks the answers get: a number or a proper name that is not
 * in the packet (`inventedNumbers`, `unknownNames`). A draft a leader
 * reads gets a warning; a Discord post nobody reads is refused.
 *
 * Pure: facts in, text out.
 */

import { GOALS } from "./goals.mjs";
import { FIELDS } from "./policy.mjs";
import { MODE_GROUP_LABEL } from "./render.mjs";

const n = (x) => Number(x).toLocaleString("en-US");
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const plural = (k, word) => `${n(k)} ${word}${k === 1 ? "" : "s"}`;
const day = (iso) => (typeof iso === "string" ? iso.slice(0, 10) : null);
/** One line of text: no line breaks a value could smuggle in. */
const one = (v, max = 160) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** "season 135 week 4" from a war week's keys (the week counted from 0). */
export const weekName = (w) =>
  `season ${w.season_id} week ${Number(w.section_index) + 1}${w.is_colosseum ? " (Colosseum)" : ""}`;

/**
 * The clan, as every request of this clan begins: stable for the same
 * clan and the same record, so it is cached. `facts` is the gatherer's
 * `clan` (members, war); `pitch` the clan's recruiting words; `voice` the
 * leaders' words for its Discord posts; `goals` the policy's declared
 * goals.
 */
export function clanContext({
  name = null,
  pitch = null,
  voice = null,
  goals = [],
  facts = null,
} = {}) {
  const lines = ["THE CLAN", `Name: ${one(name) || "a Clash Royale clan"}`];
  if (pitch?.tagline) lines.push(`Its tagline: ${one(pitch.tagline)}`);
  if (pitch?.about) lines.push(`In its own words: ${one(pitch.about, 600)}`);
  if (voice) lines.push(`How its leaders want it to sound: ${one(voice, 400)}`);
  if (goals.length)
    lines.push(
      `What it is for: ${goals.map((g) => GOALS[g]?.label ?? g).join(", ")}`,
    );
  if (isNum(facts?.members)) lines.push(`Members now: ${facts.members}`);
  const war = (facts?.war ?? []).filter((w) => isNum(w.rank));
  if (war.length)
    lines.push(
      `Recent war weeks: ${war
        .map(
          (w) =>
            `${weekName(w)}: place ${w.rank}${isNum(w.trophy_change) ? `, ${w.trophy_change > 0 ? "+" : ""}${w.trophy_change} war trophies` : ""}`,
        )
        .join("; ")}`,
    );
  return lines.join("\n");
}

/**
 * One member as the record knows them. `scope` is "full" (a welcome, a
 * promotion, a moment), "contribution" (a departure or a removal: time
 * in the clan and what they gave, never their trophies or idle days) or
 * "history" (a demotion: their time in the clan and the awards they
 * hold; never a war week, since the recorded weeks are the review's own
 * window, and never their trophies or moments).
 */
export function memberLines(m, { scope = "full", label = "MEMBER" } = {}) {
  if (!m) return [];
  const lines = [`${label}: ${one(m.name) || "a member"}`];
  if (scope === "full") {
    if (m.role) lines.push(`Role in the clan: ${ROLE[m.role] ?? m.role}`);
    if (isNum(m.trophies))
      lines.push(
        `Trophies: ${n(m.trophies)}${isNum(m.best_trophies) ? `; best ever ${n(m.best_trophies)}` : ""}`,
      );
    if (m.arena) lines.push(`Arena: ${one(m.arena)}`);
    if (isNum(m.career_wins)) lines.push(`Career wins: ${n(m.career_wins)}`);
    if (isNum(m.collection_level))
      lines.push(`Collection level: ${m.collection_level}`);
  }
  if (isNum(m.tenure_days) && m.joined_at)
    lines.push(
      m.baseline
        ? `Time in the clan: at least ${plural(m.tenure_days, "day")} (recorded since ${day(m.joined_at)}, when Elixir first read the clan; they may have joined earlier)`
        : `Time in the clan: ${plural(m.tenure_days, "day")} (joined ${day(m.joined_at)})`,
    );
  if (m.stints_before > 0)
    lines.push(
      `Earlier time in this clan: ${plural(m.stints_before, "earlier stint")}${m.last_left_at ? `, the last ending ${day(m.last_left_at)}` : ""}`,
    );
  const war = (scope === "history" ? [] : (m.war ?? [])).filter(
    (w) => isNum(w.decks_used) || isNum(w.points),
  );
  if (war.length)
    lines.push(
      `War weeks (their decks used and points): ${war
        .map(
          (w) =>
            `${weekName(w)}: ${isNum(w.decks_used) ? plural(w.decks_used, "deck") : "decks unknown"}${isNum(w.points) ? `, ${n(w.points)} points` : ""}`,
        )
        .join("; ")}`,
    );
  if (scope === "full" && m.moments?.length)
    lines.push(
      `Their recent moments: ${m.moments
        .slice(0, 5)
        .map((x) => `${day(x.at) ?? ""} ${one(x.text, 220)}`.trim())
        .join(" | ")}`,
    );
  if (scope !== "contribution" && m.awards?.length)
    lines.push(
      `Awards they hold in this clan: ${m.awards
        .slice(0, 6)
        .map(
          (a) =>
            `${one(a.name, 60)} (season ${a.season_id}${isNum(a.value) ? `, ${n(a.value)} ${UNIT[a.unit] ?? a.unit ?? ""}`.trimEnd() : ""})`,
        )
        .join("; ")}`,
    );
  return lines;
}

const ROLE = {
  leader: "Leader",
  coLeader: "Co-leader",
  elder: "Elder",
  member: "Member",
};
const UNIT = {
  points: "points",
  donations: "donations",
  war_decks: "war decks",
};

/** An Action's facts that are Elixir's bookkeeping, never the moment: the
 *  last battle (whose older wording added "capture does not prove
 *  inactivity") and what a removal rests on. */
const UNTOLD_FACTS = new Set(["last_battle", "rests_on"]);

/**
 * What happened, for an Action a leader drafts words for: the Action's
 * own evidence in a person's terms. `card` is the Action, `grants` the
 * award receipts an announcement names, `policyLines` the policy as
 * members read it (`describePolicy`, for how the clan runs).
 */
export function actionLines(
  kind,
  { card = null, grants = [], policyLines = [] } = {},
) {
  const ev = card?.evidence ?? {};
  const lines = ["WHAT HAPPENED"];
  if (kind === "demotion") {
    // A demotion is told none of what the review counted (Jamie,
    // 2026-10-20): its words thank the member for what came before, so
    // no shortfall, no idle days and no number of the review's window
    // reach the model.
    lines.push(
      "This Elder moves back to Member for now; Elder can come back. Why is not yours to say, and you are not told it.",
    );
  } else if (kind === "promotion") {
    lines.push("The clan's own rules just made this member an Elder.");
    const facts = (ev.facts ?? []).filter(
      (f) => f?.label && f?.value && !UNTOLD_FACTS.has(f.key),
    );
    if (ev.phrase) lines.push(`In short: ${one(ev.phrase, 200)}`);
    if (facts.length)
      lines.push(
        "What the rules counted:",
        ...facts.map(
          (f) =>
            `- ${one(f.label, 40)}: ${one(f.value, 120)}${f.window ? ` (${one(f.window, 60)})` : ""}`,
        ),
      );
  } else if (kind === "awards") {
    lines.push(
      `Season ${ev.season_id ?? "?"} closed and the clan granted these awards:`,
    );
    // A grant names its winner by display name, never a tag: one without
    // a name falls back to the evidence's winners, which carry names.
    const named =
      grants.length && grants.every((g) => g?.player_name)
        ? grants.map(
            (g) =>
              `- ${one(g.name ?? g.award_id, 60)}: ${one(g.player_name, 40)}${isNum(g.metric_value) ? ` (${n(g.metric_value)} ${UNIT[g.metric_unit] ?? g.metric_unit ?? ""})`.replace(" )", ")") : ""}`,
          )
        : (ev.awards ?? []).map(
            (a) =>
              `- ${one(a.name, 60)}: ${(a.winners ?? []).map((w) => one(w, 40)).join(", ")}`,
          );
    lines.push(...named);
    if (isNum(ev.parts) && ev.parts > 1)
      lines.push(`This is announcement ${ev.part} of ${ev.parts}.`);
  } else if (kind === "rules") {
    lines.push(
      ev.version === 1
        ? "The clan now runs with Elixir Clan: members can sign in with Elixir to see how it works and where they stand."
        : `The clan changed how it runs: ${(ev.changes ?? []).map((c) => one(c, 80)).join(", ") || "some settings"}. Members can see how it works in Elixir Clan.`,
    );
    if (policyLines.length)
      lines.push(
        "How the clan runs now, as members read it:",
        ...policyLines.slice(0, 16).map((l) => `- ${one(l, 300)}`),
      );
  } else if (kind === "welcome") {
    lines.push(
      ev.welcome?.returning
        ? "A member came back: the record shows an earlier time in this clan."
        : "A new member joined the clan.",
    );
    if (ev.joined_at) lines.push(`Joined: ${day(ev.joined_at)}`);
    const fact = welcomeFact(ev.welcome);
    if (fact) lines.push(fact);
  } else if (kind === "departure") {
    const c = card?.outcome?.classification;
    lines.push(
      c === "member_left"
        ? "A leader confirmed the member left the clan on their own."
        : "A leader confirmed the member was removed from the clan.",
    );
    if (ev.left_at) lines.push(`Departed: ${day(ev.left_at)}`);
  } else if (kind === "removal") {
    lines.push(
      "The leaders may remove this member for inactivity. These words are for clan chat only after a leader has done it.",
    );
  }
  return lines;
}

/** The one detail frozen with a welcome when it was raised, with when the
 *  record saw it: from its typed value, never free text, so a later
 *  profile read never stands in for what the Action was raised on. */
function welcomeFact(w) {
  const seen = day(w?.source_as_of);
  if (!seen || w?.returning === true || !Number.isSafeInteger(w?.value))
    return null;
  if (w.kind === "career_wins" && w.value >= 1000)
    return `From their profile as the record saw it on ${seen}: ${n(Math.floor(w.value / 1000) * 1000)}+ career wins`;
  if (w.kind === "best_trophies" && w.value > 0)
    return `From their profile as the record saw it on ${seen}: best ever ${n(w.value)} trophies`;
  return null;
}

/** A timeline item's facts as labelled lines: nested values flattened to
 *  a path ("best_win.opponent.name: Jotaro"), never a tag, an id, an
 *  address or a time, at most five of a list, never fame per member. */
export function itemFactLines(facts, { max = 40 } = {}) {
  const out = [];
  const walk = (value, path, depth, inMembers) => {
    if (out.length >= max || value == null) return;
    const key = path.at(-1) ?? "";
    if (
      // A season is the moment's, not an id: it stays.
      (key !== "season_id" &&
        /(_tag|_id|^id|^tag|url|_at|^at|_ms)$/i.test(key)) ||
      // Bookkeeping, not the moment: the attester's stamp and who sees it.
      ["evidence", "attested_by", "visibility"].includes(key)
    )
      return;
    if (inMembers && /fame/i.test(key)) return;
    if (Array.isArray(value)) {
      value
        .slice(0, 5)
        .forEach((v, i) =>
          walk(
            v,
            [...path, String(i + 1)],
            depth + 1,
            inMembers || key === "members",
          ),
        );
      return;
    }
    if (typeof value === "object") {
      if (depth >= 3) return;
      for (const [k, v] of Object.entries(value))
        walk(v, [...path, k], depth + 1, inMembers);
      return;
    }
    if (typeof value === "string" && value.length > 120) return;
    out.push(
      `${path.join(".")}: ${typeof value === "number" ? n(value) : one(value)}`,
    );
  };
  walk(facts ?? {}, [], 0, false);
  return out;
}

/** Every recorded name a timeline item's facts carry: a member's, a
 *  previous name, an opponent's, a rival clan's, a teammate's, an arena
 *  or a card. Strings under a key that ends in `name`, at any depth.
 *  `people`: only a player's or a clan's own name (`name`,
 *  `previous_name`), never an arena's, a league's or a card's. */
export function namesInFacts(facts, { people = false } = {}) {
  const out = new Set();
  // A thing's name (an arena's, a league's, a card's, a badge's) is not a
  // person's: it may be said, but need not be.
  const THING =
    /arena|league|card|badge|form|mode|deck|award|path|season|tier/i;
  const wanted = (key, parent) =>
    people
      ? (key === "name" || key === "previous_name") && !THING.test(parent)
      : /name$/i.test(key);
  const walk = (value, key, parent, depth) => {
    if (value == null || depth > 4) return;
    if (Array.isArray(value)) {
      for (const v of value) walk(v, key, parent, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k, key, depth + 1);
      return;
    }
    if (typeof value === "string" && wanted(key, parent) && value.trim())
      out.add(value.trim());
  };
  walk(facts ?? {}, "", "", 0);
  return [...out];
}

/* ------------------------------------------------------------------ */
/* A member's dossier, for a leader's draft about them                 */
/* ------------------------------------------------------------------ */

/** Played war weeks told one by one; older ones are told by season. */
const DOSSIER_WEEKS_LISTED = 12;
/** Story angles told, strongest first. */
const ANGLES_MAX = 4;
/** The fewest games a deck needs to be an angle of its own. */
const ANGLE_DECK_GAMES = 10;

/**
 * The weeks a demotion's rules counted, from the clan's policy: its
 * longest counting window and the reviews in a row that demote, as war
 * weeks or whole weeks back from the newest (Jamie, 2026-10-20: a
 * demotion never uses the recent window's numbers). At least four,
 * at most sixteen; the policy's defaults when it has none.
 */
export function recentWeeksFor(values = null) {
  const v = (key) => {
    const x = values?.[key];
    return Number.isInteger(x) ? x : FIELDS[key].default;
  };
  const window = Math.max(
    v("war_window_weeks"),
    v("ranked_window_weeks"),
    v("donations_window_weeks"),
    v("minimums_window_weeks"),
  );
  const reviews = Math.max(
    v("demote_abandoned_weeks"),
    v("demote_outranked_weeks"),
  );
  return Math.min(16, Math.max(4, window + reviews - 1));
}

/**
 * What each kind of draft may be told of the dossier, as numbers worked
 * out once so the lines and the angles say the same thing:
 *  - a promotion or a welcome: all of it;
 *  - a demotion: only what they gave before the recent weeks (war weeks
 *    played, donations given, older than `recentWeeks`); never a week
 *    they missed, a zero, days since, their profile or the last 28 days
 *    (Jamie, 2026-10-20);
 *  - a removal or a departure: the war weeks they played, nothing else.
 */
function dossierFacts(d, kind, { recentWeeks = 4 } = {}) {
  const thanks = kind === "demotion";
  const contribution = kind === "removal" || kind === "departure";
  const full = !thanks && !contribution;
  const war = (d?.war ?? []).filter(
    (w) =>
      isNum(w.decks_used) &&
      w.decks_used > 0 &&
      (!thanks || w.ago >= recentWeeks),
  );
  const played = war.length
    ? {
        weeks: war.length,
        decks: war.reduce((t, w) => t + w.decks_used, 0),
        points: war.reduce((t, w) => t + (isNum(w.points) ? w.points : 0), 0),
        best: war.reduce((b, w) =>
          (isNum(w.points) ? w.points : -1) > (isNum(b.points) ? b.points : -1)
            ? w
            : b,
        ),
      }
    : null;
  // The longest run of consecutive finished weeks played (newest wins a
  // tie): `ago` counts the clan's finished weeks, so a gap is a week the
  // clan finished without them.
  let run = null;
  for (let i = 0; i < war.length;) {
    let j = i;
    while (j + 1 < war.length && war[j + 1].ago === war[j].ago + 1) j++;
    const weeks = war.slice(i, j + 1);
    if (weeks.length >= 2 && weeks.length > (run?.weeks.length ?? 0))
      run = {
        weeks,
        points: weeks.reduce((t, w) => t + (isNum(w.points) ? w.points : 0), 0),
      };
    i = j + 1;
  }
  const donated = contribution
    ? []
    : (d?.donations?.weeks ?? []).filter(
        (w) =>
          isNum(w.donations) &&
          w.donations > 0 &&
          (!thanks || w.ago >= recentWeeks),
      );
  const donations = donated.length
    ? {
        weeks: donated,
        total: donated.reduce((t, w) => t + w.donations, 0),
        best: donated.reduce((b, w) => (w.donations > b.donations ? w : b)),
      }
    : null;
  const p = full ? d?.profile : null;
  const decks = full
    ? (d?.decks ?? []).filter((m) => MODE_GROUP_LABEL[m.mode] && m.games > 0)
    : [];
  return {
    war,
    played,
    run,
    allInRow: Boolean(run && played && run.weeks.length === played.weeks),
    donations,
    career:
      full && isNum(d?.donations?.career) && d.donations.career > 0
        ? d.donations.career
        : null,
    profile: p,
    decks,
    days: isNum(d?.days) ? d.days : 28,
    moments: full ? (d?.moments ?? []).filter((m) => m?.text) : [],
    roles: full
      ? (d?.roles ?? []).filter((r) => r?.after && r.after !== r.before)
      : [],
  };
}

const losses = (k) => `${n(k)} loss${k === 1 ? "" : "es"}`;
const record = (x) =>
  `${plural(x.games, "game")}, ${plural(x.wins, "win")}, ${losses(x.losses)}`;
const weekPlayed = (w) =>
  `${weekName(w)}: ${plural(w.decks_used, "deck")}${isNum(w.points) ? `, ${n(w.points)} points` : ""}`;
const roleName = (r) => ROLE[r] ?? r;

/**
 * A member's dossier as labelled lines from Elixir's record, for the
 * draft of `kind` (what each kind is told: `dossierFacts`). Facts, never
 * a rating, rank, share or rate; a deck's wins and losses are counted
 * for its mode alone; war is points, never fame. Empty when nothing is
 * left to tell.
 */
export function dossierLines(dossier, kind, { recentWeeks = 4 } = {}) {
  if (!dossier) return [];
  const f = dossierFacts(dossier, kind, { recentWeeks });
  const lines = [];
  if (f.war.length) {
    const listed = f.war.slice(0, DOSSIER_WEEKS_LISTED);
    lines.push(
      `War weeks they played in this clan, newest first (decks used, points): ${listed.map(weekPlayed).join("; ")}`,
    );
    const seasons = new Map();
    for (const w of f.war.slice(DOSSIER_WEEKS_LISTED)) {
      const s = seasons.get(w.season_id) ?? { weeks: 0, decks: 0, points: 0 };
      s.weeks += 1;
      s.decks += w.decks_used;
      s.points += isNum(w.points) ? w.points : 0;
      seasons.set(w.season_id, s);
    }
    if (seasons.size)
      lines.push(
        `Earlier war weeks they played here, by season: ${[...seasons]
          .map(
            ([id, s]) =>
              `season ${id}: ${plural(s.weeks, "week")}, ${plural(s.decks, "deck")}, ${n(s.points)} points`,
          )
          .join("; ")}`,
      );
    const b = f.played.best;
    lines.push(
      `Across those war weeks: ${plural(f.played.weeks, "week")} played, ${plural(f.played.decks, "deck")}, ${n(f.played.points)} points; their best week ${weekName(b)}: ${plural(b.decks_used, "deck")}${isNum(b.points) ? `, ${n(b.points)} points` : ""}${f.allInRow ? `; all ${f.run.weeks.length} in a row, ${weekName(f.run.weeks.at(-1))} to ${weekName(f.run.weeks[0])}` : ""}`,
    );
    if (f.run && !f.allInRow)
      lines.push(
        `Their longest run of war weeks played in a row: ${f.run.weeks.length} weeks, ${weekName(f.run.weeks.at(-1))} to ${weekName(f.run.weeks[0])}, ${n(f.run.points)} points together`,
      );
  }
  if (f.donations)
    lines.push(
      `Donations they gave in this clan, by week (the week starting): ${f.donations.weeks
        .map((w) => `${w.week}: ${n(w.donations)}`)
        .join(
          "; ",
        )}; ${n(f.donations.total)} across these ${plural(f.donations.weeks.length, "week")}, ${n(f.donations.best.donations)} their best (the week of ${f.donations.best.week})`,
    );
  if (f.career)
    lines.push(`Donations in their career, every clan: ${n(f.career)}`);
  const p = f.profile;
  if (p) {
    const game = [];
    if (isNum(p.years_played) && p.years_played > 0)
      game.push(`${plural(p.years_played, "year")} playing Clash Royale`);
    if (p.favorite_card)
      game.push(`favourite card ${one(p.favorite_card, 40)}`);
    if (isNum(p.masteries_at_top) && p.masteries_at_top > 0)
      game.push(
        `${plural(p.masteries_at_top, "card")} at Mastery level ${p.mastery_level}${p.masteries?.length ? ` (${p.masteries.map((c) => one(c, 40)).join(", ")}${p.masteries_at_top > p.masteries.length ? " and more" : ""})` : ""}`,
      );
    if (isNum(p.pol_best_league))
      game.push(
        `best Path of Legends league reached: league ${p.pol_best_league}`,
      );
    if (isNum(p.clan_war_wins) && p.clan_war_wins > 0)
      game.push(`Clan War Wins badge at ${n(p.clan_war_wins)}`);
    if (game.length)
      lines.push(`In the game (their profile): ${game.join("; ")}`);
    if (p.legendary_badges?.length)
      lines.push(
        `Legendary badges they hold: ${p.legendary_badges.map((b) => one(b, 60)).join(", ")}`,
      );
  }
  if (f.decks.length)
    lines.push(
      `Their decks over the last ${f.days} days, each mode on its own: ${f.decks
        .map(
          (m) =>
            `${MODE_GROUP_LABEL[m.mode]}: ${record(m)}${m.decks?.length ? `; most played ${m.decks.map((x) => `${one(x.label, 60)} (${record(x)})`).join(", ")}` : ""}`,
        )
        .join(" | ")}`,
    );
  if (f.moments.length)
    lines.push(
      `Their milestones over the last ${f.days} days: ${f.moments
        .map((x) => `${day(x.at) ?? ""} ${one(x.text, 220)}`.trim())
        .join(" | ")}`,
    );
  if (f.roles.length)
    lines.push(
      `Their role changes in this clan, newest first: ${f.roles
        .map(
          (r) =>
            `${day(r.at)}: ${roleName(r.before) ?? "?"} to ${roleName(r.after)}`,
        )
        .join("; ")}`,
    );
  return lines.length
    ? ["MEMBER DOSSIER (more of Elixir's record of this member)", ...lines]
    : [];
}

/**
 * Three or four short story angles, chosen by code and strongest first,
 * for the draft of `kind`: each a fact the dossier (or the member block,
 * `member`, for tenure and awards) states, with no number it does not
 * state. The model may use them or not; it is never told to.
 */
export function storyAngles(
  dossier,
  kind,
  { recentWeeks = 4, member = null } = {},
) {
  if (!dossier) return [];
  const f = dossierFacts(dossier, kind, { recentWeeks });
  const full =
    kind !== "demotion" && kind !== "removal" && kind !== "departure";
  const welcome = kind === "welcome";
  const out = [];
  const add = (score, text) => text && out.push({ score, text });
  if (f.run)
    add(
      { promotion: 92, welcome: 64, demotion: 96 }[kind] ?? 90,
      `${f.run.weeks.length} war weeks in a row in this clan, ${weekName(f.run.weeks.at(-1))} to ${weekName(f.run.weeks[0])}: ${n(f.run.points)} points together.`,
    );
  if (f.played) {
    const b = f.played.best;
    add(
      { promotion: 80, welcome: 60, demotion: 86 }[kind] ?? 85,
      `Their best war week here: ${weekName(b)}, ${plural(b.decks_used, "deck")}${isNum(b.points) ? ` and ${n(b.points)} points` : ""}.`,
    );
    // A run that is every week they played already says the total.
    if (!f.allInRow)
      add(
        { promotion: 66, welcome: 62, demotion: 90 }[kind] ?? 95,
        `${plural(f.played.weeks, "war week")} played in this clan: ${plural(f.played.decks, "deck")} and ${n(f.played.points)} points across them.`,
      );
  }
  if (f.donations)
    add(
      kind === "demotion" ? 70 : 60,
      `${n(f.donations.total)} donations to the clan over ${plural(f.donations.weeks.length, "week")}, ${n(f.donations.best.donations)} in their best (the week of ${f.donations.best.week}).`,
    );
  if (f.career)
    add(welcome ? 55 : 35, `${n(f.career)} donations in their career.`);
  const p = f.profile;
  if (p && isNum(p.years_played) && p.years_played > 0)
    add(
      welcome ? 78 : 50,
      `${plural(p.years_played, "year")} playing Clash Royale${isNum(p.masteries_at_top) && p.masteries_at_top > 0 ? `, with ${plural(p.masteries_at_top, "card")} at Mastery level ${p.mastery_level}` : ""}.`,
    );
  if (p?.legendary_badges?.length)
    add(
      welcome ? 80 : 55,
      `Legendary badges: ${p.legendary_badges
        .slice(0, 3)
        .map((b) => one(b, 60))
        .join(", ")}.`,
    );
  if (p && isNum(p.pol_best_league))
    add(
      welcome ? 70 : 45,
      `Best Path of Legends league reached: league ${p.pol_best_league}.`,
    );
  if (p && isNum(p.clan_war_wins) && p.clan_war_wins > 0 && welcome)
    add(60, `Their Clan War Wins badge is at ${n(p.clan_war_wins)}.`);
  const top = f.decks
    .flatMap((m) => (m.decks ?? []).map((x) => ({ ...x, mode: m.mode })))
    .filter((x) => x.games >= ANGLE_DECK_GAMES)
    .sort((a, b) => b.games - a.games)[0];
  if (top)
    add(
      welcome ? 85 : 70,
      `On ${MODE_GROUP_LABEL[top.mode]} over the last ${f.days} days: ${one(top.label, 60)}, ${plural(top.wins, "win")} and ${losses(top.losses)}.`,
    );
  const moment = f.moments[0];
  if (moment)
    add(
      welcome ? 75 : 72,
      `A recent milestone (${day(moment.at)}): ${one(moment.text, 220)}`,
    );
  const elder = f.roles.find(
    (r) => r.after === "elder" && r.before === "member",
  );
  if (elder && kind === "promotion")
    add(75, `They were made Elder here before, on ${day(elder.at)}.`);
  if (full && member?.awards?.length) {
    const a = member.awards[0];
    add(
      85,
      `They hold the clan's ${one(a.name, 60)} award (season ${a.season_id}).`,
    );
  } else if (kind === "demotion" && member?.awards?.length) {
    const a = member.awards[0];
    add(
      88,
      `They hold the clan's ${one(a.name, 60)} award (season ${a.season_id}).`,
    );
  }
  if (welcome && member?.stints_before > 0)
    add(
      95,
      `They are back: ${plural(member.stints_before, "earlier stint")} in this clan.`,
    );
  if (
    !welcome &&
    isNum(member?.tenure_days) &&
    member.tenure_days > 0 &&
    member.joined_at
  )
    add(
      { promotion: 40, demotion: 80 }[kind] ?? 80,
      `${member.baseline ? "At least " : ""}${plural(member.tenure_days, "day")} in the clan${member.baseline ? "" : ` (joined ${day(member.joined_at)})`}.`,
    );
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, ANGLES_MAX)
    .map((x) => x.text);
}

/** The angles block's heading; a draft's ask points at it when present. */
export const ANGLES_HEADING =
  "STORY ANGLES (Elixir's pick from the record, strongest first)";

/** The angles as the packet's block, numbered strongest first. */
export function angleLines(angles) {
  return angles?.length
    ? [ANGLES_HEADING, ...angles.map((a, i) => `${i + 1}. ${a}`)]
    : [];
}

/** The dossier and its angles, as a draft's packet adds them after the
 *  member block. */
export function dossierBlock(
  dossier,
  kind,
  { recentWeeks = 4, member = null } = {},
) {
  const lines = dossierLines(dossier, kind, { recentWeeks });
  const angles = angleLines(
    storyAngles(dossier, kind, { recentWeeks, member }),
  );
  return [
    ...(lines.length ? ["", ...lines] : []),
    ...(angles.length ? ["", ...angles] : []),
  ];
}

/* ------------------------------------------------------------------ */
/* The checks                                                          */
/* ------------------------------------------------------------------ */

/** The numbers in a text, thousands separators ignored: "10,040" is
 *  10040, "S135" holds 135, "100%" holds 100. */
export const numbersOf = (text) =>
  (
    String(text ?? "")
      .replace(/(\d),(?=\d{3}\b)/g, "$1")
      .match(/\d+(?:\.\d+)?/g) ?? []
  ).map(Number);

/** Numbers a text states that its packet does not hold. */
export function inventedNumbers(text, packet) {
  const known = new Set(numbersOf(packet));
  return [...new Set(numbersOf(text).filter((x) => !known.has(x)))];
}

/** Capitalised words any message may use without a packet naming them:
 *  the game's and Elixir's own vocabulary, greetings, days and months. */
const COMMON = new Set(
  `I A An The And But So Or If We Our Us You Your They Their He She His Her It Its This That These Those
  What Who When Where How Why Well Nice Huge Big Great Good Massive Awesome Amazing Congrats Congratulations
  Welcome Hello Hi Hey Thanks Thank Cheers GG GL LFG MVP OMG Wow Yes No Let Lets Keep Go Here There All Every
  Clan Clans Wars War River Race Boat Colosseum Season Seasons Week Weeks Day Days Elder Elders Member Members
  Leader Leaders Co Coleader Arena Arenas League Leagues Path Legends Trophy Trophies Road Ranked Ladder
  Champion Champions Ultimate Grand Royal Legendary Badge Badges Card Cards Evolution Evo Hero Heroes Deck Decks
  King Kings Tower Crown Crowns Elixir Discord Clash Royale Supercell
  Monday Tuesday Wednesday Thursday Friday Saturday Sunday
  January February March April May June July August September October November December`.split(
    /\s+/,
  ),
);

/**
 * Proper names a text uses that its packet does not: a capitalised word
 * (not the first of a sentence) that appears nowhere in the packet, the
 * leader's note included, and is not the game's own vocabulary. A
 * renamed opponent ("Jotaro" written "Jotarro") or an invented one is
 * caught; a name written in lower case is not, which the exact-name
 * check covers for the names a line must keep.
 */
export function unknownNames(text, packet) {
  const known = String(packet ?? "").toLowerCase();
  const out = new Set();
  const sentences = String(text ?? "").split(/(?<=[.!?:;])\s+|\n+/);
  for (const s of sentences) {
    const words = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) ?? [];
    words.forEach((w, i) => {
      if (i === 0) return;
      if (!/^\p{Lu}/u.test(w)) return;
      const bare = w.replace(/['’]s$/u, "");
      if (COMMON.has(bare) || COMMON.has(bare.replace(/s$/, ""))) return;
      if (known.includes(bare.toLowerCase())) return;
      out.add(bare);
    });
  }
  return [...out];
}

/* ------------------------------------------------------------------ */
/* The answer's shape                                                  */
/* ------------------------------------------------------------------ */

/** Keywords strict tool use does not take: a length or count limit is
 *  said in the field's description and checked here after the answer. */
const UNSTRICT = [
  "maxLength",
  "minLength",
  "maxItems",
  "minItems",
  "minimum",
  "maximum",
];

/**
 * A tool as a strict one (Claude's `strict: true`): the answer is
 * sampled to match its schema, so a field is never missing or of the
 * wrong type. Every object is closed (`additionalProperties: false`) and
 * requires all its fields; the limits strict mode does not take are left
 * to the descriptions and the engine's own checks.
 */
export function strictTool(tool) {
  const close = (schema) => {
    if (!schema || typeof schema !== "object") return schema;
    const out = {};
    for (const [k, v] of Object.entries(schema)) {
      if (UNSTRICT.includes(k)) continue;
      if (k === "properties")
        out.properties = Object.fromEntries(
          Object.entries(v).map(([name, s]) => [name, close(s)]),
        );
      else if (k === "items") out.items = close(v);
      else out[k] = v;
    }
    if (out.type === "object") {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties ?? {});
    }
    return out;
  };
  return { ...tool, strict: true, input_schema: close(tool.input_schema) };
}
