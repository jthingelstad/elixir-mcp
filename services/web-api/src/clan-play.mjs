import { currentClanPlayersSql } from "@elixir-mcp/claims";

// One indexed player/time range per current roster member. Keep a bounded
// sample from actual bring-your-own-deck play in the two permanent modes.
export async function clanPlay(db, accountId) {
  const { rows } = await db.query(
    `with roster as materialized (${currentClanPlayersSql("$1")}),
    samples as materialized (
      select r.player_tag,r.name,r.clan_tag, exists(select 1 from claim c
          where c.account_id=$1 and c.player_tag=r.player_tag and c.status='verified'
            and (c.is_primary or c.relationship in ('primary','alt'))) as own, games.*
      from roster r cross join lateral (
        select recent.deck_hash,recent.type from (
          select bp.battle_id,bp.deck_hash,bp.type from battle_participant bp
          where bp.player_tag=r.player_tag and bp.battle_time between now()-interval '14 days' and now()
            and bp.type in ('PvP','pathOfLegend') and bp.clan_tag=r.clan_tag and bp.deck_hash is not null
          order by bp.battle_time desc,bp.battle_id limit 30
        ) recent join battle b using(battle_id)
        where b.deck_selection='collection' and b.event_tag is null
      ) games),
    counts as materialized (select player_tag,name,clan_tag,own,type,deck_hash,count(*)::int as plays
      from samples group by player_tag,name,clan_tag,own,type,deck_hash),
    identities as materialized (
      select d.deck_hash,d.card_ids,array_agg(c.name order by i.pos) as card_names
      from (select distinct deck_hash from counts) used join deck d using(deck_hash)
      cross join lateral unnest(d.card_ids) with ordinality i(id,pos)
      join card c on c.card_id=i.id where cardinality(d.card_ids)=8
      group by d.deck_hash,d.card_ids)
    select s.*,d.card_ids,d.card_names from counts s join identities d using(deck_hash)
    order by s.player_tag,s.type,s.plays desc,s.deck_hash`,
    [accountId],
  );
  return compareClanPlay(rows);
}

export function compareClanPlay(rows) {
  const players = new Map();
  for (const row of rows) {
    if (
      new Set(row.card_ids).size !== 8 ||
      row.card_ids.some((id) => id == null) ||
      row.card_names.length !== 8
    )
      continue;
    const key = [row.player_tag, row.clan_tag, row.type].join("/");
    const p = players.get(key) ?? {
      ...row,
      decks: [],
      cards: new Map(),
      total: 0,
    };
    p.decks.push(row);
    p.total += row.plays;
    row.card_ids.forEach((id, i) => {
      const card = p.cards.get(id) ?? { name: row.card_names[i], plays: 0 };
      card.plays += row.plays;
      p.cards.set(id, card);
    });
    players.set(key, p);
  }
  const own = [...players.values()].filter((p) => p.own);
  const result = new Map();
  for (const mate of players.values()) {
    if (mate.own) continue;
    for (const me of own) {
      if (me.clan_tag !== mate.clan_tag || me.type !== mate.type) continue;
      const mode = me.type === "PvP" ? "Trophy Road" : "Ranked";
      const common = [...me.cards.entries()]
        .filter(([id]) => mate.cards.has(id))
        .map(([id, c]) => ({
          name: c.name,
          mine: c.plays,
          theirs: mate.cards.get(id).plays,
        }))
        .sort(
          (a, b) =>
            Math.min(b.mine, b.theirs) - Math.min(a.mine, a.theirs) ||
            a.name.localeCompare(b.name),
        );
      const often = common.find(
        (c) =>
          c.mine >= 3 &&
          c.theirs >= 3 &&
          c.mine * 2 >= me.total &&
          c.theirs * 2 >= mate.total,
      );
      const candidate = {
        own_name: me.name ?? me.player_tag,
        mode,
        shared: 0,
        exact: false,
        card: often
          ? { ...often, mine_total: me.total, theirs_total: mate.total }
          : null,
      };
      for (const a of me.decks.filter((d) => d.plays >= 2)) {
        for (const b of mate.decks.filter((d) => d.plays >= 2)) {
          const shared = a.card_ids.filter((id) =>
            b.card_ids.includes(id),
          ).length;
          const exact = a.deck_hash === b.deck_hash;
          if (
            shared >= 6 &&
            (shared > candidate.shared ||
              (shared === candidate.shared && exact && !candidate.exact))
          ) {
            candidate.shared = shared;
            candidate.exact = exact;
            candidate.own_cards = a.card_names.filter(
              (_, i) => !b.card_ids.includes(a.card_ids[i]),
            );
            candidate.peer_cards = b.card_names.filter(
              (_, i) => !a.card_ids.includes(b.card_ids[i]),
            );
          }
        }
      }
      if (!candidate.shared && !often) continue;
      const prior = result.get(mate.player_tag);
      if (
        !prior ||
        candidate.shared > prior.shared ||
        (candidate.shared === prior.shared && candidate.exact && !prior.exact)
      )
        result.set(mate.player_tag, candidate);
    }
  }
  return result;
}
