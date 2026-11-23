/** Battle-backed post facts, shared by the member reader and Timeline.
 * Audience belongs to the caller; these reads preserve the existing visible
 * and author-held post rules without depending on the tool registry.
 */
import { postReaderAllowsSql } from "./visibility.mjs";
import { formName, modeGroupOf } from "@elixir-mcp/contracts";
import { battleLinks } from "@elixir-mcp/record/battle-links";

const iso = (value) => (value ? new Date(value).toISOString() : null);

/** A deck as the highlight read aggregated it, in the website's shape:
 *  the stamped archetype label (none when unclassified or unstamped) and
 *  the cards with their costs. Null with no cards. */
function versusSide(d) {
  const cards = (d?.cards ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    form: formName(c.form),
    rarity: c.rarity ?? null,
    elixir_cost: c.elixir_cost ?? null,
  }));
  return cards.length ? { label: d.label ?? null, cards } : null;
}
/** One deck as jsonb for a battle post's two decks, inside its one
 *  statement: its stamped label (0148) unless unclassified, and its
 *  cards with their catalog costs. */
export const VERSUS_DECK_SQL = (hash) => `(select jsonb_build_object(
          'label', case when d.archetype_family <> 'unclassified'
                        then d.archetype_label end,
          'cards', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', dc.card_id, 'form', dc.form, 'name', c.name,
                       'rarity', c.rarity, 'elixir_cost', c.elixir_cost)
                     order by dc.card_id, dc.form), '[]'::jsonb)
                      from unnest(d.card_ids, d.card_forms) as dc(card_id, form)
                      join card c on c.card_id = dc.card_id))
         from deck d where d.deck_hash = ${hash})`;

/** The battle posts `where` names (its parameters from $2; $1 the reader's
 *  account or null), with what their item needs: the
 *  battle from the post's player's side, its opponents and both decks.
 *  Visible posts only, unless `held` (a post hidden for review, which its
 *  author still sees on the web). */
export async function battlePostRows(
  db,
  where,
  params,
  accountId,
  held = false,
) {
  const { rows } = await db.query(
    `select p.post_id::text as post_id, p.item_id, p.player_tag, p.battle_id,
            p.body as words, ts.share_id, p.created_at,
            coalesce(p.updated_at, p.created_at) as updated_at, p.revision,
            pl.name,
            (p.account_id = $1::uuid) as yours,
            b.battle_time, b.type, b.event_tag, b.game_mode_name,
            me.side, me.crowns, me.outcome, me.trophy_change,
            (select coalesce(jsonb_agg(jsonb_build_object(
                      'player_tag', o.player_tag, 'name', op.name,
                      'crowns', o.crowns,
                      'starting_trophies', o.starting_trophies)
                    order by o.player_tag), '[]'::jsonb)
               from battle_participant o
               left join player op on op.player_tag = o.player_tag
              where o.battle_id = p.battle_id and o.side <> me.side) as opponents,
            ${VERSUS_DECK_SQL("me.deck_hash")} as my_deck,
            (select ${VERSUS_DECK_SQL("o.deck_hash")}
               from battle_participant o
              where o.battle_id = p.battle_id and o.side <> me.side
              order by o.player_tag limit 1) as their_deck
       from account_post p
       left join timeline_share ts on ts.item_id = p.item_id
         and ts.created_at >= now() - interval '1 year'
       join account au on au.account_id = p.account_id
                      and au.kind = 'person' and au.status = 'approved'
       left join player pl on pl.player_tag = p.player_tag
       join battle b on b.battle_id = p.battle_id
       -- The post's player's row, by its primary key: joined plainly, the
       -- planner can read it off the player's whole battle history once
       -- per post (16,500 buffers for 40 posts over a year, 2026-11-13).
       -- The limit keeps the lateral a probe.
       cross join lateral (
         select bp.side, bp.crowns, bp.outcome, bp.trophy_change, bp.deck_hash
           from battle_participant bp
          where bp.battle_id = p.battle_id and bp.player_tag = p.player_tag
          limit 1) me
      where p.battle_id is not null
        and ${held ? "p.status <> 'removed'" : "p.status = 'visible'"}
        and ${postReaderAllowsSql("p", "$1::uuid")}
        and ${where}`,
    [accountId, ...params],
  );
  return rows;
}

/** A battle post's battle as its item carries it, and its two decks for
 *  the website (`{mine, theirs}`, theirs null unless one opponent). */
export function battleOfRow(r, links) {
  const opponents = r.opponents.map((o) => ({
    player_tag: o.player_tag,
    name: o.name ?? null,
    starting_trophies: o.starting_trophies ?? null,
  }));
  const mine = versusSide(r.my_deck);
  return {
    battle: {
      battle_id: r.battle_id,
      url: links.get(r.battle_id)?.url ?? null,
      battle_time: iso(r.battle_time),
      mode_group: modeGroupOf(r.type, r.event_tag),
      game_mode: r.game_mode_name ?? null,
      outcome: r.outcome ?? null,
      crowns: r.crowns ?? null,
      crowns_against: r.opponents.reduce(
        (m, o) =>
          typeof o.crowns === "number" ? Math.max(m ?? 0, o.crowns) : m,
        null,
      ),
      trophy_change: r.trophy_change ?? null,
      opponents,
    },
    versus: mine
      ? {
          mine,
          theirs: opponents.length === 1 ? versusSide(r.their_deck) : null,
        }
      : null,
  };
}

/**
 * The battles of these posts (their item ids), as the timeline carries
 * them, for the web API's own post items (services/web-api posts.mjs):
 * `Map<item_id, {battle, versus}>`. Who may read each post is the
 * caller's to decide (its author sees one hidden for review); this reads
 * only posts by approved people that are not removed.
 */
export async function battlePostFacts(db, itemIds) {
  if (itemIds.length === 0) return new Map();
  const rows = await battlePostRows(
    db,
    "p.item_id = any($2::text[])",
    [itemIds],
    null,
    true,
  );
  const links = await battleLinks(
    db,
    rows.map((r) => r.battle_id),
  );
  return new Map(
    rows.map((r) => {
      const facts = battleOfRow(r, links);
      if (r.event_tag) facts.battle.event_tag = r.event_tag;
      return [r.item_id, facts];
    }),
  );
}
