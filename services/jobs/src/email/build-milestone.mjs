/** milestone: congratulations for a FIRST on the recipient's own tags
 *  (primary and alts), from the same named moments the timeline
 *  serves. Firsts, never downs: each moment's identity (the arena, the
 *  league, the band, the step, the badge, the card) mails once per
 *  account and subject, ever (email_milestone), so a season's re-climb
 *  of an arena already celebrated is silent and a higher one is news.
 *  Bundled: everything new since the last look goes in one mail. */
import { buildPlayerEntry } from "../../../mcp/src/activity/entries.mjs";
import { badgeLabel } from "../../../mcp/src/badge-names.mjs";
import { itemText } from "../../../mcp/src/activity/summary.mjs";
import { myPlayers } from "./shared.mjs";
import { whenLabel } from "./week.mjs";

const KINDS = new Set([
  "arena_changed",
  "ranked_promotion",
  "best_trophies_band",
  "career_wins_step",
  "collection_level_step",
  "card_unlocked",
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
    case "badge_earned":
    case "legendary_badge_earned":
      return f.badge
        ? `badge:${f.badge}${f.level != null ? `:${f.level}` : ""}`
        : null;
    default:
      return null;
  }
}

function card(kind, f, subject, at, tz) {
  const n = (v) => Number(v).toLocaleString("en-US");
  const who = subject.relationship === "alt" ? subject.name : "You";
  switch (kind) {
    case "arena_changed":
      return {
        headline: `${who} reached ${f.to_name ?? "a new arena"}`,
        big: f.to_name ?? null,
        big_label: "Trophy Road",
        lines: [
          f.from_name ? `${f.from_name} → ${f.to_name}.` : `A new arena.`,
          ...(f.promoted_by?.opponent
            ? [
                `Won the deciding battle ${f.promoted_by.crowns}–${f.promoted_by.crowns_against} against ${f.promoted_by.opponent.name ?? f.promoted_by.opponent.player_tag}.`,
              ]
            : []),
        ],
      };
    case "ranked_promotion":
      return {
        headline: `${who} advanced to ${f.to_name ?? "a new league"}`,
        big: f.to_name ?? null,
        big_label: "Path of Legends",
        lines: [
          f.from_name ? `Up from ${f.from_name}.` : "A new league.",
          ...(f.promoted_by?.opponent
            ? [
                `The promoting battle: ${f.promoted_by.crowns}–${f.promoted_by.crowns_against} against ${f.promoted_by.opponent.name ?? f.promoted_by.opponent.player_tag}.`,
              ]
            : []),
        ],
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
    ...card(m.kind, m.facts, m.subject, m.at, tz),
    next: null,
  }));
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
    also: rest.map((m) => ({
      tag: m.subject.tag,
      name: m.subject.name,
      text: card(m.kind, m.facts, m.subject, m.at, tz).headline.replace(
        /^You /,
        "",
      ),
    })),
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
