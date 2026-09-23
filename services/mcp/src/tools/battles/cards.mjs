import { formName } from "@elixir-mcp/contracts";
import {
  DISPLAY_NAME_SCHEMA,
  MODE_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  SEASON_ARG_SCHEMA,
  TAG_SCHEMA,
  WINDOW_ARGS,
  appliedBlock,
  buildMeta,
  notes,
  resolveSeasonWindow,
  subject,
} from "../shared.mjs";
import { countByMode, modeGaps, pooledModesNote } from "../../controls.mjs";
import { CONTROLS_DOCS, FORM_ROWS_NOTE, modeClause } from "./common.mjs";

export const battles_cards = {
  description:
    'Per-card win/loss attribution over recorded battles. perspective "mine": which of your cards carry. perspective "opponent": which enemy cards beat you (the nemesis question). Each row carries its battles per mode group and mean_level_gap; modes_in_window and comparable say whether modes with different matchmaking were pooled (pass mode to isolate one). Duels are excluded (no single deck).',
  inputSchema: {
    type: "object",
    properties: {
      player_tag: TAG_SCHEMA,
      on_behalf_of: ON_BEHALF_OF_SCHEMA,
      display_name: DISPLAY_NAME_SCHEMA,
      perspective: {
        type: "string",
        enum: ["mine", "opponent"],
        default: "mine",
      },
      ...WINDOW_ARGS,
      season: SEASON_ARG_SCHEMA,
      mode: MODE_SCHEMA,
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const tag = (
      await subject(
        ctx.db,
        ctx.account,
        args.player_tag,
        "summary",
        args.on_behalf_of,
        args.display_name,
      )
    ).tag;
    const win = await resolveSeasonWindow(ctx, args, {
      seasonDefault: false,
    });
    const mine = args.perspective !== "opponent";
    const where = ["bp.player_tag = $1", `bp.outcome in ('win','loss')`];
    const params = [tag];
    const add = (clause, value) => {
      if (!clause.includes("?")) return where.push(clause);
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };
    if (win.from) add("bp.battle_time >= ?", win.from);
    if (win.to) add("bp.battle_time < ?", win.to);
    modeClause(args, add);

    // Cards as rows (0091): mine are this participant's played cards;
    // the opponent's are one opposing participant's (the first by tag,
    // as the JSON path took the first with a deck). round 0, slot > 0:
    // the deck's cards array, no duel rounds, no tower troop.
    const cardSource = mine
      ? `join battle_participant_card pc
             on pc.battle_id = bp.battle_id and pc.player_tag = bp.player_tag`
      : `join lateral (select o.player_tag from battle_participant o
                         where o.battle_id = bp.battle_id and o.side <> bp.side
                           and o.deck_hash is not null
                         order by o.player_tag limit 1) opp on true
           join battle_participant_card pc
             on pc.battle_id = bp.battle_id and pc.player_tag = opp.player_tag`;
    // The control beside each row (feedback #54, 3.13.0): the mean
    // level gap over the battles the card appeared in, and the row's
    // battles by mode group, so a card met mostly in war games does not
    // read as a ladder nemesis.
    const levelSource = `left join lateral (
           select avg(o.deck_avg_level) as lvl from battle_participant o
           where o.battle_id = bp.battle_id and o.side <> bp.side
             and bp.deck_avg_level is not null) lv on true`;
    const { rows } = await ctx.db.query(
      `select c.name, pc.card_id as id, pc.form as evolution,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses,
                round(avg(bp.deck_avg_level - lv.lvl)::numeric, 2) as mean_level_gap,
                array_agg(b.type) as types
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         ${cardSource}
         ${levelSource}
         join card c on c.card_id = pc.card_id
         where ${where.join(" and ")} and pc.round = 0 and pc.slot > 0
         group by 1, 2, 3
         having count(*) >= 3
         order by count(*) desc
         limit 120`,
      params,
    );
    // The window's own split, for the pooled note: battles and mean
    // level gap per mode group over every battle the rows were drawn
    // from (duels excluded as the rows are).
    const { rows: groups } = await ctx.db.query(
      `select b.type, count(*)::int as battles, count(lv.lvl)::int as level_battles,
                round(avg(bp.deck_avg_level - lv.lvl)::numeric, 2) as mean_level_gap
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         ${levelSource}
         where ${where.join(" and ")} and bp.deck_hash is not null
         group by b.type`,
      params,
    );
    const pooledGroups = modeGaps(groups);
    const guard = args.mode ? null : pooledModesNote(pooledGroups);
    return {
      player_tag: tag,
      applied: appliedBlock({
        window: win.echo,
        perspective: mine ? "mine" : "opponent",
        mode: args.mode,
        min_battles: 3,
      }),
      modes_in_window: Object.fromEntries(
        pooledGroups.map((g) => [
          g.mode,
          { battles: g.battles, mean_level_gap: g.mean_level_gap },
        ]),
      ),
      comparable: guard === null,
      cards: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        form: formName(r.evolution),
        battles: r.wins + r.losses,
        wins: r.wins,
        losses: r.losses,
        win_rate: Number((r.wins / (r.wins + r.losses)).toFixed(3)),
        modes: countByMode(r.types),
        mean_level_gap:
          r.mean_level_gap === null ? null : Number(r.mean_level_gap),
      })),
      notes: notes(
        guard,
        win.seasonNotes,
        mine
          ? "win_rate is YOUR record when this card is in your deck."
          : "win_rate is YOUR record when this card appears in the OPPONENT deck; low means nemesis.",
        "Each row's modes counts its battles by mode group and mean_level_gap is your deck's average level minus the opposing side's in those battles; a row's record is comparable to another's only at similar values of both.",
        FORM_ROWS_NOTE,
      ),
      docs: CONTROLS_DOCS,
      meta: await buildMeta(ctx.db, ctx.account, tag, ["player_battlelog"], {
        timezone: win.timezone,
        windowTo: win.to,
      }),
    };
  },
};
