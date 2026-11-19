import { cardForms, MAX_DISPLAY_LEVEL } from "@elixir-mcp/contracts";
import { masteryCard } from "@elixir-mcp/record/badge-names";

const modes = {
  AutoChess: "Merge Tactics",
  "2v2League": "2v2 League",
  "seasonal-trophy-road": "Seasonal Trophy Road",
};

function deckChange(e, names) {
  const before = e.old_cards,
    after = e.new_cards;
  if (
    before?.length !== 8 ||
    after?.length !== 8 ||
    new Set(before).size !== 8 ||
    new Set(after).size !== 8 ||
    before.includes(null) ||
    after.includes(null)
  )
    return null;
  const lost = before.filter((id) => !after.includes(id)),
    added = after.filter((id) => !before.includes(id));
  const mode =
    e.mode_group === "ladder"
      ? "Trophy Road"
      : e.mode_group === "ranked"
        ? "Ranked"
        : null;
  if (!mode) return null;
  if (
    lost.length === 1 &&
    added.length === 1 &&
    names.has(lost[0]) &&
    names.has(added[0])
  )
    return `Kept seven cards in ${mode}, switching from ${names.get(lost[0])} to ${names.get(added[0])}.`;
  if (
    lost.length ||
    e.new_forms?.length !== 8 ||
    e.old_forms?.length !== 8 ||
    e.new_forms.includes(null) ||
    e.old_forms.includes(null)
  )
    return null;
  const changed = after.filter(
    (id, i) =>
      e.new_forms[i] != null &&
      e.old_forms[before.indexOf(id)] != null &&
      e.new_forms[i] !== e.old_forms[before.indexOf(id)],
  );
  if (changed.length !== 1 || !names.has(changed[0])) return null;
  const form = (bits) => cardForms(bits).join(" and ") || "base";
  const id = changed[0];
  return `Kept all eight cards in ${mode} and switched ${names.get(id)} from ${form(e.old_forms[before.indexOf(id)])} to ${form(e.new_forms[after.indexOf(id)])}.`;
}

/** Compose known changes with recorded collection decks. Profile snapshots
 * prove collection levels; battle levels in capped modes cannot prove them. */
export async function playerPlay(db, tag, now) {
  const args = [tag, new Date(now)];
  const {
    rows: [{ progress, changes }],
  } = await db.query(
    `with progress as (with readings as (
    select m.mode,p.progress_key,p.best_trophies,p.observed_at,
      lag(p.best_trophies) over(partition by p.progress_key order by p.day) as prior
    from player_progress_daily p join mode_season m using(progress_key)
    where p.player_tag=$1 and p.snapshot_kind='daily' and p.progress_key<>''
      and m.mode in ('AutoChess','2v2League','seasonal-trophy-road')
      and p.observed_at between $2::timestamptz-interval '14 days' and $2)
    select distinct on(mode) * from readings where best_trophies>prior
      and observed_at >= $2::timestamptz-interval '7 days' order by mode,observed_at desc),
    changes as (select e.event_type,e.badge_name,e.step,e.card_id,e.mode_group,e.window_end,
    a.card_ids as new_cards,a.card_forms as new_forms,b.card_ids as old_cards,b.card_forms as old_forms
    from player_event e left join deck a on a.deck_hash=e.deck_hash left join deck b on b.deck_hash=e.prior_deck_hash
    where e.player_tag=$1 and e.window_end between $2::timestamptz-interval '7 days' and $2
      and (e.event_type in ('card_maxed','deck_switched') or
        (e.event_type='badge_earned' and e.step is not null and e.badge_name like 'Mastery%'))
    order by e.window_end desc,e.event_id desc limit 40)
    select coalesce((select jsonb_agg(progress) from progress),'[]') as progress,
      coalesce((select jsonb_agg(changes order by window_end desc) from changes),'[]') as changes`,
    args,
  );
  const stories = progress.map((p) => ({
    at: p.observed_at,
    text: `${modes[p.mode]} season best rose from ${p.prior} to ${p.best_trophies} trophies.`,
  }));
  if (changes.length) {
    const { rows: decks } = await db.query(
      `with games as (select bp.deck_hash from battle_participant bp join battle b using(battle_id)
      where bp.player_tag=$1 and bp.battle_time between $2::timestamptz-interval '14 days' and $2
        and bp.type in ('PvP','pathOfLegend') and b.deck_selection='collection' and b.event_tag is null
        and cardinality(bp.cards)=8 order by bp.battle_time desc,bp.battle_id limit 30)
      select d.card_ids,count(*)::int as plays from games g join deck d using(deck_hash)
      where cardinality(d.card_ids)=8 group by d.card_ids order by plays desc,d.card_ids`,
      args,
    );
    const ids = [
      ...new Set([
        ...decks.flatMap((d) => d.card_ids),
        ...changes.flatMap((e) => [
          ...(e.old_cards ?? []),
          ...(e.new_cards ?? []),
        ]),
      ]),
    ];
    const { rows: cards } = await db.query(
      `select c.card_id,c.name,pc.level from card c
      left join player_card pc on pc.card_id=c.card_id and pc.player_tag=$1 where c.card_id=any($2::int[])`,
      [tag, ids],
    );
    const names = new Map(cards.map((c) => [c.card_id, c.name]));
    const maxed = new Set(
      cards.filter((c) => c.level === MAX_DISPLAY_LEVEL).map((c) => c.card_id),
    );
    for (const e of changes) {
      let text = null;
      if (e.event_type === "deck_switched") text = deckChange(e, names);
      if (e.event_type === "badge_earned") {
        const name = masteryCard(e.badge_name);
        const plays = decks.reduce(
          (n, d) =>
            d.card_ids.some((id) => names.get(id) === name) ? n + d.plays : n,
          0,
        );
        if (plays >= 2)
          text = `${name} reached Mastery level ${e.step} and appeared in ${plays} recent recorded Trophy Road or Ranked battles.`;
      }
      if (
        e.event_type === "card_maxed" &&
        names.has(e.card_id) &&
        decks.some(
          (d) =>
            d.plays >= 2 &&
            d.plays === decks[0].plays &&
            d.card_ids.includes(e.card_id) &&
            new Set(d.card_ids).size === 8 &&
            d.card_ids.every((id) => maxed.has(id)),
        )
      )
        text = `${names.get(e.card_id)} reached level ${MAX_DISPLAY_LEVEL}. All eight cards are now maxed in one of the most-played decks in this sample.`;
      if (text) stories.push({ at: e.window_end, text });
    }
  }
  const seen = new Set();
  return stories
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .filter((s) => !seen.has(s.text) && seen.add(s.text))
    .slice(0, 5);
}
