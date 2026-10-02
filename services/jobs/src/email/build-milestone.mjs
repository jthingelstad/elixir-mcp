/** milestone: congratulations for a FIRST on the recipient's own tags
 *  (primary and alts), from the same named moments the timeline
 *  serves. Firsts, never downs: each moment's identity (the arena, the
 *  league, the band, the step, the badge, the card) mails once per
 *  account and subject, ever (email_milestone), so a season's re-climb
 *  of an arena already celebrated is silent and a higher one is news.
 *  Bundled: everything new since the last look goes in one mail. */
import { buildPlayerEntry } from "@elixir-mcp/tools/activity/entries";
import { badgeLabel } from "@elixir-mcp/record/badge-names";
import { battleLinks } from "@elixir-mcp/record/battle-links";
import { formLabel, itemText } from "@elixir-mcp/tools/activity/summary";
import { myPlayers } from "./shared.mjs";
import { whenLabel } from "./week.mjs";

const KINDS = new Set([
  "arena_changed",
  "ranked_promotion",
  "best_trophies_band",
  "career_wins_step",
  "collection_level_step",
  "card_unlocked",
  "card_form_unlocked",
  "badge_earned",
  "legendary_badge_earned",
]);

/** The moment's own identity, or null when it is not a first worth mail. */
export function momentKey(kind, f) {
  switch (kind) {
    case "arena_changed":
      return f.to != null && (f.from == null || Number(f.to) > Number(f.from))
        ? `arena:${f.to}`
        : null;
    case "ranked_promotion":
      return f.to != null && (f.from == null || Number(f.to) > Number(f.from))
        ? `league:${f.to}`
        : null;
    case "best_trophies_band":
      return f.band != null ? `band:${f.band}` : null;
    case "career_wins_step":
      return f.step != null ? `wins:${f.step}` : null;
    case "collection_level_step":
      return f.step != null ? `collection:${f.step}` : null;
    case "card_unlocked":
      return f.card
        ? `card:${f.card}${f.evolution ? `:${f.evolution}` : ""}`
        : null;
    // An Evolution and a Hero of one card are two firsts (#110).
    case "card_form_unlocked":
      return f.card_id != null && f.form ? `form:${f.card_id}:${f.form}` : null;
    case "badge_earned":
    case "legendary_badge_earned":
      return f.badge
        ? `badge:${f.badge}${f.level != null ? `:${f.level}` : ""}`
        : null;
    default:
      return null;
  }
}

/** The battle that did it, from the moment's own payload (the ingest
 *  stamped it when the moment was written): the score, who it was
 *  against and where they started, the trophies it moved. Its page's
 *  link is added once the issue's battles are known (battleLinks). */
function promotingBattle(b) {
  if (!b || b.crowns == null) return null;
  return {
    battle_id: b.battle_id ?? null,
    won: b.crowns > (b.crowns_against ?? 0),
    crowns: b.crowns,
    crowns_against: b.crowns_against ?? null,
    opponent: b.opponent
      ? {
          tag: b.opponent.player_tag,
          name: b.opponent.name ?? b.opponent.player_tag,
          starting_trophies: b.opponent.starting_trophies ?? null,
        }
      : null,
    trophy_change: b.trophy_change ?? null,
  };
}

/** A card moment's art: the card by id and the form unlocked, and its
 *  rarity under it. A moment written before card ids rode the payload
 *  has none, and the mail says it in words. */
function cardArt(f, form) {
  if (f.card_id == null || !f.card) return {};
  return {
    card: { id: Number(f.card_id), name: f.card, form: form ?? "base" },
    card_line: f.rarity
      ? `${String(f.rarity).charAt(0).toUpperCase()}${String(f.rarity).slice(1)}`
      : null,
  };
}

function card(kind, f, subject, at, tz) {
  const n = (v) => Number(v).toLocaleString("en-US");
  const who = subject.relationship === "alt" ? subject.name : "You";
  switch (kind) {
    case "arena_changed":
      return {
        headline: `${who} reached ${f.to_name ?? "a new arena"}`,
        big: f.to_name ?? null,
        big_label: [
          f.from_name ? `Up from ${f.from_name}` : "A new arena",
          f.promoted_by?.trophies_after != null
            ? `at ${n(f.promoted_by.trophies_after)} trophies`
            : null,
        ]
          .filter(Boolean)
          .join(", "),
        lines: [],
        battle: promotingBattle(f.promoted_by),
      };
    case "ranked_promotion":
      return {
        headline: `${who} advanced to ${f.to_name ?? "a new league"}`,
        big: f.to_name ?? null,
        big_label: f.from_name
          ? `Path of Legends, up from ${f.from_name}`
          : "Path of Legends",
        lines: [],
        battle: promotingBattle(f.promoted_by),
      };
    case "best_trophies_band":
      return {
        headline: `${who} set a new best: ${n(f.best)} trophies`,
        big: n(f.best),
        big_label: "personal best",
        lines: [`Past ${n(f.band)} for the first time on record.`],
      };
    case "career_wins_step":
      return {
        headline: `${who} passed ${n(f.step)} career wins`,
        big: n(f.wins ?? f.step),
        big_label: "wins, lifetime",
        lines: [],
      };
    case "collection_level_step":
      return {
        headline: `${who} reached Collection Level ${n(f.level)}`,
        big: n(f.level),
        big_label: "collection level",
        lines: [],
      };
    case "card_unlocked":
      return {
        headline: `${who} unlocked ${f.card}${f.evolution === 2 ? " (Hero)" : f.evolution === 1 ? " (Evolution)" : ""}`,
        big: null,
        lines: [],
        ...cardArt(
          f,
          f.evolution === 2 ? "hero" : f.evolution === 1 ? "evolution" : "base",
        ),
      };
    case "card_form_unlocked":
      return {
        headline: `${who} unlocked ${formLabel(f)}`,
        big: null,
        lines: [],
        ...cardArt(f, f.form),
      };
    case "badge_earned":
    case "legendary_badge_earned": {
      // The badge as a player says it (Jamie, 2026-09-19: the mail read
      // "MasterySkeletonWarriors (level 5)"; it is Guards Mastery, level 5).
      const label = f.badge_label ?? badgeLabel(f.badge);
      return {
        headline:
          f.level > 1
            ? `${who} took ${label} to level ${f.level}`
            : `${who} earned ${label}`,
        big: f.level > 1 ? String(f.level) : null,
        big_label: f.level > 1 ? `${label}, level` : undefined,
        lines: [
          kind === "legendary_badge_earned" ? "A legendary badge." : "",
          f.max_level && f.level === f.max_level ? "The top level." : "",
        ].filter(Boolean),
      };
    }
    default:
      return {
        headline: itemText({ kind, facts: f, subject_name: subject.name }, tz),
        big: null,
        lines: [],
      };
  }
}

export async function buildMilestone({ db, account, fromMs, toMs }) {
  const players = (await myPlayers(db, account.accountId)).filter(
    (p) => p.relationship === "primary" || p.relationship === "alt",
  );
  if (players.length === 0) return null;
  const tz = account.timezone;
  const fresh = [];
  for (const p of players) {
    const { items } = await buildPlayerEntry(db, {
      tag: p.tag,
      relationship: p.relationship,
      nickname: p.nickname,
      fromMs,
      toMs,
      timezone: tz,
    });
    for (const it of items) {
      if (!KINDS.has(it.kind)) continue;
      const key = momentKey(it.kind, it.facts ?? {});
      if (!key) continue;
      fresh.push({
        subject: p,
        kind: it.kind,
        key,
        at: it.at,
        facts: it.facts ?? {},
      });
    }
  }
  if (fresh.length === 0) return null;
  const { rows: seen } = await db.query(
    `select subject_tag, kind, moment_key from email_milestone where account_id = $1`,
    [account.accountId],
  );
  const seenSet = new Set(
    seen.map((r) => `${r.subject_tag}|${r.kind}|${r.moment_key}`),
  );
  const news = fresh.filter(
    (m) => !seenSet.has(`${m.subject.tag}|${m.kind}|${m.key}`),
  );
  if (news.length === 0) return null;
  // The biggest moment leads: arena and league first, then bests, then the rest, newest first inside a rank.
  const rank = {
    arena_changed: 0,
    ranked_promotion: 0,
    best_trophies_band: 1,
    legendary_badge_earned: 1,
    career_wins_step: 2,
    collection_level_step: 2,
    badge_earned: 3,
    card_unlocked: 3,
    // The collection change players care about most (#110).
    card_form_unlocked: 2,
  };
  news.sort((a, b) => rank[a.kind] - rank[b.kind] || b.at.localeCompare(a.at));
  const lead = news.filter((m) => rank[m.kind] <= 1).slice(0, 4);
  const milestones = (lead.length ? lead : news.slice(0, 3)).map((m) => ({
    kind: m.kind,
    subject: {
      tag: m.subject.tag,
      name: m.subject.name,
      relationship: m.subject.relationship,
    },
    at: whenLabel(m.at, tz),
    // The instant too: the render names the day and date in the
    // reader's zone ("Tue Sep 29, 7:53 pm").
    instant: m.at,
    ...card(m.kind, m.facts, m.subject, m.at, tz),
  }));
  // Each battle that did it gets its public page, /battle/<short id>:
  // the same link battles_query hands an agent (9.18.0).
  const links = await battleLinks(
    db,
    milestones.map((m) => m.battle?.battle_id),
  );
  for (const m of milestones)
    if (m.battle?.battle_id)
      m.battle.url = links.get(m.battle.battle_id)?.url ?? null;
  const rest = news.filter(
    (m) => !(lead.length ? lead : news.slice(0, 3)).includes(m),
  );
  return {
    account: {
      name:
        players.find((p) => p.relationship === "primary")?.nickname ??
        players[0].name,
    },
    milestones,
    also: rest.map((m) => {
      const said = card(m.kind, m.facts, m.subject, m.at, tz);
      return {
        tag: m.subject.tag,
        name: m.subject.name,
        // The row names the player, so the sentence starts at the verb.
        text: said.headline.startsWith(`${m.subject.name} `)
          ? said.headline.slice(m.subject.name.length + 1)
          : said.headline.replace(/^You /, ""),
        ...(said.card ? { card: said.card } : {}),
      };
    }),
    _moments: news.map((m) => ({
      subject_tag: m.subject.tag,
      kind: m.kind,
      key: m.key,
    })),
  };
}

export async function recordMilestones(db, accountId, moments) {
  for (const m of moments)
    await db.query(
      `insert into email_milestone (account_id, subject_tag, kind, moment_key) values ($1, $2, $3, $4) on conflict do nothing`,
      [accountId, m.subject_tag, m.kind, m.key],
    );
}
