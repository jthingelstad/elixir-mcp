/** players_summary · players_profile · players_timeline · players_collection · players_search — moved verbatim from the
 *  single-file registry (review item 8). */

import { displayCard, responseMeta } from "@elixir-mcp/contracts";
import {
  requireEnum,
  ToolFailure,
  spendLiveQuota,
  TAG_SCHEMA,
  subject,
  buildMeta,
} from "./shared.mjs";

export const playersTools = {
  players_summary: {
    description:
      "The headline in one call: current trophies and clan, last-30-days record and win rate, and the most-played deck with its record. Start here for \u201chow am I doing?\u201d; drill in with battles_performance / battles_decks.",
    inputSchema: {
      type: "object",
      properties: { player_tag: TAG_SCHEMA },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(ctx.db, ctx.account, args.player_tag, "summary")
      ).tag;
      const [snap, record, deck, best] = await Promise.all([
        ctx.db.query(
          `select p.name, p.last_known_clan_tag, cl.name as clan_name,
                  s.trophies, s.snapshot_date, nn.nickname
           from player p
           left join clan cl on cl.clan_tag = p.last_known_clan_tag
           left join player_nickname nn on nn.account_id = $2
             and nn.player_tag = p.player_tag
           left join lateral (
             select trophies, snapshot_date from player_snapshot_daily
             where player_tag = p.player_tag
             order by snapshot_date desc, snapshot_kind desc limit 1
           ) s on true
           where p.player_tag = $1`,
          [tag, ctx.account.accountId],
        ),
        ctx.db.query(
          `select count(*)::int as battles,
                  count(*) filter (where outcome = 'win')::int as wins,
                  count(*) filter (where outcome = 'loss')::int as losses,
                  count(*) filter (where outcome = 'draw')::int as draws,
                  coalesce(sum(trophy_change), 0)::int as net_trophies,
                  min(battle_time) as first_recorded
           from battle_participant
           where player_tag = $1 and battle_time > now() - interval '30 days'`,
          [tag],
        ),
        ctx.db.query(
          `select bp.deck_hash, count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  (array_agg(bp.deck order by bp.battle_time desc))[1] as deck
           from battle_participant bp
           where bp.player_tag = $1 and bp.deck_hash is not null
             and bp.battle_time > now() - interval '30 days'
           group by bp.deck_hash order by count(*) desc limit 2`,
          [tag],
        ),
        ctx.db.query(
          `select bp.deck_hash, count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  (array_agg(bp.deck order by bp.battle_time desc))[1] as deck
           from battle_participant bp
           where bp.player_tag = $1 and bp.deck_hash is not null
             and bp.battle_time > now() - interval '30 days'
           group by bp.deck_hash
           having count(*) >= 10 and count(*) filter (where bp.outcome in ('win','loss')) > 0
           order by (count(*) filter (where bp.outcome = 'win'))::numeric
                    / greatest(count(*) filter (where bp.outcome in ('win','loss')), 1) desc
           limit 1`,
          [tag],
        ),
      ]);
      const p0 = snap.rows[0];
      if (!p0)
        throw new ToolFailure(
          "not_recorded",
          `${tag} is not in the record yet.`,
        );
      const r = record.rows[0];
      const d = deck.rows[0];
      const b = best.rows[0];
      const deckShape = (row) =>
        row
          ? {
              deck_hash: row.deck_hash,
              cards: (row.deck?.cards ?? []).map((c) => ({
                id: c.id,
                name: c.name,
              })),
              battles: row.battles,
              win_rate:
                row.wins + row.losses > 0
                  ? Number((row.wins / (row.wins + row.losses)).toFixed(3))
                  : null,
            }
          : null;
      return {
        player_tag: tag,
        name: p0.name,
        ...(p0.nickname ? { nickname: p0.nickname } : {}),
        clan: p0.last_known_clan_tag
          ? { clan_tag: p0.last_known_clan_tag, name: p0.clan_name }
          : null,
        trophies: p0.trophies,
        trophies_as_of: p0.snapshot_date
          ? p0.snapshot_date.toISOString().slice(0, 10)
          : null,
        last_30_days: {
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
          net_trophies: r.net_trophies,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          first_recorded: r.first_recorded?.toISOString() ?? null,
        },
        top_deck: deckShape(d),
        // most-played is often NOT the best-performing deck - both
        // headlines matter (round-3 casual finding).
        best_deck: b && b.deck_hash !== d?.deck_hash ? deckShape(b) : null,
        note: "counts include ALL recorded battles (war modes carry no trophies); win_rate = wins/(wins+losses), draws excluded. best_deck needs 10+ battles in the window and is omitted when it IS the top deck. History may predate active recording - elixir_coverage has the full capture story.",
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },

  players_profile: {
    description:
      "Latest recorded profile snapshot for a tag: trophies, Path of Legends, league stats, donations, lifetime counters, collection level, clan. as-of the last profile poll.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        live: {
          type: "boolean",
          description:
            "Fetch fresh from the CR API via the live lane (quota-limited).",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(ctx.db, ctx.account, args.player_tag, "summary")
      ).tag;
      if (args.live === true) {
        if (!ctx.live) {
          throw new ToolFailure(
            "live_unavailable",
            "The live lane is not configured here.",
            "Call again without live: true.",
          );
        }
        await spendLiveQuota(ctx);
        // Fetch through the lane; the projector updates the snapshot the
        // moment it's admitted, so the normal read below serves it fresh.
        const result = await ctx.live(ctx.db, {
          endpoint: "player",
          entityKey: tag,
        });
        if (!result.ok) {
          throw new ToolFailure(
            "live_unavailable",
            "No gateway completed the live fetch in time.",
            "Serving recorded data: call again without live: true.",
          );
        }
      }
      const { rows } = await ctx.db.query(
        `select p.player_tag, p.name, p.last_known_clan_tag, cl.name as clan_name,
                s.snapshot_date, s.snapshot_kind, s.trophies, s.pol, s.league_stats,
                s.donations, s.donations_received, s.lifetime, s.created_at as snapshot_at
         from player p
         left join clan cl on cl.clan_tag = p.last_known_clan_tag
         left join lateral (
           select * from player_snapshot_daily where player_tag = p.player_tag
           order by snapshot_date desc, snapshot_kind desc limit 1
         ) s on true
         where p.player_tag = $1`,
        [tag],
      );
      const row = rows[0];
      if (!row)
        throw new ToolFailure(
          "not_recorded",
          `${tag} is not in the record yet.`,
        );
      if (!row.snapshot_date) {
        throw new ToolFailure(
          "not_recorded",
          `${tag} is known but has no profile snapshot yet.`,
          "Recording may have just started; try elixir_coverage.",
        );
      }
      return {
        player_tag: row.player_tag,
        name: row.name,
        clan: row.last_known_clan_tag
          ? { clan_tag: row.last_known_clan_tag, name: row.clan_name }
          : null,
        snapshot: {
          date: row.snapshot_date.toISOString().slice(0, 10),
          trophies: row.trophies,
          path_of_legend: row.pol,
          league_statistics: row.league_stats,
          donations_this_week: row.donations,
          donations_received_this_week: row.donations_received,
          lifetime: row.lifetime,
        },
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },

  players_timeline: {
    description:
      "Time series from daily snapshots: trophies, donations (weekly counter — resets Mondays), battle_count, collection_level. The trophy-graph tool. Granularity week returns the last snapshot of each ISO week.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        metrics: {
          type: "array",
          items: {
            type: "string",
            enum: ["trophies", "donations", "battle_count", "collection_level"],
          },
          default: ["trophies"],
        },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
        granularity: { type: "string", enum: ["day", "week"], default: "day" },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(ctx.db, ctx.account, args.player_tag, "summary")
      ).tag;
      for (const d of ["from", "to"]) {
        if (args[d] !== undefined && Number.isNaN(Date.parse(args[d]))) {
          throw new ToolFailure(
            "bad_request",
            `Unparseable ${d}: ${args[d]}`,
            "Dates are YYYY-MM-DD.",
          );
        }
      }
      requireEnum(args.granularity, ["day", "week"], "granularity");
      for (const metric of args.metrics ?? []) {
        requireEnum(
          metric,
          ["trophies", "donations", "battle_count", "collection_level"],
          "metric",
        );
      }
      const metrics =
        Array.isArray(args.metrics) && args.metrics.length > 0
          ? args.metrics
          : ["trophies"];
      const where = [`player_tag = $1`, `snapshot_kind = 'daily'`];
      const params = [tag];
      if (args.from && args.to && args.from > args.to) {
        throw new ToolFailure(
          "bad_request",
          "from is after to — the window is inverted.",
          "Swap the bounds; from must be the earlier date.",
        );
      }
      if (args.from) {
        params.push(args.from);
        where.push(`snapshot_date >= $${params.length}::date`);
      }
      if (args.to) {
        params.push(args.to);
        where.push(`snapshot_date <= $${params.length}::date`);
      }
      // Epoch disclosure (data-honesty finding): snapshots start later
      // than battles; never let a truncated series read as smooth history.
      const { rows: epoch } = await ctx.db.query(
        `select min(snapshot_date)::text as first from player_snapshot_daily
         where player_tag = $1 and snapshot_kind = 'daily'`,
        [tag],
      );
      const snapshotsFrom = epoch[0]?.first ?? null;
      // Week granularity: Postgres owns ISO-week truth (the hand-rolled
      // formula this replaced drifted near year boundaries), and each
      // point carries its iso_week so near-adjacent dates (a Saturday
      // then the next Monday) self-explain — pilot-tester feedback.
      const weekly = args.granularity === "week";
      const { rows } = await ctx.db.query(
        weekly
          ? `select distinct on (date_trunc('week', snapshot_date))
               snapshot_date, to_char(snapshot_date, 'IYYY-"W"IW') as iso_week,
               trophies, donations,
               (lifetime->>'battleCount')::int as battle_count,
               (lifetime->>'collectionLevel')::int as collection_level
             from player_snapshot_daily where ${where.join(" and ")}
             order by date_trunc('week', snapshot_date), snapshot_date desc`
          : `select snapshot_date, trophies, donations,
                (lifetime->>'battleCount')::int as battle_count,
                (lifetime->>'collectionLevel')::int as collection_level
             from player_snapshot_daily where ${where.join(" and ")}
             order by snapshot_date`,
        params,
      );
      const points = weekly
        ? rows.sort((a, z) => a.snapshot_date - z.snapshot_date)
        : rows;
      return {
        player_tag: tag,
        granularity: weekly ? "week" : "day",
        snapshots_available_from: snapshotsFrom,
        ...(snapshotsFrom && args.from && args.from < snapshotsFrom
          ? {
              range_note: `Requested from ${args.from}, but daily snapshots begin ${snapshotsFrom}; earlier dates have battles (see elixir_coverage) but no snapshots.`,
            }
          : {}),
        series: points.map((r) => ({
          date: r.snapshot_date.toISOString().slice(0, 10),
          ...(weekly ? { iso_week: r.iso_week } : {}),
          ...Object.fromEntries(metrics.map((m) => [m, r[m]])),
        })),
        note: metrics.includes("donations")
          ? "donations is the weekly counter as-of each snapshot; it resets Mondays ~00:10 UTC."
          : undefined,
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },

  players_collection: {
    description:
      "Full card collection as last recorded: levels (in-game 1-16 scale), counts, evolutions, star levels, collection level. In THIS tool evolutionLevel/maxEvolutionLevel are evolution progress owned (unlike battle decks, where evolutionLevel is the form played); starLevel is cosmetic. API-shaped passthrough of the latest profile payload.",
    inputSchema: {
      type: "object",
      properties: { player_tag: TAG_SCHEMA },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(ctx.db, ctx.account, args.player_tag, "summary")
      ).tag;
      const { rows } = await ctx.db.query(
        `select p.payload_json->'cards' as cards,
                p.payload_json->'currentDeckSupportCards' as support_cards,
                (p.payload_json->>'collectionLevel')::int as collection_level,
                p.last_fetched_at
         from api_payload p
         where p.endpoint = 'player' and p.entity_key = $1
         order by p.last_fetched_at desc limit 1`,
        [tag],
      );
      const row = rows[0];
      if (!row) {
        throw new ToolFailure(
          "not_recorded",
          `No profile payload recorded for ${tag} yet.`,
          "Recording may have just started; the collection arrives with the first profile poll.",
        );
      }
      return {
        player_tag: tag,
        collection_level: row.collection_level,
        // Levels on the in-game display scale (contracts displayCard).
        cards: (row.cards ?? []).map(displayCard),
        support_cards: (row.support_cards ?? []).map(displayCard),
        as_of_payload: row.last_fetched_at.toISOString(),
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },

  players_search: {
    description:
      'Name-to-tag resolution across the whole recorded corpus (universal reads): case-insensitive substring on last-observed display names AND your private nicknames (elixir_nickname) - "tyler" finds the player you call Tyler, ranked first (source: nickname | claim | clanmate | corpus). Unknown names return an honest empty list, never a guess.',
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 50 },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const q = String(args.query ?? "").trim();
      if (!q) throw new ToolFailure("bad_request", "query is empty.");
      const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 20);
      // Universal reads: the whole recorded corpus is searchable. Your
      // own players and clanmates rank first so ambiguous names resolve
      // to the people you mean.
      const { rows } = await ctx.db.query(
        `with hits as (
           select p.player_tag, p.name, nn.nickname,
                  case
                    when nn.nickname ilike $2 then 'nickname'
                    when exists (select 1 from claim c
                                 where c.account_id = $1 and c.player_tag = p.player_tag)
                      then 'claim'
                    when exists (select 1 from claim c
                                 join clan_membership cm on cm.player_tag = c.player_tag
                                   and cm.left_observed_at is null
                                 join clan_membership cm2 on cm2.clan_tag = cm.clan_tag
                                   and cm2.left_observed_at is null
                                 where c.account_id = $1 and cm2.player_tag = p.player_tag)
                      then 'clanmate'
                    else 'corpus'
                  end as source
           from player p
           left join player_nickname nn on nn.account_id = $1
             and nn.player_tag = p.player_tag
           where p.name ilike $2 or nn.nickname ilike $2)
         select h.player_tag, h.name, h.nickname, h.source,
                (select cm.clan_tag from clan_membership cm
                 where cm.player_tag = h.player_tag and cm.left_observed_at is null
                 limit 1) as clan_tag
         from hits h
         order by case h.source when 'nickname' then -1 when 'claim' then 0 when 'clanmate' then 1 else 2 end,
                  h.name
         limit $3`,
        [ctx.account.accountId, `%${q}%`, limit],
      );
      return {
        query: q,
        matches: rows,
        note:
          rows.length === 0
            ? "No recorded player matches that name. Names change; tags are permanent - and only players the service has observed are findable."
            : "Search covers every recorded player (universal reads); your own players and clanmates rank first (source: claim | clanmate | corpus). Names are as last observed.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
