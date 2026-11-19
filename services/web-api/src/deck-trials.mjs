import { parseDeckLink } from "@elixir-mcp/contracts";
import { readVisiblePost, memberPostPath } from "@elixir-mcp/posts";
import { battleLinks } from "@elixir-mcp/record/battle-links";
import { subjectsFor } from "@elixir-mcp/tools/activity/entries";

/** A member initiates the comparison on a visible post. Only their own
 * verified player can provide the battle. Copy-deck links carry card IDs
 * and optionally a tower troop, so they cannot attest to card forms. */
export async function deckTrial(db, accountId, postId, plain, battleId = null) {
  if (battleId !== null && !/^[a-f0-9]{64}$/.test(battleId)) return null;
  const item = await readVisiblePost(db, accountId, postId, {
    subjects: await subjectsFor(db, accountId),
    plain,
    visibleOnly: true,
    open: true,
  });
  const deck = parseDeckLink(item?.post.deck?.copy_link);
  if (!deck || item.post.mine) return null;
  const {
    rows: [battle],
  } = await db.query(
    `select bp.battle_id,bp.player_tag,p.name
    from claim own join battle_participant bp using(player_tag)
    join battle b using(battle_id) join player p using(player_tag)
    where own.account_id=$1 and own.status='verified' and (own.is_primary or own.relationship in ('primary','alt'))
      and bp.battle_time >= greatest($2::timestamptz,now()-interval '30 days') and bp.battle_time<=now()
      and b.deck_selection='collection' and bp.type<>'boatBattle' and b.boat_battle_side is null
      and cardinality(bp.cards)=8 and bp.cards @> $3::int[]
      and ($4::int is null or bp.tower_troop_id=$4)
      and ($5::text is null or bp.battle_id=$5)
    order by bp.battle_time desc,bp.battle_id,bp.player_tag limit 1`,
    [accountId, item.at, deck.cards, deck.tower_troop, battleId],
  );
  if (!battle) return { match: null };
  const links = await battleLinks(db, [battle.battle_id]);
  return {
    match: {
      battle_id: battle.battle_id,
      source: {
        path: memberPostPath(postId),
        name: item.post.author.name ?? item.post.author.player_tag,
      },
      player_tag: battle.player_tag,
      name: battle.name,
      url: links.get(battle.battle_id).url,
    },
  };
}
