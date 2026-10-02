/** Factual card catalog details and the selected player/clan's recorded card history. */
import {
  responseMeta,
  modeGroupSql,
  MODE_GROUPS,
  cardForms,
  cardType,
  formName,
} from "@elixir-mcp/contracts";
import { participantModeClause } from "@elixir-mcp/record/mode-filter";
import { notBoatDefense } from "@elixir-mcp/record/boat-defense-sql";
import {
  VERBOSITY,
  MODE_SCHEMA,
  WINDOW_ARGS,
  SEASON_ARG_SCHEMA,
  SEGMENT_SCHEMA,
  appliedBlock,
  notes,
  docsRef,
  requireEnum,
  resolveSeasonWindow,
  segmentFilter,
  clanSegmentNote,
  PARTICIPANT_GAMES,
  RECORDED_PLAYERS_SQL,
  buildMeta,
} from "./shared.mjs";
import { countByModeGroup } from "../controls.mjs";
import { resolveCard } from "./card-resolver.mjs";
const rate = (w, l) => (w + l > 0 ? Number((w / (w + l)).toFixed(3)) : null);
export const cardProfileTools = {
  cards_card: {
    description:
      "One card's catalog facts and earliest recorded play in a named player or clan's history. A clan read also lists current members who played it in the requested window and who hold it, with recorded levels and forms. No corpus statistics, partners, popularity, scores or recommendations. Anchor by card_id or exact name. The window defaults to the current season; first_played spans the selected history.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "integer", description: "The card id." },
        card: {
          type: "string",
          description: "An exact catalog name, case-insensitive.",
        },
        segment: SEGMENT_SCHEMA,
        ...WINDOW_ARGS,
        season: SEASON_ARG_SCHEMA,
        mode: MODE_SCHEMA,
        verbosity: VERBOSITY("keeps card facts; drops clan member lists."),
      },
      required: ["segment"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const anchor = await resolveCard(ctx.db, args, { allowTower: true });
      requireEnum(args.mode, MODE_GROUPS, "mode");
      const win = await resolveSeasonWindow(ctx, args);
      const {
        rows: [cat],
      } = await ctx.db.query(
        `select first_seen_at from card where card_id = $1`,
        [anchor.id],
      );
      params.push(anchor.id);
      const anchorParam = `$${params.length}`;
      const { rows: firstPlayed } = await ctx.db.query(
        anchor.tower_troop
          ? `select 0 as form, min(bp.battle_time) as at from ${PARTICIPANT_GAMES} bp
           join deck d on d.deck_hash = bp.deck_hash
           where ${seg.where} and ${notBoatDefense("bp")} and d.tower_troop_id = ${anchorParam}`
          : `select c.form, min(bp.battle_time) as at from ${PARTICIPANT_GAMES} bp
           join battle b on b.battle_id = bp.battle_id
     join battle_participant_card c on c.battle_id = bp.battle_id and c.player_tag = bp.player_tag and c.round = bp.round
           where ${seg.where} and ${notBoatDefense("bp")} and c.card_id = ${anchorParam} group by c.form`,
        params,
      );
      const first = { base: null, evolution: null, hero: null };
      for (const r of firstPlayed) {
        if (!r.at) continue;
        const key = formName(r.form),
          at = r.at.toISOString();
        if (!first[key] || at < first[key]) first[key] = at;
      }
      const members =
        seg.echo.kind === "clan" && args.verbosity !== "compact"
          ? await clanMembers(ctx, {
              anchor,
              clanTag: seg.echo.clan_tag,
              win,
              args,
            })
          : null;
      return {
        applied: appliedBlock({
          segment: seg.echo,
          window: win.echo,
          mode: args.mode,
          verbosity: args.verbosity ?? "full",
        }),
        card: {
          id: anchor.id,
          name: anchor.name,
          type: cardType(anchor.id),
          rarity: anchor.rarity ?? null,
          elixir_cost: anchor.elixirCost ?? null,
          forms_available: cardForms(anchor.maxEvolutionLevel),
          icon_urls: anchor.iconUrls ?? null,
          first_seen_in_catalog: cat?.first_seen_at?.toISOString() ?? null,
          first_played: first,
        },
        ...(members ? { members } : {}),
        notes: notes(
          clanSegmentNote(seg),
          win.seasonNotes,
          "first_seen_in_catalog is when Elixir first stored this catalog row, not a release date. first_played is earliest play in the selected recorded history, by form, across all windows; unknown forms stay null.",
          members
            ? "members.played covers the current clan members' own games in the requested window; duels count by round. Its modes split names the games counted; use mode to keep different matchmaking apart. members.held is observed card inventory, not an upgrade recommendation. Missing inventory is unknown."
            : null,
        ),
        docs: docsRef("cards"),
        meta:
          seg.echo.kind === "player"
            ? await buildMeta(
                ctx.db,
                ctx.account,
                seg.echo.player_tag,
                ["player_battlelog"],
                { timezone: win.timezone, windowTo: win.to },
              )
            : responseMeta({
                as_of: new Date().toISOString(),
                ...(win.timezone ? { timezone_applied: win.timezone } : {}),
              }),
      };
    },
  },
};

async function clanMembers(ctx, { anchor, clanTag, win, args }) {
  const params = [clanTag, anchor.id, win.from.toISOString()];
  // The selected current members' own recorded games; duels count by round.
  const where = [
    notBoatDefense("bp"),
    "bp.battle_time >= $3",
    `bp.player_tag in (${RECORDED_PLAYERS_SQL})`,
  ];
  if (win.to) {
    params.push(win.to);
    where.push(`bp.battle_time < $${params.length}`);
  }
  if (args.mode) where.push(participantModeClause(args.mode, params));

  const { rows: played } = await ctx.db.query(
    `select bp.player_tag, p.name,
            count(*)::int as battles,
            count(*) filter (where bp.outcome = 'win')::int as wins,
            count(*) filter (where bp.outcome = 'loss')::int as losses,
            round(avg(c.level)::numeric, 1) as level_played,
            array_agg(distinct c.form) as forms,
            array_agg(${modeGroupSql("b.type", "b.event_tag")}) as mode_groups
     from clan_membership cm
     join ${PARTICIPANT_GAMES} bp on bp.player_tag = cm.player_tag
     join battle b on b.battle_id = bp.battle_id
     join battle_participant_card c
       on c.battle_id = bp.battle_id and c.player_tag = bp.player_tag
      and c.round = bp.round and c.card_id = $2
     join player p on p.player_tag = bp.player_tag
     where cm.clan_tag = $1 and cm.left_observed_at is null and ${where.join(" and ")}
     group by bp.player_tag, p.name
     order by battles desc`,
    params,
  );
  const { rows: held } = await ctx.db.query(
    `select cm.player_tag, p.name, pc.level, pc.evolution_level, pc.star_level,
            pc.observed_at as since,
            -- The newest read of the collection (it arrives with the
            -- profile), not when this level was first seen (Gym #283).
            greatest(
              (select s.profile_observed_at from player_snapshot_daily s
                where s.player_tag = cm.player_tag and s.profile_observed_at is not null
                order by s.snapshot_date desc, s.snapshot_kind desc limit 1),
              (select ps.last_admitted_at from poll_state ps
                where ps.subject_tag = cm.player_tag and ps.endpoint = 'player')) as observed_at,
            exists (select 1 from player_card any_pc where any_pc.player_tag = cm.player_tag) as has_collection
     from clan_membership cm
     join player p on p.player_tag = cm.player_tag
     left join player_card pc on pc.player_tag = cm.player_tag and pc.card_id = $2
     where cm.clan_tag = $1 and cm.left_observed_at is null
     order by pc.level desc nulls last, p.name`,
    [clanTag, anchor.id],
  );
  const withCollection = held.filter((h) => h.has_collection);
  return {
    played: played.map((r) => ({
      player_tag: r.player_tag,
      name: r.name,
      battles: r.battles,
      wins: r.wins,
      losses: r.losses,
      win_rate: rate(r.wins, r.losses),
      level_played: r.level_played === null ? null : Number(r.level_played),
      forms: (r.forms ?? []).map(formName).sort(),
      modes: countByModeGroup(r.mode_groups),
    })),
    held: withCollection
      .filter((h) => h.since !== null)
      .map((h) => ({
        player_tag: h.player_tag,
        name: h.name,
        level: h.level,
        forms_unlocked: cardForms(h.evolution_level),
        star_level: h.star_level ?? null,
        observed_at: (h.observed_at ?? h.since).toISOString(),
        since: h.since.toISOString(),
      })),
    members_with_collection: withCollection.length,
    members: held.length,
  };
}
