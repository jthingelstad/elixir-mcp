/**
 * The deck switch (0289): a player took up a deck, named by its archetype
 * label, in one mode, and it is real. The owner, 2026-11-17: "In general we
 * were filtering a lot of things that now a timeline would get value
 * from"; VISION names the deck switch as the moment a friend wants to
 * hear about.
 *
 * The rule, decided here (DECISIONS [engineering], 2026-11-17):
 *
 *  - Modes are different games, never pooled: Trophy Road (PvP), Ranked
 *    (pathOfLegend) and Clan Wars battles (riverRacePvP). Event content,
 *    casual play, duels (four decks a battle) and boat battles are not a
 *    deck the player keeps, and a drawn deck (draft, pick, preset) is a
 *    deck nobody chose.
 *  - The deck is its archetype label, and only a label that names a win
 *    condition ("Hog Rider cycle"): a bare family names nothing a friend
 *    would recognise. A label is a noun, not a verdict.
 *  - A run starts at the first battle with that label in that mode after
 *    14 days without it. The switch is real at the run's third battle,
 *    when that third battle comes within 7 days of the first.
 *  - There was something to switch from: three or more battles in that
 *    mode with other labelled decks in the 14 days before the run, and the
 *    record reaches back that far (the player's first recorded battle is at
 *    least 14 days before the run). A new follow has no history, so it
 *    says nothing.
 *  - Only a live poll speaks: the projector calls this with the mark the
 *    poll read (no mark, a first log, says nothing), only the third battle
 *    newly delivered past that mark fires, and a late capture (a battle
 *    recorded more than a day after it was played) never does. So the
 *    battles already in the record when this ships write nothing.
 *  - One switch per player per mode a day: two decks tried on one evening
 *    are one moment, the first.
 *
 * Stamped at the third battle (the instant the switch became real); the
 * window opens at the first. battles and wins count the run from its first
 * battle through the newest this poll delivered.
 */

import { emitEvent } from "./events.mjs";

const LOOKBACK_DAYS = 14;
const RUN_DAYS = 7;
const RUN_BATTLES = 3;
const PRIOR_BATTLES = 3;
const DAY = 24 * 3600_000;

/** The battle types a kept deck plays, by mode group. */
const MODE_OF_TYPE = {
  PvP: "ladder",
  pathOfLegend: "ranked",
  riverRacePvP: "war",
};

/** As tools' DRAWN_DECKS: the player did not bring their own deck. */
const DRAWN = ["draft", "draftCompetitive", "pick", "predefined", "unknown"];

export const DECK_SWITCH_RULE = Object.freeze({
  lookbackDays: LOOKBACK_DAYS,
  runDays: RUN_DAYS,
  runBattles: RUN_BATTLES,
  priorBattles: PRIOR_BATTLES,
});

/** Most frequent value of key(x) over xs; ties go to the latest. */
function mostPlayed(xs, key) {
  const counts = new Map();
  for (const x of xs) {
    const k = key(x);
    const c = counts.get(k) ?? { n: 0, last: 0 };
    c.n += 1;
    c.last = Math.max(c.last, x.t);
    counts.set(k, c);
  }
  let best = null;
  for (const [k, c] of counts)
    if (
      best === null ||
      c.n > best.c.n ||
      (c.n === best.c.n && c.last > best.c.last)
    )
      best = { k, c };
  return best?.k ?? null;
}

/** The switches a delivery completed, as pure data (tested alone).
 *  battles: this player's eligible battles, any order, each
 *  { battle_id, t (ms), created (ms), mode, label, deck_hash, win }.
 *  mark: the poll's prior high-water instant (ms). earliest: the
 *  player's first recorded battle (ms). */
export function findDeckSwitches(battles, { mark, earliest }) {
  const out = [];
  const byMode = new Map();
  for (const b of battles) {
    if (!byMode.has(b.mode)) byMode.set(b.mode, []);
    byMode.get(b.mode).push(b);
  }
  for (const [mode, list] of byMode) {
    list.sort((a, b) => a.t - b.t || (a.battle_id < b.battle_id ? -1 : 1));
    let lastFired = -Infinity;
    for (let i = 0; i < list.length; i += 1) {
      const n = list[i];
      if (n.t <= mark || !n.label) continue;
      if (n.t < n.created - DAY) continue; // a late capture
      const same = list.slice(0, i + 1).filter((b) => b.label === n.label);
      // The run's start: the latest of these with no same-label battle in
      // the 14 days before it.
      let start = null;
      for (let j = same.length - 1; j >= 0; j -= 1) {
        const prev = same[j - 1];
        if (!prev || same[j].t - prev.t > LOOKBACK_DAYS * DAY) {
          start = j;
          break;
        }
      }
      const run = same.slice(start);
      if (run.length !== RUN_BATTLES) continue;
      const s = run[0];
      if (n.t - s.t > RUN_DAYS * DAY) continue;
      if (earliest === null || earliest > s.t - LOOKBACK_DAYS * DAY) continue;
      const prior = list.filter(
        (b) =>
          b.t < s.t &&
          b.t >= s.t - LOOKBACK_DAYS * DAY &&
          b.label &&
          b.label !== n.label,
      );
      if (prior.length < PRIOR_BATTLES) continue;
      if (n.t - lastFired < DAY) continue;
      lastFired = n.t;
      const priorLabel = mostPlayed(prior, (b) => b.label);
      const all = list.filter(
        (b) => b.label === n.label && b.t >= s.t && b.t <= s.t + RUN_DAYS * DAY,
      );
      out.push({
        mode_group: mode,
        label: n.label,
        deck_hash: mostPlayed(all, (b) => b.deck_hash),
        prior_label: priorLabel,
        prior_deck_hash: mostPlayed(
          prior.filter((b) => b.label === priorLabel),
          (b) => b.deck_hash,
        ),
        first_battle_id: s.battle_id,
        first_battle_time: new Date(s.t).toISOString(),
        battle_id: n.battle_id,
        battle_time: new Date(n.t).toISOString(),
        battles: all.length,
        wins: all.filter((b) => b.win).length,
      });
    }
  }
  return out;
}

/** Read the player's battles around a delivery, find the switches it
 *  completed and write each once. mark is the high-water mark the poll
 *  read before it wrote (an ISO string); without one nothing is said. */
export async function detectDeckSwitches(db, { playerTag, mark, receiptId }) {
  if (!mark) return { written: 0 };
  const { rows } = await db.query(
    `select bp.battle_id, bp.battle_time, b.created_at, bp.type, bp.deck_hash,
            bp.outcome = 'win' as win,
            case when cardinality(d.archetype_win_conditions) > 0
                  and d.archetype_family <> 'unclassified'
                 then d.archetype_label end as label
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
       left join deck d on d.deck_hash = bp.deck_hash
      where bp.player_tag = $1
        and bp.battle_time >= $2::timestamptz - make_interval(days => $3)
        and bp.type = any($4::text[])
        and b.event_tag is null
        and (b.deck_selection is null or b.deck_selection <> all($5::text[]))
        and bp.deck_hash is not null`,
    [
      playerTag,
      mark,
      LOOKBACK_DAYS + RUN_DAYS,
      Object.keys(MODE_OF_TYPE),
      DRAWN,
    ],
  );
  const markMs = Date.parse(mark);
  if (!rows.some((r) => r.battle_time.getTime() > markMs))
    return { written: 0 };
  const { rows: first } = await db.query(
    `select min(battle_time) as earliest from battle_participant where player_tag = $1`,
    [playerTag],
  );
  const switches = findDeckSwitches(
    rows.map((r) => ({
      battle_id: r.battle_id,
      t: r.battle_time.getTime(),
      created: r.created_at.getTime(),
      mode: MODE_OF_TYPE[r.type],
      label: r.label,
      deck_hash: r.deck_hash,
      win: r.win === true,
    })),
    { mark: markMs, earliest: first[0]?.earliest?.getTime() ?? null },
  );
  let written = 0;
  for (const s of switches) {
    // Once per run, and one a day per mode across polls.
    const { rows: seen } = await db.query(
      `select 1 from player_event
        where player_tag = $1 and event_type = 'deck_switched' and mode_group = $2
          and (battle_id = $3
               or occurred_at > $4::timestamptz - interval '1 day')
        limit 1`,
      [playerTag, s.mode_group, s.first_battle_id, s.battle_time],
    );
    if (seen.length) continue;
    await emitEvent(db, "deck_switched", {
      tag: playerTag,
      payload: s,
      windowStart: s.first_battle_time,
      windowEnd: s.battle_time,
      occurredAt: s.battle_time,
      receiptId,
    });
    written += 1;
  }
  return { written };
}
