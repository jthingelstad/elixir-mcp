/**
 * The timeline and its entries — synthesized at read time.
 *
 * Two layers (review 2026-09-13, Parts II–IV, ratified by Jamie):
 *
 *   - THE TIMELINE is the stream of things that happened, in order, each
 *     with an instant and a subject: the per-subject ledger (player_event,
 *     clan_event, account_event) plus a few items derived here that have a
 *     moment but no observer (a battle session, a quiet rung crossed, a
 *     return after silence).
 *   - THE ENTRIES are the summary of the unread span, one per subject: a
 *     sentence a person can read, always-present sections, named notables.
 *
 * Built from the record and the ledger when asked, per reader, so nothing
 * is fanned out, folded or pruned. The four tests every field passes: not
 * computable by the reader; assumes nothing about the reader's purpose;
 * synthesis over ticks; named. No field is an instruction, and none says
 * what time it is.
 *
 * Window semantics (§13.2): the window is what the record LEARNED between
 * `from` and `to`, keyed on commit time (`battle.created_at`) or the
 * ledger's `window_end`. Battles admitted in the window but played more
 * than a day before `from` are counted once as late captures and never
 * narrated. State facts are a diff of the latest snapshot at each end.
 */

import {
  playerEventOriginSql,
  playerEventProofSql,
} from "@elixir-mcp/record/event-origin";
import { battleLinks } from "@elixir-mcp/record/battle-links";
import { createHash } from "node:crypto";
import { badgeLabel } from "@elixir-mcp/record/badge-names";
import { rankedLeagueName } from "@elixir-mcp/record/ranked-leagues";
import {
  ATTESTED_FACT_KINDS,
  ATTESTED_FACT_TYPES,
  FAMILY_APP_NAMES,
  modeGroupOf,
} from "@elixir-mcp/contracts";
import { periodAt } from "../war-period.mjs";
import { finishInstant } from "../time.mjs";
import {
  hydratePlayerEvents,
  hydrateClanEvents,
  PLAYER_EVENT_COLUMNS,
  CLAN_EVENT_COLUMNS,
} from "../event-payloads.mjs";
import { collectionLevelStep } from "@elixir-mcp/ingest/snapshots";
import { deckIdentities } from "../tools/shared.mjs";
import { itemSchema } from "./schemas.mjs";
import {
  summarizePlayer,
  summarizeClan,
  itemText,
  formLabel,
} from "./summary.mjs";

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
/** Disclosed rungs and rules (§13.8): data, not code. */
const QUIET_RUNGS_DAYS = [5, 10, 20];
const BEST_TROPHIES_BAND = 500;
const CAREER_WINS_STEP = 1000;
const RETURN_AFTER_DAYS = 7;
/** A session breaks on a gap of thirty minutes or more (Jamie, 2026-09-13). */
const SESSION_GAP_MS = 30 * MIN_MS;
/**
 * A session is a STANDOUT when it crosses a disclosed rung — wins in a
 * row, ladder trophies net, battles in one sitting — and the crossing
 * battle was learned in this window, so a member's session is surfaced
 * on a clan's timeline once per rung and never re-reported (consumer
 * request: a bot
 * spent ten calls a day rebuilding these three numbers from
 * battles_performance). Absolute trophy bands on purpose: a win is worth
 * about the same at every ladder floor, so the rungs are arena-invariant.
 */
const SESSION_RUNGS = {
  won_in_a_row: [5, 10, 20],
  trophy_net: [150, 300, 500],
  battles: [20, 40],
};
const LIST_CAP = 20;
const STANDOUT_CAP = 5;
// Items per response, sized to the 48,000-character result cap: 200
// compact items ran 54,766 once every session_standout became an item
// (6.34.0); the rest page through next_cursor.
const TIMELINE_CAP = 150;
const MEMBER_MOMENTS_CAP = 100;

/** A league by its name in the game (`@elixir-mcp/record/ranked-leagues`). */
const leagueName = (n) =>
  n === null || n === undefined ? null : (rankedLeagueName(n) ?? `League ${n}`);

/** Player-ledger kinds that are timeline items; the rest are counted. */
const PLAYER_MOMENT_KINDS = [
  "badge_earned",
  "legendary_badge_earned",
  "arena_changed",
  "ranked_promotion",
  "best_trophies_band",
  "collection_level_step",
  "career_wins_step",
  "card_unlocked",
  // An Evolution or Hero form newly unlocked (#110, 0192).
  "card_form_unlocked",
];
const CLAN_LEDGER_KINDS = [
  "member_joined",
  "member_left",
  "role_changed",
  "bracket_observed",
  "race_finished",
  "week_resolved",
];

/** Every item kind the timeline can carry, for the tool's `kinds` filter. */
export const ITEM_KINDS = [
  "battle_session",
  "session_standout",
  ...PLAYER_MOMENT_KINDS,
  "clan_joined",
  "clan_left",
  "member_joined",
  "member_left",
  "member_role_changed",
  "bracket_observed",
  "race_finished",
  "week_resolved",
  "quiet_crossed",
  "returned",
  // What a person did in a clan, or a family app's game produced for a
  // player, said by the app (attested facts, 9.2.0): section `attested`.
  ...ATTESTED_FACT_KINDS,
];

/**
 * badge_earned rows are lossless in the ledger (every level-up); the
 * timeline surfaces one as an ITEM only at a rung — the badge's final
 * level, or a multiple of five — and the entry counts the rest. A
 * 47-member clan produced 14 mastery level-ups in one day, all texture
 * (the 2026-09-16 request, §5). Rows written before 3.9.0 carry no
 * max_level; for them only the multiple-of-five rung applies.
 */
function badgeItemWorthy(payload) {
  const level = payload?.level;
  if (typeof level !== "number") return true; // a one-off badge is always a moment
  if (typeof payload.max_level === "number" && level >= payload.max_level)
    return true;
  return level % 5 === 0;
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

/* ------------------------------------------------------------------ */
/* Stories: an item's id and revision (#111)                           */
/* ------------------------------------------------------------------ */

/**
 * Every item carries `id`, the story it tells, and `revision`, how far
 * that story has grown, so an agent tells a story once, recognises it in
 * the next read and says "and now..." when it grows (Jamie, 2026-09-28:
 * "how you tell stories as an agent using the MCP is weak now").
 *
 * The id is opaque: a hash of a namespace and the parts that name the
 * happening, never a raw ledger sequence number (it would leak volume and
 * ordering, and the ledgers' sequences collide). It names the HAPPENING,
 * not the reader, so a member's moment on a clan's timeline and on the
 * player's own carries one id. The builders attach the parts under this
 * symbol, which JSON never serializes; buildTimeline turns them into the
 * two fields after its dedupe.
 */
const STORY = Symbol("story");
/** "tl_" and 20 hex characters: 80 bits, about 25 characters on the wire. */
export function storyId(namespace, ...parts) {
  return `tl_${createHash("sha256")
    .update([namespace, ...parts].map(String).join("|"))
    .digest("hex")
    .slice(0, 20)}`;
}
/** The namespaces whose part is a ledger row's id. */
const LEDGERS = new Set([
  "player_event",
  "clan_event",
  "account_event",
  "attested_fact",
]);
/** A moment that never grows: one story, revision 1. */
const moment = (namespace, ...parts) => ({ key: [namespace, ...parts] });

/**
 * The ledger row a moment's id comes from: the lowest event_id of the
 * rows that say the same thing, so the read-time dedupe's collapsed
 * duplicate (feedback #48, Gym #121: a moment re-emitted by a later poll
 * the same day) keeps one id whichever of its rows a window holds.
 * "The same thing" is every typed column the moment is rendered from
 * (event-payloads.mjs), within the day before the row; a roster move
 * also at the same instant, as the dedupe keys it.
 */
const SAME_CLAN_EVENT = [
  "player_tag",
  "role_before",
  "role_after",
  "joined_observed_at",
  "roster_size_before",
  "roster_size_after",
  "war_season_id",
  "section_index",
  "fame",
  "rank",
  "trophy_change",
  "finish_time",
];
const sameRow = (cols) =>
  `(${cols.map((c) => `e.${c}`).join(", ")}) is not distinct from (${cols.map((c) => `w.${c}`).join(", ")})`;
async function firstEventIds(db, ledger, rows) {
  if (rows.length === 0) return new Map();
  const text =
    ledger === "player_event"
      ? `select w.event_id::text as event_id,
                (${playerEventOriginSql("w")})::text as first_id
           from player_event w where w.event_id = any($1::bigint[])`
      : `select w.event_id::text as event_id,
                (select min(e.event_id) from clan_event e
                  where e.clan_tag = w.clan_tag and e.event_type = w.event_type
                    and e.window_end between w.window_end - interval '1 day' and w.window_end
                    and e.event_id <= w.event_id
                    and ${sameRow(SAME_CLAN_EVENT)}
                    and (w.event_type not in ('member_joined', 'member_left', 'role_changed')
                         or coalesce(e.occurred_at, e.window_end) = coalesce(w.occurred_at, w.window_end)))::text as first_id
           from clan_event w where w.event_id = any($1::bigint[])`;
  const { rows: found } = await db.query(text, [
    rows.map((r) => String(r.event_id)),
  ]);
  return new Map(found.map((r) => [r.event_id, r.first_id ?? r.event_id]));
}
/**
 * A crossing moment grows once: when its proof arrives late (the battle
 * log catching up with a roster-written move, pinArenaMoment), the record
 * learns it again and a poller is served it again, with the battle. Its
 * revision is the proof's attachment revision, so the second serving is
 * the same story grown and never a second story told (2026-10-09: one
 * arena move served twice at revision 1 was posted twice).
 */
const ledgerStory = (ledger, firstIds, row) => ({
  ...moment(ledger, firstIds.get(String(row.event_id)) ?? String(row.event_id)),
  ...(ledger === "player_event" && CROSSINGS.has(row.event_type)
    ? { revision: Math.max(1, Number(row.evidence_version) || 1) }
    : {}),
});

/**
 * A sitting's story (battle_session and session_standout are one story):
 * anchored at its first battle, found by walking back past the battles a
 * window holds while the gap stays under the session split, so the same
 * sitting read through two windows has one start (the player path builds
 * sessions from the battles a window learned). The walk and the count
 * read the player's own battles as the timeline counts them: never a boat
 * defense (0171), never a late capture (Gym #211). Bounded at 200 steps.
 *
 * `battles` counts the sitting from that first battle through `upToMs`:
 * the revision, so a sitting told at 20 battles and read again at 40 is
 * the same story, grown.
 */
const SITTING_WALK_STEPS = 200;
const OWN_BATTLE_SQL = `b.battle_time >= b.created_at - interval '1 day'
         and not (b.boat_battle_side is not null
                  and (b.boat_battle_side = 'defender') = (bp.side = 0))`;
async function sittingAnchors(db, sittings) {
  if (sittings.length === 0) return [];
  const { rows } = await db.query(
    `with recursive s as (
       select t.i, t.p, to_timestamp(t.st / 1000.0) as start, to_timestamp(t.up / 1000.0) as upto
         from unnest($1::int[], $2::text[], $3::float8[], $4::float8[]) as t(i, p, st, up)
     ), walk as (
       select s.i, s.p, s.start as cur, 0 as steps from s
       union all
       select w.i, w.p, prev.battle_time, w.steps + 1
         from walk w
         cross join lateral (
           select bp.battle_time
             from battle_participant bp join battle b on b.battle_id = bp.battle_id
            where bp.player_tag = w.p
              and bp.battle_time < w.cur
              and bp.battle_time > w.cur - interval '${SESSION_GAP_MS / MIN_MS} minutes'
              and ${OWN_BATTLE_SQL}
            order by bp.battle_time desc limit 1) prev
        where w.steps < ${SITTING_WALK_STEPS}
     ), anchor as (select i, min(cur) as anchor, max(steps) as steps from walk group by i)
     select s.i, a.anchor, a.steps, refs.battles, refs.fingerprint, refs.observed_at
       from s join anchor a on a.i = s.i
       cross join lateral (
         select count(*)::int as battles,
                md5(string_agg(r.battle_id, ',' order by r.battle_time, r.battle_id)) as fingerprint,
                max(r.created_at) as observed_at
           from (select distinct b.battle_id, b.battle_time, b.created_at
                   from battle_participant bp join battle b on b.battle_id = bp.battle_id
                  where bp.player_tag = s.p and bp.battle_time >= a.anchor
                    and bp.battle_time <= s.upto and ${OWN_BATTLE_SQL}) r
       ) refs`,
    [
      sittings.map((_, i) => i),
      sittings.map((x) => x.player_tag),
      sittings.map((x) => x.startMs),
      sittings.map((x) => x.upToMs),
    ],
  );
  const out = new Array(sittings.length);
  for (const r of rows)
    out[r.i] = {
      anchor: iso(r.anchor),
      battles: r.battles,
      complete: r.steps < SITTING_WALK_STEPS,
      fingerprint: r.fingerprint,
      observed_at: iso(r.observed_at),
    };
  return out;
}
/**
 * How a standout sitting went (2026-10-11, "moments carry the story"):
 * `teammate`, the partner in most of the sitting's 2v2 battles, so two
 * clanmates' sittings of the same games say so and a narrator can tell
 * them as one (feedback #370: two identical 8W-1L lines); and
 * `best_win`, the win over the opponent who started it with the most
 * trophies, as a crossing battle is said. Each from the sitting's own
 * battles (never a boat defense or a late capture); absent when the
 * record holds no partner, or no win over an opponent with recorded
 * trophies: absence over a guess.
 */
async function sittingDetails(db, sittings) {
  const out = sittings.map(() => ({}));
  if (sittings.length === 0) return out;
  // The other participants of the sitting's wins (the opponents best_win
  // rates) and of its 2v2 games (the partner), without their names: a
  // month of a clan's standouts is thousands of games, and a name lookup
  // per participant cost 3.2 s live (acceptance, 2026-10-11). Names are
  // read after, for the few players the details name.
  const { rows } = await db.query(
    `select t.i, bp.battle_id, bp.battle_time, b.type, b.event_tag, bp.side,
            bp.outcome, bp.crowns, bp.trophy_change, bp.starting_trophies,
            o.player_tag as other_tag, o.side as other_side,
            o.crowns as other_crowns, o.starting_trophies as other_trophies
       from unnest($1::int[], $2::text[], $3::float8[], $4::float8[]) as t(i, p, st, en)
       join battle_participant bp on bp.player_tag = t.p
        and bp.battle_time >= to_timestamp(t.st / 1000.0)
        and bp.battle_time <= to_timestamp(t.en / 1000.0)
       join battle b on b.battle_id = bp.battle_id
       join battle_participant o on o.battle_id = bp.battle_id and o.player_tag <> bp.player_tag
        and (o.side = bp.side or bp.outcome = 'win')
      where ${OWN_BATTLE_SQL}
      order by t.i, bp.battle_time, bp.battle_id, o.side, o.player_tag`,
    [
      sittings.map((_, i) => i),
      sittings.map((x) => x.player_tag),
      sittings.map((x) => x.startMs),
      sittings.map((x) => x.endMs),
    ],
  );
  const battles = sittings.map(() => new Map());
  for (const r of rows) {
    const byId = battles[r.i];
    if (!byId.has(r.battle_id)) byId.set(r.battle_id, { ...r, others: [] });
    byId.get(r.battle_id).others.push({
      player_tag: r.other_tag,
      side: r.other_side,
      crowns: r.other_crowns,
      starting_trophies: r.other_trophies ?? null,
    });
  }
  for (const [i, byId] of battles.entries()) {
    const partners = new Map();
    let best = null;
    let bestRating = null;
    for (const b of byId.values()) {
      for (const o of b.others.filter((x) => x.side === b.side)) {
        const had = partners.get(o.player_tag);
        partners.set(o.player_tag, {
          player_tag: o.player_tag,
          battles: (had?.battles ?? 0) + 1,
        });
      }
      if (b.outcome !== "win") continue;
      const opponents = b.others.filter((x) => x.side !== b.side);
      const ratings = opponents
        .map((o) => o.starting_trophies)
        .filter((v) => typeof v === "number");
      if (!opponents.length || !ratings.length) continue;
      const rating = Math.max(...ratings);
      // Highest-rated opponent first; then more crowns; then the earlier
      // win (the rows come in battle order, so a tie keeps the first).
      if (
        best === null ||
        rating > bestRating ||
        (rating === bestRating && (b.crowns ?? 0) > (best.crowns ?? 0))
      ) {
        best = { ...b, opponents };
        bestRating = rating;
      }
    }
    if (partners.size) {
      const [teammate] = [...partners.values()].sort(
        (a, z) =>
          z.battles - a.battles || a.player_tag.localeCompare(z.player_tag),
      );
      out[i].teammate = teammate;
    }
    if (best) {
      const one = best.opponents.length === 1 ? best.opponents[0] : null;
      out[i].best_win = {
        battle_id: best.battle_id,
        battle_time: iso(best.battle_time),
        type: best.type,
        mode: modeGroupOf(best.type, best.event_tag),
        ...(one
          ? {
              opponent: {
                player_tag: one.player_tag,
                starting_trophies: one.starting_trophies,
              },
            }
          : {
              opponents: best.opponents.map((o) => ({
                player_tag: o.player_tag,
                starting_trophies: o.starting_trophies,
              })),
            }),
        crowns: best.crowns,
        crowns_against: best.opponents[0]?.crowns ?? null,
        trophy_change: best.trophy_change,
        ...(typeof best.starting_trophies === "number" &&
        typeof best.trophy_change === "number"
          ? { trophies_after: best.starting_trophies + best.trophy_change }
          : {}),
      };
    }
  }
  const tags = new Set();
  for (const d of out) {
    if (d.teammate) tags.add(d.teammate.player_tag);
    const opponents = d.best_win
      ? (d.best_win.opponents ?? [d.best_win.opponent])
      : [];
    for (const o of opponents) tags.add(o.player_tag);
  }
  if (tags.size === 0) return out;
  const { rows: named } = await db.query(
    `select player_tag, name from player where player_tag = any($1::text[])`,
    [[...tags]],
  );
  const names = new Map(named.map((r) => [r.player_tag, r.name]));
  const name = (o) => ({
    player_tag: o.player_tag,
    name: names.get(o.player_tag) ?? null,
    ...(o.battles === undefined ? {} : { battles: o.battles }),
    ...(o.starting_trophies === undefined
      ? {}
      : { starting_trophies: o.starting_trophies }),
  });
  for (const d of out) {
    if (d.teammate) d.teammate = name(d.teammate);
    if (d.best_win?.opponent) d.best_win.opponent = name(d.best_win.opponent);
    if (d.best_win?.opponents)
      d.best_win.opponents = d.best_win.opponents.map(name);
  }
  return out;
}
/** The story of one sitting: its id from the anchor, its revision. */
const sittingStory = (playerTag, anchored, fallbackStart) => ({
  key: ["sitting", playerTag, anchored?.anchor ?? fallbackStart],
  revision: Math.max(1, anchored?.battles ?? 1),
});
/** Server-only provenance. Evidence requests resolve an authorized item first;
 * a caller cannot supply a player, bounds or a battle as authority. */
const EVIDENCE = Symbol("evidence source");
const evidenceVersion = (...parts) =>
  `ev_${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24)}`;
const CROSSINGS = new Set([
  "arena_changed",
  "ranked_promotion",
  "best_trophies_band",
  "career_wins_step",
]);
function crossingEvidence(row, origin) {
  if (!CROSSINGS.has(row.event_type)) return {};
  const ref = row.payload?.promoted_by ?? row.payload?.crossed_by;
  const observedAt = iso(row.evidence_observed_at ?? row.window_end);
  const evidence = {
    kind: "crossing",
    attachment_revision: row.evidence_version ?? 1,
    status: ref?.battle_id ? "proved" : "unknown",
    version: evidenceVersion(
      origin ?? row.origin_event_id ?? row.event_id,
      row.evidence_version ?? 1,
      ref?.battle_id ?? null,
    ),
    observed_at: observedAt,
    observed_at_basis:
      row.observed_at_basis ??
      (row.evidence_observed_at ? "recorded_observation" : "legacy_window"),
    observation_window: {
      from: iso(row.origin_window_start ?? row.window_start),
      to: iso(row.origin_window_end ?? row.window_end),
    },
    count: ref?.battle_id ? 1 : 0,
    completeness: ref?.battle_id ? "proved_crossing" : "unknown",
  };
  return {
    evidence,
    [EVIDENCE]: {
      kind: "crossing",
      battleId: ref?.battle_id ?? null,
      playerTag: row.player_tag,
      origin: origin ?? row.origin_event_id ?? row.event_id,
    },
  };
}
function sessionEvidence(playerTag, anchored, through, open) {
  const evidence = {
    kind: "session",
    status: "recorded_only",
    version: evidenceVersion(
      playerTag,
      anchored?.anchor,
      through,
      anchored?.fingerprint,
    ),
    observed_at: anchored?.observed_at ?? through,
    observed_at_basis: "recorded_capture",
    count: anchored?.battles ?? 0,
    completeness: anchored?.complete ? "recorded_sitting" : "anchor_bound",
    capture_completeness: "unknown",
    open: Boolean(open),
    from: anchored?.anchor ?? through,
    through,
  };
  return {
    evidence,
    [EVIDENCE]: { kind: "session", playerTag, from: evidence.from, through },
  };
}

/** Exact ordered constituent game references, in bounded pages. This reads
 * canonical rows, never a payload copy, and never a notification pointer. */
export async function readTimelineEvidence(
  db,
  item,
  { offset = 0, limit = 25, expectedVersion } = {},
) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 10000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 25
  )
    return { error: "invalid_page" };
  if (offset > 0 && !expectedVersion) return { error: "version_required" };
  const source = item?.[EVIDENCE];
  if (!source || !item.evidence) return { error: "evidence_unavailable" };
  if (expectedVersion && expectedVersion !== item.evidence.version)
    return { error: "evidence_changed" };
  let records;
  if (source.kind === "session") {
    // Fingerprint and page share one statement snapshot. A capture admitted
    // after the item was built must cause a refresh, never shift offsets
    // under the old evidence version.
    const {
      rows: [current],
    } = await db.query(
      `with records as materialized (
         select distinct b.battle_id, b.battle_time, b.type, b.event_tag, bp.outcome, bp.crowns, bp.trophy_change
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
          where bp.player_tag = $1 and bp.battle_time >= $2::timestamptz
            and bp.battle_time <= $3::timestamptz and ${OWN_BATTLE_SQL}
       )
       select md5(string_agg(battle_id, ',' order by battle_time, battle_id)) as fingerprint,
              count(*)::int as count,
              (select coalesce(jsonb_agg(p order by p.battle_time, p.battle_id), '[]'::jsonb)
                 from (select * from records
                       order by battle_time, battle_id limit $4 offset $5) p) as page
         from records`,
      [source.playerTag, source.from, source.through, limit, offset],
    );
    if (
      evidenceVersion(
        source.playerTag,
        source.from,
        source.through,
        current.fingerprint,
      ) !== item.evidence.version ||
      current.count !== item.evidence.count
    )
      return { error: "evidence_changed" };
    records = current.page;
  } else {
    const { rows } = await db.query(
      `with origin as (select $1::bigint as id),
            proof as (select p.* from origin o left join lateral (${playerEventProofSql("o.id")}) p on true)
       select p.evidence_version, p.battle_id as proof_battle_id,
              b.battle_id, b.battle_time, b.type, b.event_tag, bp.outcome, bp.crowns, bp.trophy_change
         from proof p left join battle b on b.battle_id = p.battle_id
         left join battle_participant bp on bp.battle_id = b.battle_id and bp.player_tag = $2`,
      [source.origin, source.playerTag],
    );
    const current = rows[0];
    if (
      evidenceVersion(
        source.origin,
        current?.evidence_version ?? 1,
        current?.proof_battle_id ?? null,
      ) !== item.evidence.version
    )
      return { error: "evidence_changed" };
    records = offset === 0 && current?.battle_id ? rows : [];
  }
  const links = await battleLinks(
    db,
    records.map((r) => r.battle_id),
  );
  const battles = records.map((r) => ({
    battle_id: r.battle_id,
    at: iso(r.battle_time),
    type: r.type,
    mode_group: modeGroupOf(r.type, r.event_tag),
    outcome: r.outcome,
    crowns: r.crowns,
    trophy_change: r.trophy_change,
    ...links.get(r.battle_id),
    relation: source.kind === "session" ? "constituent" : "proved_crossing",
  }));
  return {
    item_id: item.id,
    ...item.evidence,
    ...(source.kind === "crossing" &&
    source.battleId &&
    offset === 0 &&
    !battles.length
      ? { status: "unavailable", completeness: "unknown" }
      : {}),
    offset,
    limit,
    battles,
    next_offset:
      offset + battles.length < item.evidence.count && battles.length > 0
        ? offset + battles.length
        : null,
  };
}

/** Optional per-query timings for the ops preview (perf is a plain object). */
async function timed(perf, name, fn) {
  if (!perf) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    perf[name] = (perf[name] ?? 0) + Math.round(performance.now() - t0);
  }
}
const crossed = (before, after, step) =>
  typeof before === "number" &&
  typeof after === "number" &&
  Math.floor(after / step) > Math.floor(before / step);
const capList = (rows, cap = LIST_CAP) =>
  rows.length > cap
    ? { items: rows.slice(0, cap), more: rows.length - cap }
    : { items: rows, more: 0 };
const ts = (ms) => `to_timestamp(${Math.floor(ms)} / 1000.0)`;
// Window bounds compare at the millisecond precision the tool serves
// (Gym #245): created_at keeps microseconds, so an item echoed at
// 17:06:27.573 sat past a window ending at .573. (from, to] is written
// ">= from + 1 ms" and "< to + 1 ms", which is the same for a column
// stored in milliseconds and index-friendly for one in microseconds.

/* ------------------------------------------------------------------ */
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

/**
 * The subjects an account hears about (§13.5): every claim with notify on
 * as a player entry, every added clan with notify on as a clan entry.
 * Members of an agent's clan are NOT subjects; they live inside the clan
 * entry and on the clan's timeline.
 */
export async function subjectsFor(db, accountId) {
  const { rows: players } = await db.query(
    `select c.player_tag, c.relationship, nn.nickname
       from claim c
       left join player_nickname nn
         on nn.account_id = c.account_id and nn.player_tag = c.player_tag
      where c.account_id = $1 and c.notify
      order by c.is_primary desc, c.relationship, c.player_tag`,
    [accountId],
  );
  const { rows: clans } = await db.query(
    `select clan_tag, scope from account_clan
      where account_id = $1 and notify order by clan_tag`,
    [accountId],
  );
  return [
    ...players.map((r) => ({
      kind: "player",
      tag: r.player_tag,
      relationship: r.relationship,
      nickname: r.nickname ?? null,
    })),
    ...clans.map((r) => ({ kind: "clan", tag: r.clan_tag, scope: r.scope })),
  ];
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

/**
 * Battle sessions: a run of one player's battles where no two consecutive
 * battles are SESSION_GAP_MS or more apart. Individual battles are never
 * items; a session is the unit a player would speak of.
 */
function sessionsOf(battles, toMs, { learned = () => true } = {}) {
  const sorted = [...battles].sort(
    (a, b) => a.battle_time.getTime() - b.battle_time.getTime(),
  );
  const sessions = [];
  let cur = null;
  for (const b of sorted) {
    const t = b.battle_time.getTime();
    if (!cur || t - cur.endMs >= SESSION_GAP_MS) {
      cur = {
        startMs: t,
        endMs: t,
        battles: 0,
        won: 0,
        lost: 0,
        drawn: 0,
        by_mode: {},
        trophy_net: 0,
        // The running ladder net furthest from zero, signed: a rung on
        // the net is crossed by how far it moved, which the final net
        // need not show (#373: crossed 150, ended at +117).
        trophy_net_peak: 0,
        run: 0,
        won_in_a_row: 0,
        // Rungs crossed so far, and which of those crossings this window
        // learned (the battle that crossed it, for the item's instant).
        crossed: [],
        crossings: [],
        newly: [],
        decks: new Map(),
        events: new Map(),
        // When the record LEARNED this session (Gym #162): the latest
        // commit of a battle this window learned, the instant that
        // selects the session into a window.
        learnedMs: null,
      };
      sessions.push(cur);
    }
    cur.endMs = t;
    if (b.created_at && learned(b)) {
      const c = b.created_at.getTime();
      if (cur.learnedMs === null || c > cur.learnedMs) cur.learnedMs = c;
    }
    cur.battles += 1;
    if (b.outcome === "win") {
      cur.won += 1;
      cur.run += 1;
      if (cur.run > cur.won_in_a_row) cur.won_in_a_row = cur.run;
    } else {
      if (b.outcome === "loss") cur.lost += 1;
      else cur.drawn += 1;
      cur.run = 0;
    }
    const g = modeGroupOf(b.type, b.event_tag);
    cur.by_mode[g] = (cur.by_mode[g] ?? 0) + 1;
    if (g === "ladder") {
      cur.trophy_net += b.trophy_change ?? 0;
      if (Math.abs(cur.trophy_net) > Math.abs(cur.trophy_net_peak))
        cur.trophy_net_peak = cur.trophy_net;
    }
    if (b.deck_hash)
      cur.decks.set(b.deck_hash, (cur.decks.get(b.deck_hash) ?? 0) + 1);
    if (b.event_tag && g === "event")
      cur.events.set(b.event_tag, (cur.events.get(b.event_tag) ?? 0) + 1);
    for (const [key, rungs] of Object.entries(SESSION_RUNGS)) {
      // The value the rung is judged on, signed: a trophy rung is crossed
      // by the net's distance from zero, up or down.
      const value = cur[key];
      for (const rung of rungs) {
        const label = `${key}>=${rung}`;
        const reached =
          key === "trophy_net" ? Math.abs(value) >= rung : value >= rung;
        if (reached && !cur.crossed.includes(label)) {
          cur.crossed.push(label);
          const crossing = {
            rung: label,
            key,
            threshold: rung,
            value,
            at: iso(t),
            // The battle that crossed it (2026-10-11): the how, by id.
            battle_id: b.battle_id ?? null,
          };
          cur.crossings.push(crossing);
          if (learned(b))
            cur.newly.push({
              label,
              at: t,
              learnedAt: b.created_at ? b.created_at.getTime() : t,
            });
        }
      }
    }
  }
  return sessions.map((s) => ({
    started_at: iso(s.startMs),
    ended_at: iso(s.endMs),
    duration_s: Math.round((s.endMs - s.startMs) / 1000),
    battles: s.battles,
    won: s.won,
    lost: s.lost,
    drawn: s.drawn,
    by_mode: s.by_mode,
    trophy_net: s.trophy_net,
    trophy_net_peak: s.trophy_net_peak,
    won_in_a_row: s.won_in_a_row,
    open: toMs - s.endMs < SESSION_GAP_MS,
    crossed: s.crossed,
    crossings: s.crossings,
    newly: s.newly,
    deckCounts: s.decks,
    eventCounts: s.events,
    learned_at: s.learnedMs === null ? null : iso(s.learnedMs),
  }));
}

/** The decks and named events a sitting was played with (#375): each
 *  deck by its archetype label, most played first, and each in-game
 *  event by the title /events gave it. Labels come from the record
 *  (deckIdentities, game_event), never a hand list. */
const SESSION_DECKS_CAP = 3;
async function nameSessions(db, sessions) {
  const hashes = sessions.flatMap((s) => [...s.deckCounts.keys()]);
  const tags = [...new Set(sessions.flatMap((s) => [...s.eventCounts.keys()]))];
  const ids = hashes.length ? await deckIdentities(db, hashes) : new Map();
  const { rows } = tags.length
    ? await db.query(
        `select event_tag, title from game_event where event_tag = any($1::text[])`,
        [tags],
      )
    : { rows: [] };
  const titles = new Map(rows.map((r) => [r.event_tag, r.title]));
  for (const s of sessions) {
    // Deck labels merge: two forms of one archetype are one deck to say.
    const byLabel = new Map();
    for (const [hash, n] of s.deckCounts) {
      // A deck with no card costs recorded has no shape to name.
      const archetype = ids.get(hash)?.archetype;
      if (!archetype?.label || archetype.family === "unclassified") continue;
      byLabel.set(archetype.label, (byLabel.get(archetype.label) ?? 0) + n);
    }
    s.decks = [...byLabel.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, SESSION_DECKS_CAP)
      .map(([label, battles]) => ({ label, battles }));
    s.events = [...s.eventCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([event_tag, battles]) => ({
        event_tag,
        name: titles.get(event_tag) ?? null,
        battles,
      }));
  }
  return sessions;
}

/**
 * Whether a clan entry's war line tallies decks: only the war day IN
 * PROGRESS of the week in progress (Jamie 2026-09-25: a closed day's
 * per-member decks would place the game's counter on a day the record
 * cannot place reliably), and only until the race finishes, since decks
 * count against four a war day up to the finish (DECISIONS; #376: a
 * 09:48 finish, then "war day 4: 49 untouched" read from the next day).
 */
export function warDeckTallyOpen({
  period,
  sameWeek,
  finishedAt,
  toMs,
  nowMs,
}) {
  if (!period || !sameWeek) return false;
  if (nowMs < period.startMs || nowMs >= period.endMs) return false;
  const finishedBy =
    finishedAt !== null &&
    finishedAt !== undefined &&
    Date.parse(finishedAt) <= Math.min(toMs, nowMs);
  return !finishedBy;
}

/** The wire shape of a session: the bookkeeping fields stay here. */
function sessionFacts({
  crossed: _c,
  crossings: _x,
  newly: _n,
  learned_at: _l,
  deckCounts: _d,
  eventCounts: _e,
  ...rest
}) {
  return rest;
}

/* ------------------------------------------------------------------ */
/* Player entry                                                        */
/* ------------------------------------------------------------------ */

async function snapshotAt(db, tag, atMs) {
  const { rows } = await db.query(
    `select profile_observed_at as observed_at, trophies, best_trophies, arena_id,
            collection_level, wins, battle_count,
            donations,
            pol_league as league, pol_trophies as rating, pol_rank as rank
       from player_snapshot_daily
      where player_tag = $1 and profile_observed_at is not null
        and profile_observed_at <= ${ts(atMs)}
      order by profile_observed_at desc limit 1`,
    [tag],
  );
  return rows[0] ?? null;
}

/**
 * A window's basis (#373): `observed` selects what the record LEARNED in
 * (from, to], which is what a poller holding a pointer needs; `occurred`
 * selects what HAPPENED in it, as the record knows it now, which is what
 * "what happened on Saturday" means. A ledger row is observed at its
 * evidence or window end and happened at its occurred_at (or window end);
 * a row cannot be observed before it happened, so the observed column's
 * lower bound keeps an occurred read on its index.
 */
const OBSERVED_COL = (a) =>
  `coalesce(${a}evidence_observed_at, ${a}window_end)`;
const OCCURRED_COL = (a) => `coalesce(${a}occurred_at, ${a}window_end)`;
function ledgerWindowSql(
  alias,
  fromMs,
  toMs,
  basis,
  observedCol = OBSERVED_COL,
) {
  const a = alias ? `${alias}.` : "";
  const observed = observedCol(a);
  if (basis === "occurred")
    return `${observed} >= ${ts(fromMs + 1)} and ${OCCURRED_COL(a)} >= ${ts(fromMs + 1)} and ${OCCURRED_COL(a)} < ${ts(toMs + 1)}`;
  return `${observed} >= ${ts(fromMs + 1)} and ${observed} < ${ts(toMs + 1)}`;
}
const ledgerInWindow = (r, fromMs, toMs, basis) => {
  const t = new Date(
    basis === "occurred"
      ? (r.occurred_at ?? r.window_end)
      : (r.evidence_observed_at ?? r.window_end),
  ).getTime();
  return t > fromMs && t <= toMs;
};

async function playerLedger(db, tag, fromMs, toMs, basis) {
  const { rows } = await db.query(
    `select ${PLAYER_EVENT_COLUMNS}
       from player_event
      where player_tag = $1 and ${ledgerWindowSql("", fromMs, toMs, basis)}
      order by event_id`,
    [tag],
  );
  return (await hydratePlayerEvents(db, rows)).filter((r) =>
    ledgerInWindow(r, fromMs, toMs, basis),
  );
}

/**
 * Battles the record learned in the window: the ones played within a day
 * of it come off the player-time index. A battle the record learned more
 * than a day after it was played is a late capture (a history backfill,
 * a log polled late), counted by the created_at index and never
 * narrated. "Late" is the battle's own capture delay, not its distance
 * from the window's start (Gym #211): measured against `from`, the same
 * backfilled session was a standout in a wide window and absent in a
 * narrow one. A boat DEFENSE is not the member's battle (Jamie
 * 2026-09-24; 0171): an enemy attacked their boat and their defense deck
 * answered, so it never counts here.
 */
async function playerBattles(db, tag, fromMs, toMs, basis = "observed") {
  // Learned in the window (observed), or played in it (occurred); either
  // way never a late capture, which is counted, not narrated. An occurred
  // read also fetches the day before `from` (`wide`), so a sitting begun
  // before the window is built whole (Codex on #472): its id, totals,
  // decks and evidence are the sitting's, not the window's slice of it.
  const occurred = basis === "occurred";
  const selected = occurred
    ? `bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time < ${ts(toMs + 1)}`
    : `bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time < ${ts(toMs + 1)}
        and b.created_at >= ${ts(fromMs + 1)} and b.created_at < ${ts(toMs + 1)}`;
  const { rows: wide } = await db.query(
    `select b.battle_id, b.type, b.event_tag, b.battle_time, b.created_at, bp.outcome, bp.crowns,
            bp.trophy_change, bp.clan_tag, bp.deck_hash
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
      where bp.player_tag = $1
        and ${selected}
        and b.battle_time >= b.created_at - interval '1 day'
        and not (b.boat_battle_side is not null
                 and (b.boat_battle_side = 'defender') = (bp.side = 0))
      order by b.battle_time`,
    [tag],
  );
  const { rows: late } = await db.query(
    `select count(*)::int as n
       from battle b
       join battle_participant bp on bp.battle_id = b.battle_id
      where ${
        basis === "occurred"
          ? `bp.battle_time >= ${ts(fromMs + 1)} and bp.battle_time < ${ts(toMs + 1)}`
          : `b.created_at >= ${ts(fromMs + 1)} and b.created_at < ${ts(toMs + 1)}`
      }
        and b.battle_time < b.created_at - interval '1 day'
        and bp.player_tag = $1`,
    [tag],
  );
  const rows = occurred
    ? wide.filter((r) => r.battle_time.getTime() > fromMs)
    : wide;
  return { rows, wide, late: late[0]?.n ?? 0 };
}

async function presenceOf(db, tag, played, fromMs, toMs) {
  const { rows: lastRows } = await db.query(
    `select max(bp.battle_time) as last_battle
       from battle_participant bp
      where bp.player_tag = $1 and bp.battle_time < ${ts(toMs + 1)}`,
    [tag],
  );
  const lastBattle = lastRows[0]?.last_battle ?? null;
  const daysQuiet = lastBattle
    ? Math.floor((toMs - lastBattle.getTime()) / DAY_MS)
    : null;
  let returned = null;
  if (played.length > 0) {
    const firstIn = played[0].battle_time.getTime();
    const { rows: prior } = await db.query(
      `select max(bp.battle_time) as t from battle_participant bp
        where bp.player_tag = $1 and bp.battle_time < ${ts(firstIn)}`,
      [tag],
    );
    const t = prior[0]?.t;
    if (t) {
      const gap = Math.floor((firstIn - t.getTime()) / DAY_MS);
      if (gap >= RETURN_AFTER_DAYS)
        returned = { after_days: gap, at: iso(firstIn) };
    }
  }
  const { rows: pollRows } = await db.query(
    // Null only when no read at or before the window's end exists (Gym
    // #119: a negative day count read as nonsense). The last battle-log read at or before the window's end, from the
    // receipts (Gym #163): poll_state holds only the latest read, so a
    // past window had read null whenever a later poll existed.
    `select floor(extract(epoch from (${ts(toMs)} - max(r.fetched_at))) / 86400)::int
              as days_since_poll
       from api_receipt r
      where r.entity_key = $1 and r.endpoint = 'player_battlelog'
        and r.fetched_at < ${ts(toMs + 1)}`,
    [tag],
  );
  const daysSincePoll = pollRows[0]?.days_since_poll ?? null;
  // A rung crossed inside the window is a moment with an instant.
  let rungCrossed = null;
  if (lastBattle) {
    const last = lastBattle.getTime();
    const rung = QUIET_RUNGS_DAYS.filter(
      (r) => (toMs - last) / DAY_MS >= r && (fromMs - last) / DAY_MS < r,
    ).pop();
    if (rung !== undefined && (daysSincePoll === null || daysSincePoll < rung))
      rungCrossed = { rung, at: iso(last + rung * DAY_MS) };
  }
  return {
    last_battle_at: iso(lastBattle),
    days_quiet: daysQuiet,
    days_since_poll: daysSincePoll,
    returned_after_days: returned?.after_days ?? null,
    returned,
    rungCrossed,
  };
}

async function arenaNamesFor(db, ids) {
  const wanted = [...new Set(ids.filter((v) => typeof v === "number"))];
  if (wanted.length === 0) return new Map();
  const { rows } = await db.query(
    `select arena_id, name from arena where arena_id = any($1::int[])`,
    [wanted],
  );
  return new Map(rows.map((r) => [r.arena_id, r.name]));
}

function sectionOfKind(kind) {
  switch (kind) {
    case "badge_earned":
    case "legendary_badge_earned":
      return "badges";
    case "arena_changed":
    case "best_trophies_band":
      return "trophies";
    case "ranked_promotion":
      return "ranked";
    case "collection_level_step":
    case "card_unlocked":
    case "card_form_unlocked":
      return "collection";
    case "career_wins_step":
      return "battles";
    default:
      return "notables";
  }
}

function decorate(kind, payload, arenaNames) {
  // The badge's or card's own name under its own key, so it never shadows
  // the member's `name` on a clan timeline ("Lava Hound unlocked Lava
  // Hound", 2026-09-16).
  // badge_label is the badge as a player says it (badge-names.mjs);
  // badge stays the API's identifier, which badges_holders matches on.
  if (kind === "badge_earned" || kind === "legendary_badge_earned") {
    const { name, ...rest } = payload;
    return { badge: name, badge_label: badgeLabel(name), ...rest };
  }
  if (kind === "card_unlocked" || kind === "card_form_unlocked") {
    const { name, ...rest } = payload;
    return { card: name, ...rest };
  }
  // A step recorded before the step rule (2026-09-18) carries no step:
  // said as null, so the key is always there and the note explains it
  // (Gym #121).
  if (kind === "collection_level_step")
    return { ...payload, step: payload?.step ?? null };
  if (kind === "arena_changed")
    return {
      ...payload,
      from_name: arenaNames.get(payload.from) ?? null,
      to_name: payload.to_name ?? arenaNames.get(payload.to) ?? null,
    };
  if (kind === "ranked_promotion")
    return {
      ...payload,
      from_name: leagueName(payload.from),
      to_name: leagueName(payload.to),
    };
  return payload;
}

export async function buildPlayerEntry(
  db,
  {
    tag,
    relationship = null,
    nickname = null,
    fromMs,
    toMs,
    timezone = "UTC",
    perf = null,
    basis = "observed",
  },
) {
  const { rows: who } = await db.query(
    `select p.name, cm.clan_tag, c.name as clan_name, cm.role
       from player p
       left join clan_membership cm
         on cm.player_tag = p.player_tag and cm.left_observed_at is null
       left join clan c on c.clan_tag = cm.clan_tag
      where p.player_tag = $1`,
    [tag],
  );
  const name = who[0]?.name ?? null;

  const {
    rows: played,
    wide,
    late,
  } = await timed(perf, "player.battles", () =>
    playerBattles(db, tag, fromMs, toMs, basis),
  );
  const byMode = {};
  let won = 0;
  let lost = 0;
  let drawn = 0;
  let threeCrowns = 0;
  for (const b of played) {
    const group = modeGroupOf(b.type, b.event_tag);
    byMode[group] = (byMode[group] ?? 0) + 1;
    if (b.outcome === "win") won += 1;
    else if (b.outcome === "loss") lost += 1;
    else drawn += 1;
    if (b.outcome === "win" && b.crowns === 3) threeCrowns += 1;
  }
  const trophyNet = played
    .filter((b) => modeGroupOf(b.type, b.event_tag) === "ladder")
    .reduce((s, b) => s + (b.trophy_change ?? 0), 0);
  // Whole sittings from the wider fetch, kept when the window holds one
  // of their battles; the counts above are the window's own.
  const inWindow = new Set(played);
  const sessions = await timed(perf, "player.sessions", () =>
    nameSessions(
      db,
      sessionsOf(wide, toMs, { learned: (b) => inWindow.has(b) }).filter(
        (x) => x.learned_at !== null,
      ),
    ),
  );

  const before = await timed(perf, "player.snapshot", () =>
    snapshotAt(db, tag, fromMs),
  );
  const after = await timed(perf, "player.snapshot", () =>
    snapshotAt(db, tag, toMs),
  );
  const diff = (key) =>
    before && after && after[key] !== null && before[key] !== null
      ? {
          from: before[key],
          to: after[key],
          changed: after[key] !== before[key],
        }
      : null;
  const trophies = diff("trophies");
  const best = diff("best_trophies");
  const arena = diff("arena_id");
  const league = diff("league");
  const rating = diff("rating");
  const rank = diff("rank");
  const collectionLevel = diff("collection_level");
  const wins = diff("wins");

  const ledger = await timed(perf, "player.ledger", () =>
    playerLedger(db, tag, fromMs, toMs, basis),
  );
  const ofKind = (k) => ledger.filter((r) => r.event_type === k);
  const arenaNames = await arenaNamesFor(db, [
    ...(arena ? [arena.from, arena.to] : []),
    ...ofKind("arena_changed").flatMap((r) => [r.payload.from, r.payload.to]),
  ]);

  const { rows: moves } = await db.query(
    `select cm.clan_tag, c.name as clan_name, cm.role, cm.baseline,
            cm.joined_observed_at, cm.left_observed_at
       from clan_membership cm
       left join clan c on c.clan_tag = cm.clan_tag
      where cm.player_tag = $1
        and ((cm.joined_observed_at >= ${ts(fromMs + 1)} and cm.joined_observed_at < ${ts(toMs + 1)})
          or (cm.left_observed_at >= ${ts(fromMs + 1)} and cm.left_observed_at < ${ts(toMs + 1)}))
      order by coalesce(cm.left_observed_at, cm.joined_observed_at)`,
    [tag],
  );
  const clanChanges = [];
  for (const m of moves) {
    const j = m.joined_observed_at.getTime();
    // A baseline row is Elixir's first sight of the player in the clan,
    // not a join it saw (0207; ingest/roster.mjs): no moment.
    if (j > fromMs && j <= toMs && !m.baseline)
      clanChanges.push({
        kind: "joined",
        clan_tag: m.clan_tag,
        clan_name: m.clan_name,
        at: iso(m.joined_observed_at),
      });
    const l = m.left_observed_at?.getTime();
    if (l && l > fromMs && l <= toMs)
      clanChanges.push({
        kind: "left",
        clan_tag: m.clan_tag,
        clan_name: m.clan_name,
        role: m.role,
        at: iso(m.left_observed_at),
      });
  }
  clanChanges.sort((a, b) => a.at.localeCompare(b.at));

  const presence = await timed(perf, "player.presence", () =>
    presenceOf(db, tag, played, fromMs, toMs),
  );
  const warBattles = played.filter(
    (b) => modeGroupOf(b.type, b.event_tag) === "war",
  );

  const notables = [];
  if (best?.changed && crossed(best.from, best.to, BEST_TROPHIES_BAND))
    notables.push({ kind: "best_trophies_band", value: best.to });
  if (arena?.changed && arena.to > arena.from)
    notables.push({
      kind: "arena_promotion",
      from: arenaNames.get(arena.from) ?? null,
      to: arenaNames.get(arena.to) ?? null,
    });
  if (league?.changed && league.to > league.from)
    notables.push({ kind: "ranked_promotion", league: leagueName(league.to) });
  if (
    collectionLevel?.changed &&
    crossed(
      collectionLevel.from,
      collectionLevel.to,
      collectionLevelStep(collectionLevel.to),
    )
  )
    notables.push({ kind: "collection_level", value: collectionLevel.to });
  if (wins?.changed && crossed(wins.from, wins.to, CAREER_WINS_STEP))
    notables.push({ kind: "career_wins", value: wins.to });
  for (const r of ofKind("legendary_badge_earned"))
    notables.push({ kind: "legendary_badge", name: r.payload.name });
  const badgeUps = ofKind("badge_earned");
  if (badgeUps.length > 0)
    notables.push({
      kind: "badge_level",
      count: badgeUps.length,
      names: badgeUps.slice(0, 3).map((r) => r.payload.name),
    });
  for (const c of clanChanges)
    notables.push({ kind: `clan_${c.kind}`, clan_name: c.clan_name });
  if (presence.returned_after_days !== null)
    notables.push({
      kind: "returned",
      after_days: presence.returned_after_days,
    });

  const unlocked = ofKind("card_unlocked").map(
    (r) => r.payload.name ?? `card ${r.payload.card_id}`,
  );
  // A form as a player says it: "Evolution Valkyrie", "Hero Knight".
  const formsUnlocked = ofKind("card_form_unlocked").map((r) =>
    formLabel(r.payload),
  );

  const entry = {
    kind: "player_activity",
    subject_tag: tag,
    name,
    nickname,
    relationship,
    window: { from: iso(fromMs), to: iso(toMs) },
    summary: null,
    battles: {
      played: played.length,
      won,
      lost,
      drawn,
      three_crown_wins: threeCrowns,
      sessions: sessions.length,
      by_mode: byMode,
      trophy_net_ladder: trophyNet,
      late_captures: late,
    },
    // Only when the ladder moved (#376: a ranked player's
    // "14,000 -> 14,000" said nothing); ranked movement is `ranked`.
    trophies:
      trophies?.changed || best?.changed
        ? {
            from: trophies?.from ?? null,
            to: trophies?.to ?? null,
            best: best?.to ?? null,
            new_best: Boolean(best?.changed && best.to > best.from),
            as_of: iso(after?.observed_at),
          }
        : null,
    arena: arena?.changed
      ? {
          from: arenaNames.get(arena.from) ?? null,
          to: arenaNames.get(arena.to) ?? null,
          from_id: arena.from,
          to_id: arena.to,
        }
      : null,
    // The ranked ladder's own movement (#376): league, rating and rank
    // as the profile read them at each end, when any moved. A league
    // lower at the end may be the season's reset; these are the two
    // readings, not a demotion.
    ranked:
      league?.changed || rating?.changed || rank?.changed
        ? {
            from: leagueName(league?.from ?? null),
            to: leagueName(league?.to ?? null),
            league_changed: Boolean(league?.changed),
            rating: rating?.changed
              ? { from: rating.from, to: rating.to }
              : null,
            rank: rank?.changed ? { from: rank.from, to: rank.to } : null,
            as_of: iso(after?.observed_at),
          }
        : null,
    collection: {
      level: collectionLevel?.changed
        ? { from: collectionLevel.from, to: collectionLevel.to }
        : null,
      unlocked: capList(unlocked, STANDOUT_CAP),
      forms_unlocked: capList(formsUnlocked, STANDOUT_CAP),
      leveled: ofKind("card_leveled").length,
    },
    badges: {
      earned: badgeUps.length,
      legendary: ofKind("legendary_badge_earned").length,
      names: capList(
        [...ofKind("legendary_badge_earned"), ...badgeUps].map(
          (r) => r.payload.name,
        ),
        STANDOUT_CAP,
      ),
    },
    clan: {
      tag: who[0]?.clan_tag ?? null,
      name: who[0]?.clan_name ?? null,
      role: who[0]?.role ?? null,
      changes: clanChanges,
    },
    // The week's war battles only: which war DAY each fell on is not
    // served (Jamie 2026-09-25: a war day's rollover cannot be placed
    // reliably at Elixir's scale; war facts are weekly aggregates).
    war: { battles: warBattles.length },
    presence: {
      last_battle_at: presence.last_battle_at,
      days_quiet: presence.days_quiet,
      days_since_poll: presence.days_since_poll,
      returned_after_days: presence.returned_after_days,
    },
    notables,
  };
  entry.summary = summarizePlayer(entry, timezone);

  // What the timeline needs from this build, without a second read.
  const items = [];
  // The in-game name is the subject's name everywhere it is said; a
  // reader's nickname is theirs, a field of its own (DECISIONS:
  // nicknames are private; #374: the same member was "Tyler" in one copy
  // and "raquaza" in the other, and the bot posted the nickname).
  const subject = {
    subject_tag: tag,
    subject_name: name,
    ...(nickname ? { nickname } : {}),
    subjects: [{ tag, kind: "player", name }],
  };
  const self = { player_tag: tag, name };
  const anchored = await timed(perf, "player.sittings", () =>
    sittingAnchors(
      db,
      sessions.map((s) => ({
        player_tag: tag,
        startMs: Date.parse(s.started_at),
        upToMs: Date.parse(s.ended_at),
      })),
    ),
  );
  for (const [i, s] of sessions.entries())
    items.push({
      ...subject,
      at: s.started_at,
      observed_at: s.learned_at ?? s.started_at,
      kind: "battle_session",
      section: "battles",
      facts: { ...self, ...sessionFacts(s) },
      [STORY]: sittingStory(tag, anchored[i], s.started_at),
      ...sessionEvidence(tag, anchored[i], s.ended_at, s.open),
    });
  const momentRows = ledger.filter(
    (r) =>
      PLAYER_MOMENT_KINDS.includes(r.event_type) &&
      (r.event_type !== "badge_earned" || badgeItemWorthy(r.payload)),
  );
  const firstIds = await timed(perf, "player.story_ids", () =>
    firstEventIds(db, "player_event", momentRows),
  );
  for (const r of momentRows)
    items.push({
      ...subject,
      at: iso(r.occurred_at ?? r.window_end),
      // When a poll saw it, which is what selects it into a window (Gym
      // #118); `at` is when it happened.
      observed_at: iso(r.evidence_observed_at ?? r.window_end),
      kind: r.event_type,
      section: sectionOfKind(r.event_type),
      facts: { ...self, ...decorate(r.event_type, r.payload, arenaNames) },
      [STORY]: ledgerStory("player_event", firstIds, r),
      ...crossingEvidence(r, firstIds.get(String(r.event_id))),
    });
  for (const c of clanChanges) {
    const kind = c.kind === "joined" ? "clan_joined" : "clan_left";
    items.push({
      ...subject,
      at: c.at,
      kind,
      section: "clan",
      subjects: [
        ...subject.subjects,
        { tag: c.clan_tag, kind: "clan", name: c.clan_name ?? null },
      ],
      facts: { ...self, ...c },
      [STORY]: moment(kind, tag, c.clan_tag, c.at),
    });
  }
  // A return and a quiet crossing name the player, so the same one on a
  // clan's timeline (the member's) is the same story.
  if (presence.returned)
    items.push({
      ...subject,
      at: presence.returned.at,
      kind: "returned",
      section: "presence",
      facts: { ...self, after_days: presence.returned.after_days },
      [STORY]: moment("returned", tag, presence.returned.at),
    });
  if (presence.rungCrossed)
    items.push({
      ...subject,
      at: presence.rungCrossed.at,
      kind: "quiet_crossed",
      section: "presence",
      [STORY]: moment(
        "quiet_crossed",
        tag,
        presence.rungCrossed.rung,
        presence.rungCrossed.at,
      ),
      // As of the crossing, not the window's end (Gym #119): quiet for
      // exactly the rung's days at `at`.
      facts: {
        ...self,
        rung: presence.rungCrossed.rung,
        days_quiet: presence.rungCrossed.rung,
        days_since_poll: presence.days_since_poll,
      },
    });
  return { entry, items };
}

/* ------------------------------------------------------------------ */
/* Clan entry                                                          */
/* ------------------------------------------------------------------ */

/** The empty-path probe (3.18.0): did this window learn a battle of the
 *  clan's at all, split into played within a day of the window (the
 *  narrated ones) and late captures. Exported so {explain_timeline} can
 *  EXPLAIN the same statement the tool runs. */
export function clanLearnedQuery({ tag, fromMs, toMs, basis = "observed" }) {
  const col = basis === "occurred" ? "bp.battle_time" : "b.created_at";
  return {
    text: `select count(distinct b.battle_id) filter (where b.battle_time >= b.created_at - interval '1 day')::int as recent,
                  count(distinct b.battle_id) filter (where b.battle_time < b.created_at - interval '1 day')::int as late
             from battle b
             join battle_participant bp on bp.battle_id = b.battle_id
            where ${col} >= ${ts(fromMs + 1)} and ${col} < ${ts(toMs + 1)}
              and bp.clan_tag = $1`,
    values: [tag],
  };
}

/** The day-wide member battle fetch behind sessions and standouts: the
 *  statement an empty window used to pay for. */
export function clanMemberBattlesQuery({
  tag,
  fromMs,
  toMs,
  basis = "observed",
}) {
  // `learned` marks the rows this window selects: learned in it
  // (observed), or played in it (occurred, as the record knows now).
  const occurred = basis === "occurred";
  return {
    text: `select bp.player_tag, bp.battle_id, b.type, b.event_tag, b.battle_time, b.created_at, bp.outcome, bp.trophy_change, bp.deck_hash,
                  (${
                    occurred
                      ? `bp.battle_time >= ${ts(fromMs + 1)}`
                      : `b.created_at >= ${ts(fromMs + 1)} and b.created_at < ${ts(toMs + 1)}`
                  }
                   and b.battle_time >= b.created_at - interval '1 day') as learned
             from battle_participant bp
             join battle b on b.battle_id = bp.battle_id
            where bp.clan_tag = $1
              and bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time < ${ts(toMs + 1)}${
                occurred
                  ? ""
                  : `
              and b.created_at < ${ts(toMs + 1)}`
              }
            order by bp.player_tag, b.battle_time`,
    values: [tag],
  };
}

export async function buildClanEntry(
  db,
  {
    tag,
    scope = "comprehensive",
    fromMs,
    toMs,
    timezone = "UTC",
    perf = null,
    memberTag = null,
    basis = "observed",
  },
) {
  const occurred = basis === "occurred";
  const { rows: clanRows } = await db.query(
    `select name from clan where clan_tag = $1`,
    [tag],
  );
  const name = clanRows[0]?.name ?? null;
  const comprehensive = scope === "comprehensive";

  const sizeAt = async (atMs) =>
    (
      await db.query(
        `select count(*)::int as n from clan_membership
          where clan_tag = $1 and joined_observed_at <= ${ts(atMs)}
            and (left_observed_at is null or left_observed_at > ${ts(atMs)})`,
        [tag],
      )
    ).rows[0].n;
  const sizeFrom = await timed(perf, "clan.size", () => sizeAt(fromMs));
  const sizeTo = await timed(perf, "clan.size", () => sizeAt(toMs));

  // Activity: battles played while in this clan, learned in the window,
  // with sessions per member computed from the same rows. The fetch reaches
  // a day back on battle_time regardless of when a row was learned so a
  // session that straddles windows is judged whole; `learned` marks the
  // rows this window admitted, and the activity counts use only those.
  // The empty path first (3.18.0): 95-99% of the
  // Discord agents' reads return nothing, and the day-wide member
  // battle scan below is most of an empty read's cost. One probe off
  // the battle created_at index says whether this window learned a
  // battle of the clan's at all; when it did not, the session, standout,
  // returned and most-active queries have nothing to find and are
  // skipped. The probe splits the learned count into played-within-a-day
  // (narrated) and late captures, so the late count comes for free.
  const { rows: learnedRows } = await timed(perf, "clan.learned", () =>
    db.query(clanLearnedQuery({ tag, fromMs, toMs, basis })),
  );
  const learnedRecent = learnedRows[0]?.recent ?? 0;
  const lateCount = learnedRows[0]?.late ?? 0;
  const { rows: allBattles } = learnedRecent
    ? await timed(perf, "clan.member_battles", () =>
        db.query(clanMemberBattlesQuery({ tag, fromMs, toMs, basis })),
      )
    : { rows: [] };
  const memberBattles = allBattles.filter((r) => r.learned);
  const distinctBattles = new Set();
  const byMode = {};
  const byPlayer = new Map();
  for (const r of memberBattles) {
    if (!distinctBattles.has(r.battle_id)) {
      distinctBattles.add(r.battle_id);
      const g = modeGroupOf(r.type, r.event_tag);
      byMode[g] = (byMode[g] ?? 0) + 1;
    }
    if (!byPlayer.has(r.player_tag)) byPlayer.set(r.player_tag, []);
    byPlayer.get(r.player_tag).push(r);
  }
  let sessionsTotal = 0;
  for (const rows of byPlayer.values())
    sessionsTotal += sessionsOf(rows, toMs).length;
  // One member's sessions as items when the reader asked about that
  // member (Gym #258): a clan feed carries only standout sessions, so a
  // member who played two ordinary games read 0 items.
  // Sessions of two or more battles, as a player's own timeline serves
  // them (Gym #265: single battles were served).
  // Whole sittings, from the day-wide fetch the standouts read, kept
  // when this window learned one of their battles (Gym #270: hourly
  // reads cut one sitting into per-window pieces).
  const memberSessions = memberTag
    ? sessionsOf(
        allBattles.filter((r) => r.player_tag === memberTag),
        toMs,
        { learned: (b) => b.learned },
      ).filter((x) => x.battles >= 2 && x.learned_at !== null)
    : [];
  await nameSessions(db, memberSessions);
  // Session standouts: every member's sessions over the wider fetch, kept
  // when a rung was crossed by a battle this window learned. Named below,
  // once the roster query has the names.
  const byPlayerAll = new Map();
  for (const r of allBattles) {
    if (!byPlayerAll.has(r.player_tag)) byPlayerAll.set(r.player_tag, []);
    byPlayerAll.get(r.player_tag).push(r);
  }
  const standoutSessions = [];
  for (const [playerTag, rows] of byPlayerAll)
    for (const sess of sessionsOf(rows, toMs, { learned: (b) => b.learned }))
      if (sess.newly.length)
        standoutSessions.push({ player_tag: playerTag, ...sess });
  await timed(perf, "clan.sessions", () => nameSessions(db, standoutSessions));

  // Roster moves and war resolutions from the subject ledger, named.
  const { rows: ledgerRows } = await timed(perf, "clan.ledger", () =>
    db.query(
      `select ${CLAN_EVENT_COLUMNS} from clan_event
      where clan_tag = $1
        and ${ledgerWindowSql("", fromMs, toMs, basis, (a) => `${a}window_end`)}
      order by event_id`,
      [tag],
    ),
  );
  const ledger = await hydrateClanEvents(db, ledgerRows);
  // Rows written before 3.0.0 name the leaver by tag only; the player
  // table still knows the name.
  const unnamed = ledger
    .filter((e) => e.event_type === "member_left" && !e.payload?.name)
    .map((e) => e.payload?.player_tag)
    .filter(Boolean);
  const { rows: namedRows } = unnamed.length
    ? await db.query(
        `select player_tag, name from player where player_tag = any($1::text[])`,
        [unnamed],
      )
    : { rows: [] };
  const nameOf = new Map(namedRows.map((r) => [r.player_tag, r.name]));
  for (const e of ledger)
    if (e.event_type === "member_left" && e.payload && !e.payload.name)
      e.payload = {
        ...e.payload,
        name: nameOf.get(e.payload.player_tag) ?? null,
      };
  const joined = [];
  const left = [];
  const roleChanges = [];
  const resolved = [];
  for (const e of ledger) {
    const p = e.payload ?? {};
    const at = iso(e.occurred_at ?? e.window_end);
    if (e.event_type === "member_joined")
      joined.push({
        tag: p.player_tag,
        name: p.name ?? null,
        role: p.role ?? null,
        at,
      });
    else if (e.event_type === "member_left")
      left.push({
        tag: p.player_tag,
        name: p.name ?? null,
        role: p.role_at_departure ?? null,
        at,
        tenure_days: p.joined_observed_at
          ? Math.floor(
              (e.window_end.getTime() - Date.parse(p.joined_observed_at)) /
                DAY_MS,
            )
          : null,
      });
    else if (e.event_type === "role_changed")
      roleChanges.push({
        tag: p.player_tag,
        name: p.name ?? null,
        from: p.role_before ?? null,
        to: p.role_after ?? null,
        direction: p.direction ?? null,
        at,
      });
    else if (e.event_type === "week_resolved")
      resolved.push({
        season_id: p.season_id,
        week: (p.section_index ?? 0) + 1,
        is_colosseum: Boolean(p.is_colosseum),
        finished_at: at,
        fame: p.fame ?? null,
        rank: p.rank ?? null,
        trophy_change: p.trophy_change ?? null,
      });
  }
  const bounced = joined.filter((j) =>
    left.some((l) => l.tag === j.tag),
  ).length;
  // A resolved week's members as the race recorded them (#375): each
  // member's decks used and points for the WEEK (war facts are weekly
  // aggregates; points are the race's per-member points, not fame).
  const weekKey = (x) => `${x?.season_id}|${x?.section_index}`;
  const resolvedWeeks = ledger.filter(
    (e) => e.event_type === "week_resolved" && e.payload,
  );
  const weekMembers = new Map();
  if (resolvedWeeks.length) {
    const { rows: wm } = await timed(perf, "clan.week_members", () =>
      db.query(
        `select wp.season_id, wp.section_index, wp.player_tag, p.name,
                wp.decks_used, wp.points
           from war_participation wp
           join player p on p.player_tag = wp.player_tag
           join unnest($2::int[], $3::int[]) as w(season_id, section_index)
             on w.season_id = wp.season_id and w.section_index = wp.section_index
          where wp.clan_tag = $1
          order by wp.points desc, wp.decks_used desc, p.name nulls last, wp.player_tag`,
        [
          tag,
          resolvedWeeks.map((e) => e.payload.season_id),
          resolvedWeeks.map((e) => e.payload.section_index),
        ],
      ),
    );
    for (const r of wm) {
      const k = weekKey(r);
      if (!weekMembers.has(k)) weekMembers.set(k, []);
      weekMembers.get(k).push({
        player_tag: r.player_tag,
        name: r.name,
        decks_used: r.decks_used,
        points: r.points,
      });
    }
  }

  // War: the week the window ENDS in (Gym #166: a past window had
  // served the current week's race under the past day's label), or the
  // latest recorded week before it; the period from the calendar.
  let war = null;
  const p = await periodAt(db, toMs);
  const { rows: wk } = await db.query(
    `select season_id, section_index, is_colosseum, finished_observed_at, closed_at
       from war_week where clan_tag = $1
        and ($2::int is null or (season_id, section_index) <= ($2::int, $3::int))
      order by season_id desc, section_index desc limit 1`,
    [tag, p?.warSeasonId ?? null, p?.sectionIndex ?? null],
  );
  const sameWeek =
    p &&
    wk[0] &&
    wk[0].season_id === p.warSeasonId &&
    wk[0].section_index === p.sectionIndex;
  if (wk[0]) {
    const { rows: ours } = await db.query(
      `select fame, rank, trophy_change, finish_time from war_week_clan
        where clan_tag = $1 and participant_clan_tag = $1
          and season_id = $2 and section_index = $3`,
      [tag, wk[0].season_id, wk[0].section_index],
    );
    const { rows: standing } = await db.query(
      `select count(*)::int + 1 as place from war_week_clan
        where clan_tag = $1 and season_id = $2 and section_index = $3
          and participant_clan_tag <> $1 and fame > $4`,
      [tag, wk[0].season_id, wk[0].section_index, ours[0]?.fame ?? 0],
    );
    // A window that ends before the week's race closed reads the race as
    // it stood at `to` (Gym #213: 09-12..09-15 served the week's final
    // 10,146 and a finish 5 days after `to`, where the clan stood at
    // 3,435): the banked fame and place at the last war day closed by
    // then, and no finish.
    const finishedAt = finishInstant(ours[0]?.finish_time);
    // The finish instant decides when the record has one; otherwise the
    // API's own close stamp (war_week.closed_at, exact), and only then
    // when the log was seen closing, which can lag the close by a day
    // (the gate's 213.3: finished 09:38, seen the next day).
    const closedMs = finishedAt
      ? Date.parse(finishedAt)
      : (wk[0].closed_at?.getTime() ?? null);
    const closedAfterTo =
      closedMs !== null
        ? closedMs > toMs
        : Boolean(
            wk[0].finished_observed_at &&
            wk[0].finished_observed_at.getTime() > toMs &&
            toMs < Date.now() - 3_600_000,
          );
    let asOf = null;
    if (closedAfterTo) {
      const { rows: day } = await db.query(
        `select l.progress_start, l.progress_earned, l.progress_from_defenses,
                l.progress_end, l.end_of_day_rank
           from war_period_log l
           join war_period wp on wp.war_season_id = l.season_id and wp.period_index = l.period_index
          where l.clan_tag = $1 and l.participant_clan_tag = $1
            and l.season_id = $2 and l.section_index = $3
            and wp.ends_at < ${ts(toMs + 1)}
          order by l.period_index desc limit 1`,
        [tag, wk[0].season_id, wk[0].section_index],
      );
      const r = day[0];
      const parts = r
        ? [r.progress_start, r.progress_earned, r.progress_from_defenses]
        : [];
      // No day closed by `to` in the record (a Colosseum week has no boat
      // log, or the first war day was still open): unknown, never 0 (Gym
      // #249: the Colosseum read 0 against a final of 38,700).
      asOf = {
        fame: !r
          ? null
          : parts.every(Number.isInteger) &&
              r.progress_end === 10000 &&
              parts.reduce((a, b) => a + b, 0) > 10000
            ? parts.reduce((a, b) => a + b, 0)
            : r.progress_end,
        place:
          r && Number.isInteger(r.end_of_day_rank) && r.end_of_day_rank >= 0
            ? r.end_of_day_rank + 1
            : null,
      };
    }
    // The day is the calendar's at the window's end, always; the race's
    // facts are that week's record, and null when the record holds no
    // race for it - never another week's under this day's label (#166).
    war = {
      season_id: sameWeek || !p ? wk[0].season_id : p.warSeasonId,
      week: (sameWeek || !p ? wk[0].section_index : p.sectionIndex) + 1,
      is_colosseum: sameWeek || !p ? wk[0].is_colosseum : null,
      day_kind: null,
      war_day: null,
      fame: !(sameWeek || !p)
        ? null
        : asOf
          ? asOf.fame
          : (ours[0]?.fame ?? null),
      place_of_five: !(sameWeek || !p)
        ? null
        : asOf
          ? asOf.place
          : (standing[0]?.place ?? null),
      race_finished_at: sameWeek || !p ? (asOf ? null : finishedAt) : null,
      ...(asOf ? { as_of_window_end: true } : {}),
      decks: null,
      resolved,
    };
    if (p) {
      war.day_kind = p.kind;
      war.war_day = p.warDay ?? null;
      // A training day of the week in progress: no race day has run, so
      // there is no fame or place yet (Gym #266: it read fame 0, place 1
      // of 5, where war_current ranks every clan null).
      // The same until the week's first war day closes (Gym #319: an open
      // war day 1 read "0 fame, place 1 of 5" where every clan is 0 and
      // unranked; a past window in that state already served null).
      if (sameWeek && (!p.warDay || p.warDay === 1) && !finishedAt && !asOf) {
        war.fame = null;
        war.place_of_five = null;
      }
    }
    // One reading of the clock for the gate and the tally's as_of (11.8.0
    // dropped this declaration and left as_of naming it: every war-day
    // timeline threw from 2026-10-15).
    const nowMs = Date.now();
    if (
      warDeckTallyOpen({
        period: p,
        sameWeek,
        finishedAt,
        toMs,
        nowMs,
      })
    ) {
      if (p.warDay) {
        // The game's own counter, as war_current.decks_today reads it
        // (9.1.2, Jamie 2026-09-25): no longer raised to war battles
        // placed on the policy day, which was the per-day attribution
        // the weekly decision retired.
        const { rows: decks } = await db.query(
          `with merged as (
             select wp.player_tag,
                    least(coalesce(t.decks_used_today, 0), 4) as d
               from war_participation wp
               left join war_attendance_day t
                 on t.clan_tag = wp.clan_tag and t.season_id = wp.season_id
                and t.section_index = wp.section_index and t.war_day = $4
                and t.player_tag = wp.player_tag
              where wp.clan_tag = $1 and wp.season_id = $2 and wp.section_index = $3
                and exists (select 1 from clan_membership cm
                             where cm.clan_tag = wp.clan_tag and cm.player_tag = wp.player_tag
                               and cm.left_observed_at is null))
           select count(*) filter (where d = 0)::int as untouched,
                  count(*) filter (where d between 1 and 3)::int as partial,
                  count(*) filter (where d = 4)::int as finished,
                  count(*)::int as participants
             from merged`,
          [tag, wk[0].season_id, wk[0].section_index, p.warDay],
        );
        if (decks[0].participants > 0)
          war.decks = { as_of: iso(Math.min(toMs, nowMs)), ...decks[0] };
      }
    }
  }

  // Presence: rung crossings inside the window, returns, never recorded.
  const { rows: members } = await timed(perf, "clan.members", () =>
    db.query(
      `with membership as materialized (
         select player_tag, role, joined_observed_at, left_observed_at
           from clan_membership
          where clan_tag = $1 and joined_observed_at < ${ts(toMs + 1)})
       select distinct on (cm.player_tag) cm.player_tag, p.name, cm.role,
            (select jsonb_agg(jsonb_build_object('from', m.joined_observed_at, 'to', m.left_observed_at, 'role', m.role))
               from membership m where m.player_tag = cm.player_tag) as membership,
            (select max(bp.battle_time) from battle_participant bp
              where bp.player_tag = cm.player_tag and bp.battle_time < ${ts(toMs + 1)}) as last_battle,
            (select floor(extract(epoch from (${ts(toMs)} - max(r.fetched_at))) / 86400)::int
               from api_receipt r
              where r.entity_key = cm.player_tag and r.endpoint = 'player_battlelog'
                and r.fetched_at < ${ts(toMs + 1)})
              as days_since_poll
       from membership cm
       join player p on p.player_tag = cm.player_tag
       order by cm.player_tag, cm.joined_observed_at desc`,
      [tag],
    ),
  );
  // Quiet and never-recorded summaries use membership at the window's end.
  // Moments use their own time; keep older tenures too, because a return
  // played before `from` may only be learned inside this window.
  const tenureAt = (m, at) =>
    m.membership.find(
      (period) =>
        Date.parse(period.from) <= at &&
        (period.to === null || Date.parse(period.to) > at),
    );
  const memberAt = (m, at) => Boolean(tenureAt(m, at));
  const quietCrossed = [];
  let neverRecorded = 0;
  for (const m of members) {
    if (!memberAt(m, toMs)) continue;
    if (!m.last_battle) {
      neverRecorded += 1;
      continue;
    }
    const last = m.last_battle.getTime();
    const rung = QUIET_RUNGS_DAYS.filter(
      (r) => (toMs - last) / DAY_MS >= r && (fromMs - last) / DAY_MS < r,
    ).pop();
    if (
      rung !== undefined &&
      (m.days_since_poll === null || m.days_since_poll < rung)
    )
      quietCrossed.push({
        tag: m.player_tag,
        name: m.name,
        role: m.role,
        days_quiet: Math.floor((toMs - last) / DAY_MS),
        days_since_poll: m.days_since_poll,
        rung,
        at: iso(last + rung * DAY_MS),
      });
  }
  quietCrossed.sort((a, b) => b.days_quiet - a.days_quiet);
  // Every crossing the window holds, for the items (Gym #247): from each
  // member's battle gaps, not the last battle as of `to`, so a member who
  // crossed five quiet days and then played again, or crossed ten, keeps
  // the crossing the window saw. The entry's quiet_crossed stays the
  // window-end state.
  const crossings = [];
  const returns = [];
  if (comprehensive && members.length) {
    const maxRung = QUIET_RUNGS_DAYS.at(-1);
    const { rows: times } = await timed(perf, "clan.quiet_gaps", () =>
      db.query(
        `select * from (
           select bp.player_tag, bp.battle_time,
                  (select b.created_at from battle b where b.battle_id = bp.battle_id) as learned_at
             from battle_participant bp
            where bp.player_tag = any($1::text[])
              and bp.battle_time > ${ts(fromMs - maxRung * DAY_MS)}
              and bp.battle_time < ${ts(toMs + 1)}
           union all
           -- Each member's last battle before that, so a return after a
           -- longer absence has the gap's start.
           select m.tag, lb.battle_time, null
             from unnest($1::text[]) as m(tag)
             join lateral (
               select bp.battle_time from battle_participant bp
                where bp.player_tag = m.tag
                  and bp.battle_time <= ${ts(fromMs - maxRung * DAY_MS)}
                order by bp.battle_time desc limit 1) lb on true
         ) t order by player_tag, battle_time`,
        [members.map((m) => m.player_tag)],
      ),
    );
    const byTag = new Map();
    const learnedAt = new Map();
    for (const r of times) {
      if (!byTag.has(r.player_tag)) byTag.set(r.player_tag, []);
      byTag.get(r.player_tag).push(r.battle_time.getTime());
      learnedAt.set(
        `${r.player_tag}|${r.battle_time.getTime()}`,
        r.learned_at?.getTime() ?? null,
      );
    }
    for (const m of members) {
      const t = byTag.get(m.player_tag) ?? [];
      // Gaps start at each battle; the last one runs to `to`.
      for (let i = 0; i < t.length; i += 1) {
        const start = t[i];
        const end = i + 1 < t.length ? t[i + 1] : toMs;
        const open = i + 1 === t.length;
        // A return is the battle that closes a long gap, observed when
        // the record learned it (Gym #272: a return whose absence began
        // inside the window was missed).
        const learnedMs = open
          ? null
          : occurred
            ? end
            : learnedAt.get(`${m.player_tag}|${end}`);
        if (
          !open &&
          memberAt(m, end) &&
          end - start >= RETURN_AFTER_DAYS * DAY_MS &&
          (learnedMs ?? end) > fromMs &&
          (learnedMs ?? end) <= toMs
        )
          returns.push({
            tag: m.player_tag,
            name: m.name,
            after_days: Math.floor((end - start) / DAY_MS),
            at: iso(end),
            observed_at: iso(learnedMs ?? end),
          });
        for (const rung of QUIET_RUNGS_DAYS) {
          const atMs = start + rung * DAY_MS;
          // (from, to]: an open gap ends AT `to`, so a crossing there is
          // in this window (Gym #318: it was in neither window and paging
          // lost it); a closed gap ends at the battle that ended it.
          if (
            !memberAt(m, atMs) ||
            atMs <= fromMs ||
            atMs > toMs ||
            (open ? atMs > end : atMs >= end)
          )
            continue;
          // Never while the silence is ours (the gap still open and the
          // record not polling the member).
          // days_since_poll is today's, so it speaks only for a window
          // ending near now (a past window's crossings are the record's:
          // the older-items read lost two, Gym #274).
          if (
            open &&
            toMs >= Date.now() - DAY_MS &&
            m.days_since_poll !== null &&
            m.days_since_poll >= rung
          )
            continue;
          crossings.push({
            tag: m.player_tag,
            name: m.name,
            role: tenureAt(m, atMs).role,
            rung,
            // The member's poll lag rides along, as on every crossing (#163).
            days_since_poll: m.days_since_poll,
            at: iso(atMs),
          });
        }
      }
    }
  }
  const memberName = new Map(members.map((m) => [m.player_tag, m.name]));
  // Strongest crossing first: the highest rung index, then trophies moved.
  const strength = (sess) =>
    Math.max(
      ...sess.crossed.map((label) => {
        const [key, rung] = label.split(">=");
        return SESSION_RUNGS[key].indexOf(Number(rung));
      }),
    );
  standoutSessions.sort(
    (a, b) =>
      strength(b) - strength(a) ||
      Math.abs(b.trophy_net) - Math.abs(a.trophy_net),
  );
  const sessionStandouts = standoutSessions.map((sess) => ({
    tag: sess.player_tag,
    name: memberName.get(sess.player_tag) ?? null,
    ...sessionFacts(sess),
    crossed: sess.crossed,
    crossings: sess.crossings,
  }));
  // Returns come from the battle gaps below (Gym #272), which also see
  // a return whose absence began inside the window.
  // Standouts, bounded and named.
  const { rows: most } = !learnedRecent
    ? { rows: [] }
    : await timed(perf, "clan.most", () =>
        db.query(
          `select bp.player_tag, p.name, count(distinct bp.battle_id)::int as battles
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
       join player p on p.player_tag = bp.player_tag
      where bp.clan_tag = $1
        and ${
          occurred
            ? `bp.battle_time >= ${ts(fromMs + 1)} and bp.battle_time < ${ts(toMs + 1)}`
            : `bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time < ${ts(toMs + 1)}
        and b.created_at >= ${ts(fromMs + 1)} and b.created_at < ${ts(toMs + 1)}`
        }
        and b.battle_time >= b.created_at - interval '1 day'
      group by bp.player_tag, p.name
      order by battles desc, p.name nulls last limit $2`,
          [tag, STANDOUT_CAP],
        ),
      );
  // Member moments from the ledger: named, bounded.
  const { rows: momentRows } = await timed(perf, "clan.moments", () =>
    db.query(
      `select ${PLAYER_EVENT_COLUMNS.replaceAll(/(^|, )/g, "$1pe.")}, p.name
       from player_event pe
       join clan_membership cm on cm.player_tag = pe.player_tag
        and cm.clan_tag = $1 and cm.left_observed_at is null
       join player p on p.player_tag = pe.player_tag
      where pe.event_type = any($2::text[])
        and ${ledgerWindowSql("pe", fromMs, toMs, basis)}
      order by pe.event_id`,
      [tag, PLAYER_MOMENT_KINDS],
    ),
  );
  // The same moment written twice in the ledger is one moment in the
  // entry too, as in the items (Gym #250: "Aaqib Javed -> Master 2"
  // twice in the standouts and the summary while the items said it once).
  const moments = (await hydratePlayerEvents(db, momentRows))
    .filter((m) => ledgerInWindow(m, fromMs, toMs, basis))
    .filter(
      ((seen) => (m) => {
        const key = `${m.player_tag}|${m.event_type}|${JSON.stringify(m.payload ?? null)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })(new Set()),
    );
  const arenaNames = await arenaNamesFor(
    db,
    moments
      .filter((m) => m.event_type === "arena_changed")
      .flatMap((m) => [m.payload.from, m.payload.to]),
  );
  const pick = (kind, map) =>
    moments
      .filter((m) => m.event_type === kind)
      .map((m) => ({ tag: m.player_tag, name: m.name, ...map(m.payload) }));
  const newBests = pick("best_trophies_band", (p) => ({ best: p.best }));
  newBests.sort((x, y) => y.best - x.best);
  const arenaPromotions = pick("arena_changed", (p) => ({
    arena: p.to_name ?? arenaNames.get(p.to) ?? null,
    ...(p.promoted_by
      ? {
          over:
            p.promoted_by.opponent?.name ??
            p.promoted_by.opponent?.player_tag ??
            null,
          score: `${p.promoted_by.crowns}-${p.promoted_by.crowns_against}`,
        }
      : {}),
  }));
  const rankedPromotions = pick("ranked_promotion", (p) => ({
    league: leagueName(p.to),
    ...(p.promoted_by
      ? {
          over:
            p.promoted_by.opponent?.name ??
            p.promoted_by.opponent?.player_tag ??
            null,
          score: `${p.promoted_by.crowns}-${p.promoted_by.crowns_against}`,
        }
      : {}),
  }));
  const collectionSteps = pick("collection_level_step", (p) => ({
    level: p.level,
  }));
  const badgeCounts = new Map();
  for (const m of moments) {
    if (
      m.event_type !== "badge_earned" &&
      m.event_type !== "legendary_badge_earned"
    )
      continue;
    const cur = badgeCounts.get(m.player_tag) ?? {
      tag: m.player_tag,
      name: m.name,
      count: 0,
      names: [],
    };
    cur.count += 1;
    if (cur.names.length < 3) cur.names.push(m.payload.name);
    badgeCounts.set(m.player_tag, cur);
  }
  const badges = [...badgeCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, STANDOUT_CAP);

  const { rows: don } = await timed(perf, "clan.donations", () =>
    db.query(
      // The members AT the window's end (Gym #216: a past week summed
      // today's roster, 8,977 where the week's 47 members gave 9,094; the
      // 117 was a member who left three days after the week closed).
      `with m as (select distinct player_tag from clan_membership
                 where clan_tag = $1 and joined_observed_at < ${ts(toMs + 1)}
                   and (left_observed_at is null or left_observed_at > ${ts(toMs)})),
     -- The week's donations are the highest counter value seen in its
     -- game days (Monday 10:00Z on; Jamie, 2026-09-23), not the latest
     -- read, which after the weekly reset is the new week's.
     latest as (select s.player_tag, max(s.donations)::int as donations
                  from player_snapshot_daily s join m on m.player_tag = s.player_tag
                 where s.observed_at < ${ts(toMs + 1)}
                   -- The game week the window ends in, read from its last
                   -- instant before to: a window ending on the Monday 10:00Z
                   -- boundary is the week that just closed (Gym #165).
                   and s.snapshot_date >= date_trunc('week', game_day(${ts(toMs - 1)}))::date
                   and s.snapshot_kind in ('daily', 'pre_reset')
                 group by s.player_tag)
     select coalesce(sum(latest.donations), 0)::int as total,
            count(*)::int as counted,
            (select json_build_object('tag', l.player_tag, 'name', p.name, 'given', l.donations)
               from latest l join player p on p.player_tag = l.player_tag
              order by l.donations desc nulls last limit 1) as leader
       from latest`,
      [tag],
    ),
  );

  // Battles PLAYED in the window that the record learned only after it
  // (a history backfill, a late poll): activity counts what the window
  // learned, so a backfilled week read "0 battles by 0 of 48 members"
  // where clans_standings, which counts by play time, had 3,547 (Gym #248).
  const { rows: laterRows } =
    comprehensive && !occurred
      ? await timed(perf, "clan.learned_later", () =>
          db.query(
            `select count(distinct b.battle_id)::int as n
             from battle_participant bp join battle b on b.battle_id = bp.battle_id
            where bp.clan_tag = $1
              and bp.battle_time >= ${ts(fromMs + 1)} and bp.battle_time < ${ts(toMs + 1)}
              and b.created_at >= ${ts(toMs + 1)}`,
            [tag],
          ),
        )
      : { rows: [] };
  const learnedLater = laterRows[0]?.n ?? 0;
  const entry = {
    kind: "clan_activity",
    subject_tag: tag,
    name,
    scope,
    window: { from: iso(fromMs), to: iso(toMs) },
    summary: null,
    activity: comprehensive
      ? {
          battles: distinctBattles.size,
          members_active: byPlayer.size,
          members_total: sizeTo,
          sessions: sessionsTotal,
          by_mode: byMode,
          late_captures: lateCount,
          played_here_learned_later: learnedLater,
          // Counted above because the record learned them here, though
          // they were played (within a day) before the window opened (Gym
          // #259: 39 battles said, 33 played in the window).
          learned_here_played_before: memberBattles.filter(
            (r) => r.battle_time.getTime() <= fromMs,
          ).length,
          // What the counts select by: battles the record learned in the
          // window, or battles played in it (an occurred read).
          basis: occurred ? "played" : "recorded",
        }
      : {
          battles: null,
          members_active: null,
          members_total: sizeTo,
          sessions: null,
          by_mode: null,
          late_captures: null,
          basis:
            "activity scope records roster and war only; member battles are not recorded for this clan",
        },
    // Newest first, like the timeline they sit beside (Jamie,
    // 2026-09-23): the ledger reads oldest first, and a busy week keeps
    // its latest twenty.
    roster: {
      joined: capList([...joined].reverse()),
      left: capList([...left].reverse()),
      role_changes: capList([...roleChanges].reverse()),
      bounced,
      size: { from: sizeFrom, to: sizeTo },
    },
    war,
    presence: comprehensive
      ? {
          quiet_crossed: capList(quietCrossed.map(({ at: _at, ...r }) => r)),
          // Every return the window's battle gaps hold, as the items say
          // (Gym #272: a return whose absence began inside the window was
          // missing from the entry). Newest first.
          returned: capList(
            [...returns]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((r) => ({
                tag: r.tag,
                name: r.name,
                after_days: r.after_days,
              })),
          ),
          never_recorded: neverRecorded,
          rungs_days: QUIET_RUNGS_DAYS,
        }
      : {
          quiet_crossed: null,
          returned: null,
          never_recorded: null,
          rungs_days: QUIET_RUNGS_DAYS,
          basis:
            "activity scope: no member battle record to judge presence from",
        },
    standouts: comprehensive
      ? {
          most_battles: most.map((r) => ({
            tag: r.player_tag,
            name: r.name,
            battles: r.battles,
          })),
          new_bests: capList(newBests, STANDOUT_CAP),
          arena_promotions: capList(arenaPromotions, STANDOUT_CAP),
          ranked_promotions: capList(rankedPromotions, STANDOUT_CAP),
          collection_levels: capList(collectionSteps, STANDOUT_CAP),
          badges,
          sessions: capList(sessionStandouts, STANDOUT_CAP),
          session_rungs: SESSION_RUNGS,
        }
      : null,
    donations: {
      week_total: don[0]?.total ?? 0,
      members_counted: don[0]?.counted ?? 0,
      leader: don[0]?.leader ?? null,
      as_of: iso(toMs),
    },
  };
  entry.summary = summarizeClan(entry, timezone);

  // Timeline items for this clan: the ledger, member moments (bounded),
  // and the derived presence moments.
  const items = [];
  const clanSubject = { tag, kind: "clan", name };
  const subject = {
    subject_tag: tag,
    subject_name: name,
    subjects: [clanSubject],
  };
  // A story about a member names the member first, then the clan.
  const aboutMember = (playerTag, playerName) =>
    playerTag
      ? [
          { tag: playerTag, kind: "player", name: playerName ?? null },
          clanSubject,
        ]
      : [clanSubject];
  const clanLedgerRows = ledger.filter((e) =>
    CLAN_LEDGER_KINDS.includes(e.event_type),
  );
  const memberRows = moments.filter(
    (m) => m.event_type !== "badge_earned" || badgeItemWorthy(m.payload),
  );
  const clanFirstIds = await timed(perf, "clan.story_ids", () =>
    firstEventIds(db, "clan_event", clanLedgerRows),
  );
  const memberFirstIds = await timed(perf, "clan.story_ids", () =>
    firstEventIds(db, "player_event", memberRows),
  );
  // Every sitting this read tells, anchored in one statement: the member
  // read's sessions, then the standouts (revision at the last rung this
  // window learned, so a new rung is the same story grown).
  const anchored = await timed(perf, "clan.sittings", () =>
    sittingAnchors(db, [
      ...memberSessions.map((s) => ({
        player_tag: memberTag,
        startMs: Date.parse(s.started_at),
        upToMs: Date.parse(s.ended_at),
      })),
      // Through the sitting's last battle, as its facts are (#375: the
      // facts said 24 battles and the evidence 20, cut at the crossing).
      ...standoutSessions.map((s) => ({
        player_tag: s.player_tag,
        startMs: Date.parse(s.started_at),
        upToMs: Date.parse(s.ended_at),
      })),
    ]),
  );
  const memberAnchored = anchored.slice(0, memberSessions.length);
  const standoutAnchored = anchored.slice(memberSessions.length);
  const standoutDetails = await timed(perf, "clan.sitting_details", () =>
    sittingDetails(
      db,
      standoutSessions.map((s) => ({
        player_tag: s.player_tag,
        startMs: Date.parse(s.started_at),
        endMs: Date.parse(s.ended_at),
      })),
    ),
  );
  for (const e of clanLedgerRows) {
    const warKind =
      e.event_type === "race_finished" ||
      e.event_type === "week_resolved" ||
      e.event_type === "bracket_observed";
    items.push({
      ...subject,
      subjects: warKind
        ? [clanSubject]
        : aboutMember(e.payload?.player_tag, e.payload?.name),
      at: iso(e.occurred_at ?? e.window_end),
      kind:
        e.event_type === "role_changed" ? "member_role_changed" : e.event_type,
      section: warKind ? "war" : "roster",
      facts:
        e.event_type === "week_resolved"
          ? { ...e.payload, members: weekMembers.get(weekKey(e.payload)) ?? [] }
          : e.payload,
      [STORY]: ledgerStory("clan_event", clanFirstIds, e),
    });
  }
  const memberItems = memberRows.map((m) => ({
    ...subject,
    subjects: aboutMember(m.player_tag, m.name),
    at: iso(m.occurred_at ?? m.window_end),
    observed_at: iso(m.evidence_observed_at ?? m.window_end),
    kind: m.event_type,
    section: "standouts",
    facts: {
      player_tag: m.player_tag,
      name: m.name,
      ...decorate(m.event_type, m.payload, arenaNames),
    },
    [STORY]: ledgerStory("player_event", memberFirstIds, m),
    ...crossingEvidence(m, memberFirstIds.get(String(m.event_id))),
  }));
  // Newest first before the cap (Jamie, 2026-09-23: the timeline is a
  // stream of what is new), so what a busy window drops is the oldest,
  // counted in `more`.
  memberItems.sort((a, b) => b.at.localeCompare(a.at));
  items.push(...memberItems.slice(0, MEMBER_MOMENTS_CAP));
  // A standout session is an item at the instant of the first rung this
  // window learned, observed when the record learned that battle. Every
  // standout is an item (Gym #164: five were served and the rest dropped
  // with has_more false); the timeline's own cap and cursor bound them.
  for (const [i, sess] of memberSessions.entries())
    items.push({
      ...subject,
      // The member is who played it; the item stays on the clan's
      // timeline (Gym #265: the text named the clan as the player).
      subjects: aboutMember(memberTag, memberName.get(memberTag)),
      at: sess.started_at,
      observed_at: sess.learned_at ?? sess.started_at,
      kind: "battle_session",
      section: "battles",
      facts: {
        player_tag: memberTag,
        name: memberName.get(memberTag) ?? null,
        ...sessionFacts(sess),
      },
      [STORY]: sittingStory(memberTag, memberAnchored[i], sess.started_at),
      ...sessionEvidence(
        memberTag,
        memberAnchored[i],
        sess.ended_at,
        sess.open,
      ),
    });
  for (const [i, sess] of standoutSessions.entries())
    items.push({
      ...subject,
      subjects: aboutMember(sess.player_tag, memberName.get(sess.player_tag)),
      // The sitting's start, as its battle_session says it (one story,
      // one instant); each rung's own battle is in crossings[].at.
      // The standout's moment is the battle that crossed its rung (each
      // rung's own is in crossings[]); the sitting's span is in facts.
      at: iso(sess.newly[0].at),
      observed_at: iso(Math.max(...sess.newly.map((n) => n.learnedAt))),
      kind: "session_standout",
      section: "standouts",
      facts: {
        player_tag: sess.player_tag,
        name: memberName.get(sess.player_tag) ?? null,
        ...sessionFacts(sess),
        crossed: sess.crossed,
        newly: sess.newly.map((n) => n.label),
        // Each rung with the value that crossed it, when and by which
        // battle (#373).
        crossings: sess.crossings,
        ...standoutDetails[i],
      },
      [STORY]: sittingStory(
        sess.player_tag,
        standoutAnchored[i],
        sess.started_at,
      ),
      ...sessionEvidence(
        sess.player_tag,
        standoutAnchored[i],
        sess.ended_at,
        sess.open,
      ),
    });
  if (comprehensive) {
    for (const q of crossings)
      items.push({
        ...subject,
        subjects: aboutMember(q.tag, q.name),
        at: q.at,
        kind: "quiet_crossed",
        section: "presence",
        facts: {
          player_tag: q.tag,
          name: q.name,
          role: q.role,
          rung: q.rung,
          // At the crossing, as the player item (Gym #119).
          days_quiet: q.rung,
          days_since_poll: q.days_since_poll,
        },
        [STORY]: moment("quiet_crossed", q.tag, q.rung, q.at),
      });
    for (const r of returns)
      items.push({
        ...subject,
        subjects: aboutMember(r.tag, r.name),
        at: r.at,
        observed_at: r.observed_at,
        kind: "returned",
        section: "presence",
        facts: {
          player_tag: r.tag,
          name: r.name,
          after_days: r.after_days,
        },
        [STORY]: moment("returned", r.tag, r.at),
      });
  }
  return {
    entry,
    items,
    more: Math.max(0, memberItems.length - MEMBER_MOMENTS_CAP),
    dropped: memberItems.slice(MEMBER_MOMENTS_CAP),
  };
}

/* ------------------------------------------------------------------ */
/* The timeline                                                        */
/* ------------------------------------------------------------------ */

/** Account events of one kind this close together are one item (#376:
 *  six connections revoked in one second were six items). An answer to
 *  feedback is never folded (#536): each carries its own words. */
const ACCOUNT_BURST_MS = 60_000;
/** The feedback answer's kind in the account ledger. */
const FEEDBACK_RESPONDED = "feedback_responded";
/** How much of the filer's message an answer item carries: the lead the
 *  answer mail prints. */
const FEEDBACK_MESSAGE_LEAD = 600;
async function accountItems(db, accountId, fromMs, toMs) {
  if (!accountId) return [];
  // The app a connection event is about, by the name its client gave
  // (the account's own administration: never published). An answer to
  // feedback reads its item as filed, which answer of the item's it is
  // (its revision), and whether a later answer has replaced it.
  const { rows } = await db.query(
    `select e.event_id, e.kind, e.detail, e.created_at, oc.client_name as app,
            fb.feedback_id as fb_id, fb.area as fb_area, fb.category as fb_category,
            fb.message as fb_message, fb.created_at as fb_filed_at,
            fb.response as fb_response, fb.shipped_in as fb_shipped_in,
            fa.answer_no, fa.answers
       from account_event e
       left join oauth_family f on f.family_id::text = e.detail->>'family_id'
       left join oauth_client oc
         on oc.client_id = coalesce(f.client_id, e.detail->>'client_id')
       left join feedback fb
         on e.kind = '${FEEDBACK_RESPONDED}'
        and fb.account_id = e.account_id
        and fb.feedback_id = case when e.detail->>'feedback_id' ~ '^[0-9]{1,18}$'
                                  then (e.detail->>'feedback_id')::bigint end
       left join lateral (
         select count(*) filter (where a.event_id <= e.event_id)::int as answer_no,
                count(*)::int as answers
           from account_event a
          where fb.feedback_id is not null
            and a.account_id = e.account_id and a.kind = '${FEEDBACK_RESPONDED}'
            and a.detail->>'feedback_id' = e.detail->>'feedback_id') fa on true
      where e.account_id = $1 and e.created_at >= ${ts(fromMs + 1)} and e.created_at < ${ts(toMs + 1)}
      order by e.event_id`,
    [accountId],
  );
  const bursts = [];
  // An item answered twice in the window is told once, at its later
  // answer: one story, the higher revision (timeline principle 2).
  const answers = new Map();
  for (const r of rows) {
    if (r.kind === FEEDBACK_RESPONDED) {
      const id = r.detail?.feedback_id;
      const told = id === undefined ? undefined : answers.get(String(id));
      if (told) told.rows = [r];
      else {
        const one = { kind: r.kind, rows: [r], single: true };
        bursts.push(one);
        if (id !== undefined) answers.set(String(id), one);
      }
      continue;
    }
    const last = bursts.at(-1);
    if (
      last &&
      !last.single &&
      last.kind === r.kind &&
      r.created_at.getTime() - last.rows.at(-1).created_at.getTime() <=
        ACCOUNT_BURST_MS
    )
      last.rows.push(r);
    else bursts.push({ kind: r.kind, rows: [r] });
  }
  return bursts.map(({ kind, rows: group }) => {
    const first = group[0];
    if (kind === FEEDBACK_RESPONDED) return answerItem(first);
    const apps = [...new Set(group.map((r) => r.app).filter(Boolean))];
    return {
      subject_tag: null,
      subject_name: "your account",
      subjects: [],
      at: iso(first.created_at),
      observed_at: iso(group.at(-1).created_at),
      kind: `account_${kind}`,
      section: "account",
      facts: { ...(first.detail ?? {}), count: group.length, apps },
      [STORY]: moment("account_event", String(first.event_id)),
    };
  });
}

/**
 * One answer to feedback as its item (#536 stage 2): the item as filed
 * and the answer as given. Its story is the feedback item, so a revised
 * answer is the same id at a higher revision. The words are the event's
 * (from 11.13.0); an event from before carries none, and its words are
 * the item's own only while it is still the latest answer, else null.
 */
function answerItem(r) {
  const d = r.detail ?? {};
  const found = r.fb_id !== null && r.fb_id !== undefined;
  const latest = found && r.answer_no === r.answers;
  const said = (key, current) =>
    key in d ? (d[key] ?? null) : latest ? (current ?? null) : null;
  const message =
    r.fb_message === null || r.fb_message === undefined
      ? null
      : String(r.fb_message).slice(0, FEEDBACK_MESSAGE_LEAD);
  return {
    subject_tag: null,
    subject_name: "your account",
    subjects: [],
    at: iso(r.created_at),
    observed_at: iso(r.created_at),
    kind: `account_${FEEDBACK_RESPONDED}`,
    section: "account",
    facts: {
      feedback_id: d.feedback_id ?? null,
      status: d.status ?? null,
      response: said("response", r.fb_response),
      shipped_in: said("shipped_in", r.fb_shipped_in),
      area: r.fb_area ?? null,
      category: r.fb_category ?? null,
      message,
      filed_at: iso(r.fb_filed_at),
      answered_at: iso(r.created_at),
      count: 1,
      apps: [],
    },
    // An event that names no item of the account's keeps its own story.
    [STORY]: !found
      ? moment("account_event", String(r.event_id))
      : {
          key: ["feedback", String(r.fb_id)],
          revision: Math.max(1, r.answer_no),
        },
  };
}

const ROLE_RANK_SQL = `max(case cm.role when 'leader' then 3 when 'coLeader' then 2
  when 'elder' then 1 else 0 end)`;

/**
 * Attested facts (9.2.0; Jamie, 2026-09-25): what a person did in a clan
 * through a family app, and what a family app's own game produced for a
 * player, held apart from the game record (attested_fact, 0178). Each is
 * shown only to the reader its type allows, decided here per reader:
 *
 *   - clan: the reader's (an agent's owner's) verified player is in the
 *     clan today;
 *   - leaders: a PERSON whose verified player leads it (leader or
 *     co-leader), reading with an INTERACTIVE credential (a session or
 *     their own OAuth consent, never a service key); never
 *     an agent;
 *   - player: the player is one of the reader's subjects.
 *
 * Who sees a type is read from the registry here, not from the row's
 * stored `visibility` (what the type said when it was written): 9.3.0
 * made a departure's kind `clan`, and the rows written under 9.2.0 follow
 * without a rewrite.
 *
 * Only clan subjects carry clan facts, and nothing without a reader
 * (the clan mail's composition) carries any. The one reader that is no
 * account is the clan's own Discord channel (`clanMember`, 2026-10-10):
 * it reads its clan's facts as any member does, the `clan` kinds only.
 * Selected by when Elixir recorded them, like every ledger item; `at` is
 * when they happened.
 */
const FACT_KINDS_SEEN_BY = (visibility) =>
  ATTESTED_FACT_KINDS.filter(
    (k) =>
      ATTESTED_FACT_TYPES[k].subject === "clan" &&
      ATTESTED_FACT_TYPES[k].visibility === visibility,
  );
export async function factItems(
  db,
  subjects,
  {
    accountId,
    fromMs,
    toMs,
    interactive = false,
    clanMember = false,
    basis = "observed",
  },
) {
  if (!accountId && !clanMember) return [];
  const clanTags = subjects.filter((s) => s.kind === "clan").map((s) => s.tag);
  const playerTags = subjects
    .filter((s) => s.kind === "player")
    .map((s) => s.tag);
  if (!clanTags.length && !playerTags.length) return [];
  if (!accountId)
    return readFactItems(db, subjects, {
      fromMs,
      toMs,
      basis,
      inClan: clanTags,
      leads: [],
      playerTags: [],
    });
  const { rows: who } = await db.query(
    `select kind, coalesce(owned_by_account_id, account_id) as seat_account
       from account where account_id = $1`,
    [accountId],
  );
  if (!who[0]) return [];
  const seats = clanTags.length
    ? (
        await db.query(
          `select cm.clan_tag, ${ROLE_RANK_SQL} as rank
             from claim c
             join clan_membership cm
               on cm.player_tag = c.player_tag and cm.left_observed_at is null
            where c.account_id = $1 and c.status = 'verified'
              and cm.clan_tag = any($2::text[])
            group by cm.clan_tag`,
          [who[0].seat_account, clanTags],
        )
      ).rows
    : [];
  const inClan = seats.map((r) => r.clan_tag);
  const leads =
    who[0].kind === "person" && interactive
      ? seats.filter((r) => r.rank >= 2).map((r) => r.clan_tag)
      : [];
  if (!inClan.length && !playerTags.length) return [];
  return readFactItems(db, subjects, {
    fromMs,
    toMs,
    basis,
    inClan,
    leads,
    playerTags,
  });
}

async function readFactItems(
  db,
  subjects,
  { fromMs, toMs, basis = "observed", inClan, leads, playerTags },
) {
  const { rows } = await db.query(
    `select f.*, cl.name as clan_name, p.name as player_name,
            ap.name as attester_name, pp.name as previous_name
       from attested_fact f
       left join clan cl on cl.clan_tag = f.clan_tag
       left join player p on p.player_tag = f.player_tag
       left join player ap on ap.player_tag = f.attester_tag
       left join player pp on pp.player_tag = f.detail->>'previous_player_tag'
      where f.recorded_at >= ${ts(fromMs + 1)}
        and ${basis === "occurred" ? `f.occurred_at >= ${ts(fromMs + 1)} and f.occurred_at < ${ts(toMs + 1)}` : `f.recorded_at < ${ts(toMs + 1)}`}
        and ((f.subject_kind = 'clan' and f.fact_type = any($4::text[])
              and f.clan_tag = any($1::text[]))
          or (f.subject_kind = 'clan' and f.fact_type = any($5::text[])
              and f.clan_tag = any($2::text[]))
          or (f.subject_kind = 'player' and f.player_tag = any($3::text[])))
      order by f.recorded_at, f.fact_id`,
    [
      inClan,
      leads,
      playerTags,
      FACT_KINDS_SEEN_BY("clan"),
      FACT_KINDS_SEEN_BY("leaders"),
    ],
  );
  const nicknames = new Map(
    subjects
      .filter((s) => s.kind === "player" && s.nickname)
      .map((s) => [s.tag, s.nickname]),
  );
  return rows.map((f) => {
    const clan = f.subject_kind === "clan";
    const nickname = clan ? null : nicknames.get(f.player_tag);
    return {
      subject_tag: clan ? f.clan_tag : f.player_tag,
      subject_name: clan ? f.clan_name : f.player_name,
      ...(nickname ? { nickname } : {}),
      subjects: [
        ...(f.player_tag
          ? [{ tag: f.player_tag, kind: "player", name: f.player_name }]
          : []),
        ...(clan ? [{ tag: f.clan_tag, kind: "clan", name: f.clan_name }] : []),
      ],
      at: iso(f.occurred_at),
      observed_at: iso(f.recorded_at),
      kind: f.fact_type,
      section: "attested",
      facts: {
        ...f.detail,
        ...(f.player_tag
          ? { player_tag: f.player_tag, name: f.player_name }
          : {}),
        // The name beside the tag of who held a place before (9.10.1): a
        // lead changing hands is said with both names.
        ...(f.detail?.previous_player_tag
          ? { previous_name: f.previous_name ?? null }
          : {}),
        attested_by: {
          app: FAMILY_APP_NAMES[f.source] ?? f.source,
          player_tag: f.attester_tag,
          name: f.attester_name,
          role: f.attester_role,
        },
        visibility:
          ATTESTED_FACT_TYPES[f.fact_type]?.visibility ?? f.visibility,
      },
      [STORY]: moment("attested_fact", String(f.fact_id)),
    };
  });
}

/**
 * The timeline and its entries for a list of subjects over one window.
 * Player subjects with nothing to say are listed under `quiet` rather than
 * given an entry (§13.4); clan subjects always get one, because a clan's
 * silence is itself the clan's activity. Items are newest first, and
 * the cap keeps the newest.
 */
/** The timeline's cap. The timeline is a stream of what is new, read
 *  newest first by everyone (Jamie, 2026-09-23; contract 7.0.0), so a
 *  window past the cap keeps its newest items and the rest are counted,
 *  not paged: a reader catching up lands on the present. `items` is
 *  newest first. */
export function capTimeline(items) {
  return {
    kept: items.slice(0, TIMELINE_CAP),
    cut: items.slice(TIMELINE_CAP),
  };
}

export async function buildTimeline(
  db,
  subjects,
  {
    fromMs,
    toMs,
    timezone = "UTC",
    accountId = null,
    perf = null,
    filter = null,
    memberTag = null,
    // A person reading with a session or their own consent, not a key
    // (factItems: leaders-only facts). False unless the caller says so.
    interactive = false,
    // No account: the clan's own channel, reading its clan's facts as a
    // member does (factItems).
    clanMember = false,
    // What the window selects by (ledgerWindowSql): what the record
    // learned in it, or what happened in it.
    basis = "observed",
  },
) {
  const entries = [];
  const quiet = [];
  let items = [];
  let more = 0;
  // Every item a cap left out, so the caller can say where a reader must
  // continue from (Gym #120) and count only what its filters would show.
  const dropped = [];
  for (const s of subjects) {
    if (s.kind === "clan") {
      const built = await buildClanEntry(db, {
        tag: s.tag,
        scope: s.scope,
        fromMs,
        toMs,
        timezone,
        perf,
        memberTag,
        basis,
      });
      entries.push(built.entry);
      items.push(...built.items);
      more += built.more;
      dropped.push(...(built.dropped ?? []));
      continue;
    }
    const built = await buildPlayerEntry(db, {
      tag: s.tag,
      relationship: s.relationship ?? null,
      nickname: s.nickname ?? null,
      fromMs,
      toMs,
      timezone,
      perf,
      basis,
    });
    const e = built.entry;
    const said =
      built.items.some(
        (it) =>
          it.evidence?.kind === "crossing" &&
          it.evidence.status === "proved" &&
          it.evidence.attachment_revision > 1,
      ) ||
      e.battles.played > 0 ||
      e.notables.length > 0 ||
      e.clan.changes.length > 0 ||
      e.collection.unlocked.items.length > 0 ||
      e.collection.forms_unlocked.items.length > 0;
    if (said) {
      entries.push(e);
      items.push(...built.items);
    } else
      quiet.push({
        tag: e.subject_tag,
        name: e.name,
        nickname: e.nickname,
        relationship: e.relationship,
        days_quiet: e.presence.days_quiet,
        days_since_poll: e.presence.days_since_poll,
      });
  }
  items.push(...(await accountItems(db, accountId, fromMs, toMs)));
  items.push(
    ...(await factItems(db, subjects, {
      accountId,
      fromMs,
      toMs,
      interactive,
      clanMember,
      basis,
    })),
  );
  items.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  // The same moment written twice (feedback #48, still in the 09-14
  // ledger rows, Gym #121): identical subject, kind and facts is one
  // moment, kept at its first instant. Nothing is deleted; the read
  // serves it once.
  // Every item says when the record observed it; an item that is not a
  // polled moment (a battle session, a join) was observed at its instant.
  for (const it of items) it.observed_at ??= it.at;
  // Roster moves are real repeats, never a duplicated row, unless they
  // share their instant (Gym #246: a same-day rejoin collapsed into the
  // first join, and the feed ended on "alex left").
  const ROSTER_KINDS = new Set([
    "member_joined",
    "member_left",
    "member_role_changed",
    "clan_joined",
    "clan_left",
    // A second absence at the same rung, or a second return, is a new
    // moment with the same facts (Gym #272).
    "quiet_crossed",
    "returned",
  ]);
  const dedupeKey = (it) =>
    `${it.subject_tag}|${it.kind}|${ROSTER_KINDS.has(it.kind) ? it.at : ""}|${JSON.stringify(it.facts ?? null)}`;
  const seen = new Map();
  items = items.filter((it) => {
    const key = dedupeKey(it);
    const kept = seen.get(key);
    if (kept) {
      if (
        it.evidence &&
        kept.evidence &&
        it.evidence.observed_at > kept.evidence.observed_at
      )
        Object.assign(kept, {
          evidence: it.evidence,
          [EVIDENCE]: it[EVIDENCE],
          observed_at: it.observed_at,
        });
      // The collapsed row's story is the lower ledger row's, whichever
      // of the two came first by instant (#111).
      const [a, b] = [kept[STORY]?.key, it[STORY]?.key];
      if (
        a &&
        b &&
        a[0] === b[0] &&
        LEDGERS.has(a[0]) &&
        BigInt(b[1]) < BigInt(a[1])
      )
        kept[STORY] = it[STORY];
      return false;
    }
    seen.set(key, it);
    return true;
  });
  // The story fields, after the dedupe (#111), first on each item. An
  // item no builder named (none today) is the story its dedupe key says.
  const told = (it) => {
    const { [STORY]: named, ...rest } = it;
    const story = named ?? moment("item", dedupeKey(it));
    return {
      id: storyId(...story.key),
      revision: story.revision ?? 1,
      ...rest,
    };
  };
  items = items.map(told);
  // A late proof and its original observation are one moment. Keep the
  // latest evidence under the original id, including legacy duplicate rows.
  const origins = new Map();
  items = items.filter((it) => {
    if (!it.evidence || it.evidence.kind !== "crossing") return true;
    const key = `${it.subject_tag}|${it.id}`;
    const kept = origins.get(key);
    if (!kept) {
      origins.set(key, it);
      return true;
    }
    if (
      it.evidence.observed_at > kept.evidence.observed_at ||
      (it.evidence.status === "proved" && kept.evidence.status !== "proved")
    )
      Object.assign(kept, it);
    return false;
  });
  // The caller's filter (kinds, sections, a member) applies BEFORE the
  // cap (Gym #244: the cap counted items the filter then removed, so a
  // filtered reader got 18 of 50 items and a busy-window note).
  if (filter) items = items.filter(filter);
  // One item per story (#374): a member followed as a player and seen on
  // their clan's timeline was two items under one id.
  items = mergeStories(items);
  for (const it of items) it.sort_at = sortAt(it);
  // Served newest first by when the story last moved (sort_at).
  const sortMs = (it) => Date.parse(it.sort_at ?? it.at);
  items.sort((a, b) => sortMs(b) - sortMs(a));
  // The cap cuts in the order the window SELECTS by (Gym #317): cut by
  // `at`, an item learned 17 h late was the oldest left out, its
  // observed_at became the boundary, and a continuation to that instant
  // held the same item and served nothing, forever. An occurred read
  // selects by sort_at, so it cuts by it. Display order stays sort_at.
  const pageMs = basis === "occurred" ? sortMs : observedOf;
  const { kept, cut } = capTimeline(
    [...items].sort((a, b) => pageMs(b) - pageMs(a)),
  );
  const keptSet = new Set(kept);
  more += cut.length;
  dropped.push(...cut);
  items = items.filter((it) => keptSet.has(it));
  for (const it of items) finishItem(it, { fromMs, basis, timezone });
  return {
    window: { from: iso(fromMs), to: iso(toMs) },
    timeline: items,
    timeline_more: more,
    timeline_dropped: dropped.map((it) => {
      const t = it.id === undefined ? told(it) : it;
      t.sort_at ??= sortAt(t);
      return t;
    }),
    entries,
    quiet,
  };
}

const observedOf = (it) => Date.parse(it.observed_at ?? it.at);

/** The instant a story sorts by: a sitting's last battle (it moved
 *  then), every other item's own instant. */
const SITTINGS = new Set(["battle_session", "session_standout"]);
const sortAt = (it) =>
  SITTINGS.has(it.kind) && it.facts?.ended_at ? it.facts.ended_at : it.at;

/** Which copy of a story tells it: the richer kind, then the copy whose
 *  facts say more. */
const KIND_RANK = { session_standout: 1 };
const copyRank = (it) => [
  KIND_RANK[it.kind] ?? 0,
  Object.keys(it.facts ?? {}).length,
];
const isPlayerCopy = (it) =>
  Boolean(it.subject_tag) &&
  it.subjects?.[0]?.kind === "player" &&
  it.subjects[0].tag === it.subject_tag;

/**
 * Copies of one story (one id) become one item: the richer copy's kind
 * and facts, every subject either copy names (players first, then
 * clans), the highest revision, the latest observation and the latest
 * evidence. subject_tag is the player when the reader follows the
 * player, else the clan whose timeline holds it.
 */
export function mergeStories(items) {
  const byId = new Map();
  const out = [];
  for (const it of items) {
    const kept = byId.get(it.id);
    if (!kept) {
      byId.set(it.id, it);
      out.push(it);
      continue;
    }
    const [ra, rb] = [copyRank(kept), copyRank(it)];
    const better = rb[0] > ra[0] || (rb[0] === ra[0] && rb[1] > ra[1]);
    const base = better ? it : kept;
    const other = better ? kept : it;
    const player = [kept, it].find(isPlayerCopy);
    const subjects = [];
    for (const sub of [...(base.subjects ?? []), ...(other.subjects ?? [])])
      if (!subjects.some((x) => x.tag === sub.tag && x.kind === sub.kind))
        subjects.push(sub);
    subjects.sort(
      (a, b) => (a.kind === "player" ? 0 : 1) - (b.kind === "player" ? 0 : 1),
    );
    const evidenceFrom =
      (other.evidence?.count ?? -1) > (base.evidence?.count ?? -1) ||
      (other.evidence?.count === base.evidence?.count &&
        (other.evidence?.observed_at ?? "") >
          (base.evidence?.observed_at ?? ""))
        ? other
        : base;
    const merged = {
      ...base,
      subject_tag: (player ?? base).subject_tag,
      subject_name: (player ?? base).subject_name,
      subjects,
      revision: Math.max(base.revision ?? 1, other.revision ?? 1),
      observed_at:
        observedOf(other) > observedOf(base)
          ? other.observed_at
          : base.observed_at,
      ...(evidenceFrom.evidence
        ? {
            evidence: evidenceFrom.evidence,
            [EVIDENCE]: evidenceFrom[EVIDENCE],
          }
        : {}),
    };
    const nickname = player?.nickname ?? base.nickname ?? other.nickname;
    delete merged.nickname;
    if (nickname) merged.nickname = nickname;
    for (const k of Reflect.ownKeys(kept)) delete kept[k];
    Object.assign(kept, merged);
  }
  return out;
}

/** Who may see an item, by its source (DECISIONS: leaders-only items and
 *  the account's own administration never leave Elixir; attested facts
 *  by their type's rule): public is the game record; clan and player are
 *  the attested rules; leaders and owner never publish. */
export function itemVisibility(it) {
  if (it.section === "account") return "owner";
  if (it.section === "attested")
    return ATTESTED_FACT_TYPES[it.kind]?.visibility ?? "owner";
  return "public";
}
const PUBLISHABLE = new Set(["public", "clan", "player"]);
/** Whether an item may leave Elixir (cross-posting reads this, server
 *  side): usable as a buildTimeline filter, before the item is finished. */
export const isPublishable = (it) => PUBLISHABLE.has(itemVisibility(it));

/** The local reading of an instant in the reader's zone. */
function localOf(isoAt, timeZone) {
  const d = new Date(isoAt);
  const parts = (tz) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(d)
        .map((x) => [x.type, x.value]),
    );
  let tz = timeZone;
  let p;
  try {
    p = parts(tz);
  } catch {
    tz = "UTC";
    p = parts(tz);
  }
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    weekday: p.weekday,
    tz,
  };
}

/** The fields every served item carries beside its story (#373-#376):
 *  its instants in three forms, whether a poller learned it late, who
 *  may see it, its facts' schema, and its time-free sentence. */
function finishItem(it, { fromMs, basis, timezone }) {
  it.sort_at ??= sortAt(it);
  it.at_unix = Math.floor(Date.parse(it.at) / 1000);
  it.local = localOf(it.at, timezone);
  // Happened before the window that selected it: an observed read
  // learned it late (it belongs to an earlier day's story).
  it.late = basis === "observed" && Date.parse(it.sort_at) <= fromMs;
  it.visibility = itemVisibility(it);
  it.publishable = PUBLISHABLE.has(it.visibility);
  it.schema = itemSchema(it.kind);
  it.text = itemText(it, timezone);
}

/**
 * Whether a window could hold a timeline item, without building it
 * (skip_empty, 11.7.0). A poll that finds nothing should cost one
 * statement, not a build: on 2026-10-09 the three Discord agents' polls
 * were 89% of MCP calls, 96% of them empty, each paying ~24 queries.
 *
 * One column per item source in buildTimeline, each a superset of what
 * that source can serve, so "false everywhere" proves an empty timeline
 * and "true" only means build it. A source missed here is a lost post,
 * which is worse than a slow poll: every kind in ITEM_KINDS belongs to a
 * source below, and the test walks them all. A source is checked only
 * when the caller's `kinds` keeps one of its kinds (the kinds filter
 * runs before the cap, so a kind it drops cannot change the answer);
 * `sections` is not consulted, which errs toward building.
 *
 * Two sources are time, not rows: a quiet rung is crossed when the days
 * since a battle reach it, so the check asks for a battle a rung before
 * the window with nothing after it until the rung.
 */
export const NEWS_SOURCES = {
  // buildPlayerEntry: sessions from battles learned in the window, and a
  // return, which needs one of them.
  player_battles: ["battle_session", "returned"],
  player_moments: PLAYER_MOMENT_KINDS,
  player_clan_moves: ["clan_joined", "clan_left"],
  player_quiet: ["quiet_crossed"],
  // buildClanEntry: the ledger (role_changed is served as
  // member_role_changed), member moments, sessions and returns from
  // member battles the window learned, and quiet rungs.
  clan_ledger: [
    "member_joined",
    "member_left",
    "member_role_changed",
    "bracket_observed",
    "race_finished",
    "week_resolved",
  ],
  clan_member_moments: PLAYER_MOMENT_KINDS,
  clan_member_battles: ["session_standout", "battle_session", "returned"],
  clan_quiet: ["quiet_crossed"],
  // accountItems serves account_<kind>; factItems the attested kinds.
  account: ["account_*"],
  attested: ATTESTED_FACT_KINDS,
};

export async function timelineNews(
  db,
  subjects,
  { fromMs, toMs, accountId = null, kinds = null },
) {
  const wants = (source) =>
    !kinds ||
    NEWS_SOURCES[source].some((k) =>
      k === "account_*"
        ? kinds.some((x) => x.startsWith("account_"))
        : kinds.includes(k),
    );
  const players = subjects.filter((s) => s.kind === "player").map((s) => s.tag);
  const clans = subjects.filter((s) => s.kind === "clan").map((s) => s.tag);
  const comprehensive = subjects
    .filter(
      (s) =>
        s.kind === "clan" && (s.scope ?? "comprehensive") === "comprehensive",
    )
    .map((s) => s.tag);
  const inWindow = (col) =>
    `${col} >= ${ts(fromMs + 1)} and ${col} < ${ts(toMs + 1)}`;
  // A battle `r` days before the window with none after it until the rung
  // (presenceOf and the clan's battle gaps: a crossing at battle + r in
  // (from, to] whose gap is still open there). Lateral per tag and rung,
  // so each is a range on battle_participant_player_time_cover: joined
  // to the tag set with the rung's bounds, the planner scanned the whole
  // table (512 ms of a 526 ms check, live on 2026-10-10).
  const quietSql = (tagsSql) =>
    `exists (select 1 from (${tagsSql}) as t(player_tag)
       cross join unnest(array[${QUIET_RUNGS_DAYS.join(", ")}]) as r(days)
       cross join lateral (
         select bp.battle_time from battle_participant bp
          where bp.player_tag = t.player_tag
            and bp.battle_time > ${ts(fromMs)} - make_interval(days => r.days)
            and bp.battle_time <= ${ts(toMs)} - make_interval(days => r.days)) bp
      where not exists (select 1 from battle_participant nx
                         where nx.player_tag = t.player_tag
                           and nx.battle_time > bp.battle_time
                           and nx.battle_time <= bp.battle_time + make_interval(days => r.days)))`;
  const members = (tagsParam, extra = "") =>
    `select cm.player_tag from clan_membership cm
      where cm.clan_tag = any(${tagsParam}) and cm.joined_observed_at < ${ts(toMs + 1)}${extra}`;
  const checks = {
    player_battles:
      players.length &&
      `exists (select 1 from battle_participant bp join battle b on b.battle_id = bp.battle_id
                where bp.player_tag = any(p.players)
                  and bp.battle_time >= ${ts(fromMs - DAY_MS)} and bp.battle_time < ${ts(toMs + 1)}
                  and ${inWindow("b.created_at")})`,
    player_moments:
      players.length &&
      `exists (select 1 from player_event pe
                where pe.player_tag = any(p.players) and pe.event_type = any(p.moment_kinds)
                  and ${inWindow("coalesce(pe.evidence_observed_at, pe.window_end)")})`,
    player_clan_moves:
      players.length &&
      `exists (select 1 from clan_membership cm
                where cm.player_tag = any(p.players)
                  and ((${inWindow("cm.joined_observed_at")}) or (${inWindow("cm.left_observed_at")})))`,
    player_quiet: players.length && quietSql("select unnest(p.players)"),
    clan_ledger:
      clans.length &&
      `exists (select 1 from clan_event e
                where e.clan_tag = any(p.clans) and e.event_type = any(p.ledger_kinds)
                  and ${inWindow("e.window_end")})`,
    clan_member_moments:
      clans.length &&
      `exists (select 1 from player_event pe
                join clan_membership cm on cm.player_tag = pe.player_tag
                 and cm.clan_tag = any(p.clans) and cm.left_observed_at is null
                where pe.event_type = any(p.moment_kinds)
                  and ${inWindow("coalesce(pe.evidence_observed_at, pe.window_end)")})`,
    // Standouts and a member's sessions read battles in the clan; a return
    // reads a member's battles wherever they were played, back to the
    // deepest rung, so both are asked.
    clan_member_battles:
      clans.length &&
      `exists (select 1 from battle b join battle_participant bp on bp.battle_id = b.battle_id
                where ${inWindow("b.created_at")}
                  and bp.battle_time > ${ts(fromMs - QUIET_RUNGS_DAYS.at(-1) * DAY_MS)}
                  and bp.battle_time < ${ts(toMs + 1)}
                  and (bp.clan_tag = any(p.clans)
                       or bp.player_tag in (${members("p.clans")})))`,
    clan_quiet:
      comprehensive.length &&
      quietSql(
        members(
          "p.comprehensive",
          ` and (cm.left_observed_at is null or cm.left_observed_at > ${ts(fromMs)})`,
        ),
      ),
    account:
      accountId &&
      `exists (select 1 from account_event
                where account_id = p.account_id and ${inWindow("created_at")})`,
    attested:
      (players.length || clans.length) &&
      `exists (select 1 from attested_fact f
                where ${inWindow("f.recorded_at")}
                  and ((f.subject_kind = 'clan' and f.clan_tag = any(p.clans))
                    or (f.subject_kind = 'player' and f.player_tag = any(p.players))))`,
  };
  const asked = Object.entries(checks).filter(([k, sql]) => sql && wants(k));
  const sources = Object.fromEntries(
    Object.keys(NEWS_SOURCES).map((k) => [k, false]),
  );
  if (asked.length) {
    const {
      rows: [row],
    } = await db.query(
      // Every parameter typed once, here (pg-param-type-from-first-use).
      `select ${asked.map(([k, sql]) => `${sql} as ${k}`).join(",\n")}
         from (select $1::text[] as players, $2::text[] as clans,
                      $3::text[] as comprehensive, $4::text[] as moment_kinds,
                      $5::text[] as ledger_kinds, $6::uuid as account_id) p`,
      [
        players,
        clans,
        comprehensive,
        PLAYER_MOMENT_KINDS,
        CLAN_LEDGER_KINDS,
        accountId,
      ],
    );
    for (const [k] of asked) sources[k] = row[k] === true;
  }
  return { any: Object.values(sources).some(Boolean), sources };
}

/** Entries only: the ops preview and the console read this shape. */
export async function buildEntries(db, subjects, opts) {
  const out = await buildTimeline(db, subjects, opts);
  return { window: out.window, entries: out.entries, quiet: out.quiet };
}
