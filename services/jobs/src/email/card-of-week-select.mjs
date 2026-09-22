/** Which card this week's issue is about (docs/EMAIL.md, the Friday
 *  kind). Jamie's rule, 2026-09-22: take the ten most-played cards of
 *  the season that we have not already featured inside a year, and draw
 *  one.
 *
 *  Read straight from the season rollup, not through a tool. A trailing
 *  28-day window was the first design and it cannot be served: the
 *  rollup answers a corpus read only when the window is EXACTLY one
 *  season (meta-season.mjs, seasonRollup), so any other window is a raw
 *  scan of the participant heap - and a seven-day corpus card read
 *  already exceeds the tool time budget at September's size. A season
 *  read is one indexed pass over ~130 rows.
 *
 *  Forms are MERGED here (form = -1). battles_meta_cards returns one row
 *  per (card, form) and never merges, so ranking its rows would rank
 *  Ice Wizard by its hero form alone and Wizard by its evolution alone.
 *
 *  The draw is seeded on the period key, so it is random across weeks
 *  and fixed within one: a dry run picks what the real send will pick, a
 *  re-run after a failure does not switch cards mid-week, and the choice
 *  can be reproduced by anyone holding the week and the candidate log. */
import { createHash } from "node:crypto";

const TOP_N = 10;
const YEAR_MS = 365 * 86_400_000;

/** A stable index into the candidates from the week's own key. */
export function drawIndex(seed, n) {
  if (n <= 0) return -1;
  // Six bytes is far more entropy than ten candidates need and stays
  // inside a safe integer.
  return (
    createHash("sha256").update(String(seed)).digest().readUIntBE(0, 6) % n
  );
}

/** The season a moment falls in, from the recorded calendar. */
async function seasonMonthAt(db, at) {
  const { rows } = await db.query(
    `select season_month from season where starts_at <= $1 and ends_at > $1`,
    [at],
  );
  return rows[0]?.season_month ?? null;
}

/** The eligible field, most played first: the season's merged per-card
 *  rollup, minus every card an issue actually SENT inside the last year.
 *  A dry run and a failed issue leave sent_at null and do not consume a
 *  card. */
async function candidates(db, { seasonMonth, since, limit = TOP_N }) {
  const { rows } = await db.query(
    `select cm.card_id, c.name, cm.battles, cm.players, t.decided,
            round(cm.battles::numeric / nullif(t.decided, 0), 4) as usage_share
       from card_meta_season cm
       join meta_season_totals t
         on t.season_month = cm.season_month and t.mode_group = cm.mode_group
       join card c on c.card_id = cm.card_id
      where cm.season_month = $1 and cm.mode_group = 'all' and cm.form = -1
        and c.kind = 'card' and cm.battles > 0
        and not exists (
          select 1 from email_featured_card f
           where f.card_id = cm.card_id
             and f.sent_at is not null and f.sent_at > $2)
      order by cm.battles desc, cm.card_id
      limit $3`,
    [seasonMonth, since, limit],
  );
  return rows.map((r) => ({
    card_id: r.card_id,
    name: r.name,
    battles: r.battles,
    players: r.players,
    usage_share: r.usage_share === null ? null : Number(r.usage_share),
  }));
}

/** One card, with the field it came from. `force` (the console setting
 *  or CARD_OF_WEEK_FORCE) names a card id for one issue and is logged as
 *  an override; it bypasses the year rule, because an operator asking
 *  for a card by id has said what they mean. */
export async function selectCard(
  db,
  { periodKey, now = new Date(), force = process.env.CARD_OF_WEEK_FORCE },
) {
  const seasonMonth = await seasonMonthAt(db, now);
  if (!seasonMonth)
    return {
      card: null,
      reason: null,
      candidates: [],
      why: "no season covers this moment",
    };
  const since = new Date(now.getTime() - YEAR_MS);
  const field = await candidates(db, { seasonMonth, since });

  // A week's pick, once recorded, is the week's pick. Re-selecting would
  // quietly switch cards on a re-run: the moment the issue sends, the
  // card leaves the eligible field, so a regenerate of the SAME week
  // would draw a different one and the issue would stop matching its
  // own brief. An override still wins, because an operator asking by id
  // has said what they mean.
  if (!force) {
    const {
      rows: [held],
    } = await db.query(
      `select f.card_id, f.score, f.reason, f.candidates, c.name
         from email_featured_card f join card c on c.card_id = f.card_id
        where f.period_key = $1`,
      [periodKey],
    );
    if (held)
      return {
        season_month: seasonMonth,
        card: {
          card_id: held.card_id,
          name: held.name,
          ...((held.candidates ?? []).find((x) => x.card_id === held.card_id) ??
            {}),
        },
        reason: held.reason,
        score: held.score === null ? null : Number(held.score),
        candidates: held.candidates ?? field,
        why: `already chosen for ${periodKey}: ${held.name}`,
      };
  }

  if (force) {
    const cardId = Number(force);
    const { rows } = await db.query(
      `select card_id, name from card where card_id = $1 and kind = 'card'`,
      [cardId],
    );
    if (!rows[0])
      return {
        card: null,
        reason: null,
        candidates: field,
        why: `CARD_OF_WEEK_FORCE names card ${force}, which is not in the catalog`,
      };
    // The forced card's own season numbers, whether or not it made the ten.
    const own = field.find((c) => c.card_id === cardId) ?? null;
    return {
      season_month: seasonMonth,
      card: { card_id: rows[0].card_id, name: rows[0].name, ...(own ?? {}) },
      reason: "override",
      score: own?.usage_share ?? null,
      candidates: field,
      why: `forced to ${rows[0].name} (${cardId})`,
    };
  }

  if (field.length === 0)
    return {
      season_month: seasonMonth,
      card: null,
      reason: null,
      candidates: [],
      why: `every card in season ${seasonMonth} has been featured inside the last year`,
    };
  const i = drawIndex(periodKey, field.length);
  return {
    season_month: seasonMonth,
    card: field[i],
    reason: "usage",
    score: field[i].usage_share,
    candidates: field,
    why: `drawn ${i + 1} of ${field.length} most played in season ${seasonMonth}, seed ${periodKey}`,
  };
}

/** Where the card stands among ALL cards this season, and its
 *  neighbours. The same merged rollup the selector ranks on, without the
 *  featured exclusion: the rank is a fact about the card, not about what
 *  we have already written up. */
export async function rankOf(db, { seasonMonth, cardId }) {
  const { rows } = await db.query(
    `with ranked as (
       select cm.card_id, c.name, cm.battles,
              round(cm.battles::numeric / nullif(t.decided, 0), 4) as usage_share,
              row_number() over (order by cm.battles desc, cm.card_id) as position,
              count(*) over () as of_total
         from card_meta_season cm
         join meta_season_totals t
           on t.season_month = cm.season_month and t.mode_group = cm.mode_group
         join card c on c.card_id = cm.card_id
        where cm.season_month = $1 and cm.mode_group = 'all' and cm.form = -1
          and c.kind = 'card' and cm.battles > 0)
     select * from ranked
      where position between
        (select position - 1 from ranked where card_id = $2)
        and (select position + 1 from ranked where card_id = $2)
      order by position`,
    [seasonMonth, cardId],
  );
  const me = rows.find((r) => r.card_id === cardId);
  if (!me) return null;
  const shape = (r) =>
    r && {
      card_id: r.card_id,
      name: r.name,
      usage_share: Number(r.usage_share),
      usage_share_pct: Number((Number(r.usage_share) * 100).toFixed(1)),
    };
  return {
    position: Number(me.position),
    of: Number(me.of_total),
    above:
      shape(rows.find((r) => Number(r.position) === Number(me.position) - 1)) ??
      null,
    below:
      shape(rows.find((r) => Number(r.position) === Number(me.position) + 1)) ??
      null,
  };
}

/** The week's pick, written before the issue is built. sent_at stays
 *  null until a send actually happens (recordFeaturedSent), so a failed
 *  issue or a dry run does not consume the card. A re-run of the same
 *  week overwrites the row rather than adding one: an issue features one
 *  card. */
export async function recordFeatured(
  db,
  { periodKey, card, reason, score, candidates: field },
) {
  await db.query(
    `insert into email_featured_card (period_key, card_id, score, reason, candidates)
     values ($1, $2, $3, $4, $5::jsonb)
     on conflict (period_key) do update
       set card_id = excluded.card_id, score = excluded.score,
           reason = excluded.reason, candidates = excluded.candidates,
           chosen_at = now()`,
    [periodKey, card.card_id, score, reason, JSON.stringify(field ?? [])],
  );
}

/** The card is consumed here, and only here. */
export async function recordFeaturedSent(db, { periodKey, at = new Date() }) {
  await db.query(
    `update email_featured_card set sent_at = $2 where period_key = $1 and sent_at is null`,
    [periodKey, at],
  );
}
