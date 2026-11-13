/**
 * Home's one feed (slice 7, #765): the timeline GET /api/me/timeline builds,
 * with what the page needs to show it and nothing an agent reads. Each item
 * gains:
 *
 *   groups     which of Home's chips it belongs under: "you" (your own
 *              players, and the account's own items), "friends", "clan"
 *              (a clan you follow, or one of its members). Everyone is
 *              every item, so it is never named.
 *   spark      a sitting's battles in order, for the sparkline: each
 *              battle's outcome and crown margin. Sessions only.
 *   battle_url the battle that proved a moment, as its public page.
 *   scores     a sitting's plain score facts for its line under the title
 *              (design canvas, 2026-11-13): `best_win`, the widest win's
 *              score ("3-0"), and `three_crowns`, how many wins took all
 *              three crowns. From the stored spark's crowns; a week stored
 *              before they were kept has none, and the line says less.
 *   deck       a sitting's deck row: its most played deck's label and
 *              eight cards, each `{id, name, form, elixir_cost}`, kept at
 *              build time. A week stored before it was kept has none.
 *   versus     a highlight's two decks, `{mine, theirs}`, each
 *              `{label, cards}`; theirs null unless one opponent.
 *   proof_mode the mode group of the battle that proved a moment
 *              ("ladder"), for the line under its result.
 *
 * The chips only choose what is shown; the read is the timeline's, so the
 * page's place ("New since your last visit") and its evidence reads stay
 * one. These fields are the website's: MCP's elixir_timeline never carries
 * them, so its contract does not change.
 */
import { battleLinks } from "@elixir-mcp/record/battle-links";
import { modeGroupOf } from "@elixir-mcp/contracts";
import {
  highlightVersus,
  sessionDeck,
  sessionSpark,
} from "@elixir-mcp/tools/activity/entries";

/** The facts a moment names its proving battle under (follow.mjs). */
const PROOFS = ["promoted_by", "crossed_by", "best_win"];
/** The battle that proved a moment, or null (the bell reads it too). */
export const proofOf = (it) => {
  for (const k of PROOFS) {
    const id = it.facts?.[k]?.battle_id;
    if (id) return String(id);
  }
  return null;
};

/** The mode group of the battle that proved a moment, or null. */
export const proofModeOf = (it) => {
  for (const k of PROOFS) {
    const p = it.facts?.[k];
    if (!p?.battle_id) continue;
    if (p.mode) return p.mode;
    return p.type ? modeGroupOf(p.type, p.event_tag ?? null) : null;
  }
  return null;
};

/** The tags an item is about: its subject and every subject it names. */
const tagsOf = (it) =>
  new Set(
    [it.subject_tag, ...(it.subjects ?? []).map((s) => s.tag)].filter(Boolean),
  );

/** Which chips an item sits under, from the account's own subjects. An
 *  item about nobody the account follows is the account's own (its
 *  administration, a feedback answer), so it is yours. */
export function groupsOf(it, subjects) {
  const own = new Set();
  const friends = new Set();
  const clans = new Set();
  const all = new Set();
  for (const s of subjects) {
    all.add(s.tag);
    if (s.kind === "clan") clans.add(s.tag);
    else if (s.relationship === "friend") friends.add(s.tag);
    else if (s.relationship === "primary" || s.relationship === "alt")
      own.add(s.tag);
  }
  const tags = tagsOf(it);
  const groups = [];
  const any = (set) => [...tags].some((t) => set.has(t));
  if (any(own) || ![...tags].some((t) => all.has(t))) groups.push("you");
  if (any(friends)) groups.push("friends");
  if (any(clans)) groups.push("clan");
  return groups;
}

/** A sitting's battles as the sparkline draws them: "w", "l" or "d", and
 *  the crown margin's size, 1 to 3 (null when the record lacks a side's
 *  crowns). */
export const sparkOf = (it) => sparkBars(sessionSpark(it));

/** The bars from a sitting's battles ({ outcome, margin }, in order). */
export function sparkBars(spark) {
  if (!Array.isArray(spark) || spark.length === 0) return null;
  return spark.map((b) => ({
    r: b.outcome === "win" ? "w" : b.outcome === "loss" ? "l" : "d",
    m:
      typeof b.margin === "number"
        ? Math.min(3, Math.max(1, Math.abs(b.margin)))
        : null,
  }));
}

/** A sitting's score facts from its battles in order, or null when the
 *  record kept no crowns. The widest win (ties: the earlier) and the wins
 *  that took three crowns. Facts only: no judgement of the sitting. */
export function scoresOf(spark) {
  if (!Array.isArray(spark)) return null;
  const scored = spark.filter(
    (b) =>
      b.outcome === "win" &&
      typeof b.crowns === "number" &&
      typeof b.against === "number",
  );
  if (scored.length === 0) return null;
  let best = scored[0];
  for (const b of scored)
    if (b.crowns - b.against > best.crowns - best.against) best = b;
  return {
    best_win: `${best.crowns}-${best.against}`,
    three_crowns: scored.filter((b) => b.crowns >= 3).length,
  };
}

/** The timeline's items with Home's fields added. */
export async function annotateFeed(db, timeline, subjects) {
  const items = timeline ?? [];
  const proofs = items.map(proofOf);
  const links = await battleLinks(db, proofs.filter(Boolean));
  return items.map((it, i) => {
    const spark = sparkOf(it);
    const scores = scoresOf(sessionSpark(it));
    const link = proofs[i] ? links.get(proofs[i]) : null;
    const deck = sessionDeck(it);
    const versus = highlightVersus(it);
    const proofMode = proofs[i] ? proofModeOf(it) : null;
    return {
      ...it,
      groups: groupsOf(it, subjects),
      ...(spark ? { spark } : {}),
      ...(scores ? { scores } : {}),
      ...(deck ? { deck } : {}),
      ...(versus ? { versus } : {}),
      ...(link ? { battle_url: link.url } : {}),
      ...(proofMode ? { proof_mode: proofMode } : {}),
    };
  });
}
