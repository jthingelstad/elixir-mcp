import { cardForms, MAX_DISPLAY_LEVEL } from "@elixir-mcp/contracts";
import { masteryCard } from "@elixir-mcp/record/badge-names";
import { battleLinks } from "@elixir-mcp/record/battle-links";

const modes = {
  AutoChess: "Merge Tactics",
  "2v2League": "2v2 League",
  "seasonal-trophy-road": "Seasonal Trophy Road",
  PvP: "Trophy Road",
  pathOfLegend: "Ranked",
};
const validDeck = (g) =>
  g.card_ids?.length === 8 &&
  g.card_ids.every(Number.isInteger) &&
  new Set(g.card_ids).size === 8;
const formName = (bits) => cardForms(bits).join(" and ") || "base";

// Two successive uses on either side distinguish a recurring variant from
// a one-game experiment. Compare exact identities, including within an archetype.
function variant(before, after, names) {
  if (
    !validDeck(before) ||
    !validDeck(after) ||
    before.tower_troop_id !== after.tower_troop_id ||
    ![before, after].every((d) => d.card_ids.every((id) => names.has(id)))
  )
    return null;
  const knownForms = [before, after].every(
    (d) => d.card_forms?.length === 8 && d.card_forms.every(Number.isInteger),
  );
  const prior = new Map(
    before.card_ids.map((id, i) => [id, before.card_forms?.[i]]),
  );
  const lost = before.card_ids.filter((id) => !after.card_ids.includes(id));
  const added = after.card_ids.filter((id) => !prior.has(id));
  const changed = after.card_ids.filter(
    (id, i) =>
      prior.has(id) && knownForms && prior.get(id) !== after.card_forms[i],
  );
  const label = (id, bits) =>
    bits ? names.get(id) + " (" + formName(bits) + ")" : names.get(id);
  let change;
  if (lost.length === 1 && added.length === 1 && !changed.length) {
    change = `Kept seven cards in ${modes[after.type]}, switching from ${label(lost[0], prior.get(lost[0]))} to ${label(added[0], after.card_forms?.[after.card_ids.indexOf(added[0])])}.`;
  } else if (!lost.length && !added.length && changed.length === 1) {
    const id = changed[0];
    change = `Kept all eight cards in ${modes[after.type]} and switched ${names.get(id)} from ${formName(prior.get(id))} to ${formName(after.card_forms[after.card_ids.indexOf(id)])}.`;
  } else return null;
  const cards = (d) => d.card_ids.map((id, i) => label(id, d.card_forms?.[i]));
  return {
    at: after.battle_time,
    text: change,
    before: cards(before),
    after: cards(after),
  };
}

function repeatedChanges(games, names, since) {
  const runs = [];
  for (const g of games) {
    const last = runs.at(-1);
    if (g.deck_hash && last?.[0].deck_hash === g.deck_hash) last.push(g);
    else runs.push([g]);
  }
  const stories = [];
  for (let i = 1; i < runs.length; i++) {
    const before = runs[i - 1],
      after = runs[i];
    if (
      before.length < 2 ||
      after.length < 2 ||
      after[0].battle_time < since ||
      before.at(-1).battle_time.getTime() >= after[0].battle_time.getTime()
    )
      continue;
    const story = variant(before.at(-1), after[0], names);
    if (!story) continue;
    const win = after.find((g) => g.outcome === "win" && g.promotion);
    if (win) {
      story.text +=
        win.promotion === "ranked_promotion"
          ? " Won promotion in Ranked with the new deck."
          : " Reached a new Trophy Road arena with the new deck.";
      story.battle_id = win.battle_id;
    }
    stories.push(story);
  }
  return stories;
}

export async function playerPlay(db, tag, now) {
  const args = [tag, new Date(now)];
  const [
    {
      rows: [{ progress, changes, donation }],
    },
    { rows: games },
  ] = await Promise.all([
    db.query(
      `with readings as (
      select m.mode,p.progress_key,p.best_trophies,p.observed_at,p.arena_id,p.trophies,
        lag(p.best_trophies) over history as prior, lag(p.arena_id) over history as prior_arena,
        lag(p.trophies) over history as prior_trophies
      from player_progress_daily p join mode_season m using(progress_key)
      where p.player_tag=$1 and p.snapshot_kind='daily' and m.mode in ('AutoChess','2v2League','seasonal-trophy-road')
        and p.observed_at between $2::timestamptz-interval '14 days' and $2
      window history as(partition by p.progress_key order by p.day)),
    progress as(select distinct on(r.mode) r.*,a.name as arena,o.name as old_arena from readings r
      left join arena a on a.arena_id=r.arena_id left join arena o on o.arena_id=r.prior_arena
      where r.best_trophies>r.prior and r.prior>0
        and r.observed_at >= $2::timestamptz-interval '7 days' order by r.mode,r.observed_at desc,r.progress_key),
    changes as(select e.event_type,e.badge_name,e.step,e.card_id,e.window_end,e.mode_group,
       case when e.event_type='deck_switched' then jsonb_build_object('card_ids',a.card_ids,'card_forms',a.card_forms,'tower_troop_id',a.tower_troop_id) end as next_deck,
       case when e.event_type='deck_switched' then jsonb_build_object('card_ids',z.card_ids,'card_forms',z.card_forms,'tower_troop_id',z.tower_troop_id) end as old_deck
       from player_event e left join deck a on a.deck_hash=e.deck_hash left join deck z on z.deck_hash=e.prior_deck_hash
      where player_tag=$1 and window_end between $2::timestamptz-interval '7 days' and $2
        and (event_type in ('card_maxed','deck_switched') or (event_type='badge_earned' and step is not null and badge_name like 'Mastery%'))
      order by window_end desc,event_id desc limit 40),
    giving as(select profile_observed_at as observed_at,total_donations,lag(total_donations) over(order by snapshot_date) as prior
      from player_snapshot_daily where player_tag=$1 and snapshot_kind='daily' and total_donations is not null
        and profile_observed_at between $2::timestamptz-interval '14 days' and $2),
    donation as(select observed_at,(total_donations / 1000)*1000 as milestone from giving where prior>=0
      and total_donations/1000>prior/1000 and observed_at >= $2::timestamptz-interval '7 days'
      order by observed_at desc limit 1)
    select coalesce((select jsonb_agg(progress) from progress),'[]') as progress,
      coalesce((select jsonb_agg(changes order by window_end desc) from changes),'[]') as changes,
      (select to_jsonb(donation) from donation) as donation`,
      args,
    ),
    db.query(
      `select g.*,d.card_ids,d.card_forms,d.tower_troop_id,
        (select e.event_type from player_event e where e.player_tag=$1 and e.battle_id=g.battle_id
           and e.timing='exact' and ((g.type='pathOfLegend' and e.event_type='ranked_promotion')
           or (g.type='PvP' and e.event_type='arena_changed' and e.floor is not null))
           order by e.event_id limit 1) as promotion
      from (values ('PvP'),('pathOfLegend')) mode(type) cross join lateral (
        select bp.type,bp.battle_time,bp.battle_id,bp.outcome,
          case when b.deck_selection='collection' and cardinality(bp.cards)=8 then bp.deck_hash end as deck_hash
        from battle_participant bp join battle b using(battle_id)
        where bp.player_tag=$1 and bp.type=mode.type and b.event_tag is null
          and bp.battle_time between $2::timestamptz-interval '14 days' and $2
        order by bp.battle_time desc,bp.battle_id desc limit 30) g
      left join deck d using(deck_hash) order by g.battle_time,g.battle_id`,
      args,
    ),
  ]);
  const stories = progress.map((p) => {
    let text = `${modes[p.mode]} season best rose from ${p.prior} to ${p.best_trophies} trophies.`;
    if (
      p.arena &&
      p.old_arena &&
      p.arena !== p.old_arena &&
      p.prior_trophies > 0 &&
      p.trophies > p.prior_trophies
    )
      text += ` Moved from ${p.old_arena} to ${p.arena}.`;
    return { at: p.observed_at, text };
  });
  if (donation)
    stories.push({
      at: donation.observed_at,
      text: `Reached ${Number(donation.milestone).toLocaleString("en-US")} lifetime donations.`,
    });
  const ids = [
    ...new Set([
      ...games.flatMap((g) => g.card_ids ?? []),
      ...changes.flatMap((e) => [
        ...(e.old_deck?.card_ids ?? []),
        ...(e.next_deck?.card_ids ?? []),
      ]),
    ]),
  ];
  const { rows: cards } = ids.length
    ? await db.query(
        `select c.card_id,c.name,pc.level from card c left join player_card pc on pc.card_id=c.card_id and pc.player_tag=$1 where c.card_id=any($2::int[])`,
        [tag, ids],
      )
    : { rows: [] };
  const names = new Map(cards.map((c) => [c.card_id, c.name]));
  const maxed = new Set(
    cards.filter((c) => c.level === MAX_DISPLAY_LEVEL).map((c) => c.card_id),
  );
  for (const e of changes.filter((e) => e.event_type === "deck_switched")) {
    const type = { ladder: "PvP", ranked: "pathOfLegend" }[e.mode_group];
    if (!type) continue;
    const story = variant(
      e.old_deck,
      { ...e.next_deck, type, battle_time: e.window_end },
      names,
    );
    if (story) stories.push(story);
  }
  const since = new Date(Number(new Date(now)) - 7 * 86400000);
  for (const type of ["PvP", "pathOfLegend"]) {
    const all = games.filter((g) => g.type === type);
    stories.push(...repeatedChanges(all, names, since));
    const known = all.filter(validDeck);
    const counts = new Map();
    for (const g of known)
      counts.set(g.deck_hash, (counts.get(g.deck_hash) ?? 0) + 1);
    const top = Math.max(2, ...counts.values());
    for (const e of changes) {
      let text;
      if (e.event_type === "badge_earned") {
        const name = masteryCard(e.badge_name);
        const count = known.filter((g) =>
          g.card_ids.some((id) => names.get(id) === name),
        ).length;
        if (count >= 2)
          text = `${name} reached Mastery level ${e.step}. It appeared in ${count} of ${known.length} recent recorded ${modes[type]} battles with known decks.`;
      } else if (
        e.event_type === "card_maxed" &&
        names.has(e.card_id) &&
        known.some(
          (g) =>
            counts.get(g.deck_hash) === top &&
            g.card_ids.includes(e.card_id) &&
            g.card_ids.every((id) => maxed.has(id)),
        )
      ) {
        text = `${names.get(e.card_id)} reached level ${MAX_DISPLAY_LEVEL}. All eight cards are now maxed in one of the most-played ${modes[type]} decks in this sample.`;
      }
      if (text) stories.push({ at: e.window_end, text });
    }
  }
  const seen = new Set();
  const latest = stories
    .sort(
      (a, b) => new Date(b.at) - new Date(a.at) || a.text.localeCompare(b.text),
    )
    .filter((s) => !seen.has(s.text) && seen.add(s.text))
    .slice(0, 5);
  const links = await battleLinks(
    db,
    latest.map((s) => s.battle_id),
  );
  return latest.map(({ battle_id, ...story }) =>
    battle_id ? { ...story, url: links.get(battle_id)?.url } : story,
  );
}
