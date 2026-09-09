import { readRecordedProfile } from "../../../ingest/src/recorded-profile.mjs";
/** players_summary · players_profile · players_timeline · players_collection · players_search — moved verbatim from the
 *  single-file registry (review item 8). */

import {
  displayCard,
  cardForms,
  normalizeTag,
  responseMeta,
} from "@elixir-mcp/contracts";
import {
  WINDOW_DATE_ONLY_DESC,
  requireEnum,
  ToolFailure,
  spendLiveQuota,
  TAG_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  subject,
  buildMeta,
} from "./shared.mjs";

/** Escape LIKE/ILIKE metacharacters so user text matches literally
 *  (Postgres' default escape character is the backslash). */
function likeLiteral(text) {
  return String(text).replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const playersTools = {
  players_summary: {
    description:
      "The headline in one call: current trophies and clan, last-30-days record and win rate, and the most-played deck with its record. Start here for \u201chow am I doing?\u201d; drill in with battles_performance / battles_decks.",
    inputSchema: {
      type: "object",
      properties: { player_tag: TAG_SCHEMA, on_behalf_of: ON_BEHALF_OF_SCHEMA },
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
        )
      ).tag;
      // One client is one connection: pg queues concurrent queries on it
      // anyway, so Promise.all bought no parallelism and only tripped the
      // deprecation (docs/ENGINEERING.md: one client, one query at a time).
      const snap = await ctx.db.query(
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
      );
      const record = await ctx.db.query(
        `select count(*)::int as battles,
                  count(*) filter (where outcome = 'win')::int as wins,
                  count(*) filter (where outcome = 'loss')::int as losses,
                  count(*) filter (where outcome = 'draw')::int as draws,
                  coalesce(sum(trophy_change), 0)::int as net_trophies,
                  min(battle_time) as first_recorded
           from battle_participant
           where player_tag = $1 and battle_time > now() - interval '30 days'`,
        [tag],
      );
      const deck = await ctx.db.query(
        `select bp.deck_hash, count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  (array_agg(bp.deck order by bp.battle_time desc))[1] as deck
           from battle_participant bp
           where bp.player_tag = $1 and bp.deck_hash is not null
             and bp.battle_time > now() - interval '30 days'
           group by bp.deck_hash order by count(*) desc limit 2`,
        [tag],
      );
      const best = await ctx.db.query(
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
      );
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
        meta: await buildMeta(ctx.db, ctx.account, tag, [
          "player",
          "player_battlelog",
        ]),
      };
    },
  },

  players_profile: {
    description:
      "Latest recorded profile snapshot for a tag: trophies, Path of Legends, league stats, donations, lifetime counters, collection level, clan (with its badge and the player's role), the player's attributes (arena, best trophies, favourite card, account age) and current badge state. as-of the last profile poll. live: true fetches ANY tag fresh from the CR API through the live lane - recorded or not, an unrecorded opponent included - at the cost of one live fetch (meta.quota.live), and the fetched profile is recorded opportunistically. For tag-to-name only, players_names resolves up to 100 tags from the corpus without spending the live lane.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
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
        await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "summary",
          args.on_behalf_of,
        )
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
      const row = await readRecordedProfile(ctx.db, tag);
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
          ? {
              clan_tag: row.last_known_clan_tag,
              name: row.clan_name,
              badge_id: row.clan_badge_id,
              // The player's own account of their standing, as of the
              // last profile poll. Null once they leave a clan.
              role: row.last_known_clan_role,
            }
          : null,
        // The player as a game entity, separate from the daily numbers.
        // Ids only: names and icons resolve from cards_catalog, so a
        // renamed arena or a new icon never leaves stale copies here.
        // Clash Royale's own lastSeen, captured from clan roster polls -
        // the only place the API exposes it, so it is null for a player we
        // have never seen inside a polled clan and it stops moving the moment
        // they leave one. Distinct from every other timestamp here: it is when
        // the PLAYER was last active, not when this recorder last looked.
        last_seen_in_game: row.game_last_seen_at?.toISOString() ?? null,
        // The player as a game entity, separate from the daily numbers.
        attributes: {
          arena_id: row.arena_id,
          best_trophies: row.best_trophies,
          favorite_card_id: row.favorite_card_id,
          years_played: row.years_played,
          account_age_days: row.account_age_days,
        },
        // Current badge state, newest observation per badge. YearsPlayed
        // carries account age in days as its progress.
        badges: row.badges ?? [],
        snapshot: {
          date: row.snapshot_date.toISOString().slice(0, 10),
          trophies: row.trophies,
          path_of_legend: row.pol,
          league_statistics: row.league_stats,
          donations_this_week: row.donations,
          donations_received_this_week: row.donations_received,
          lifetime: row.lifetime,
        },
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player"]),
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
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        metrics: {
          type: "array",
          items: {
            type: "string",
            enum: ["trophies", "donations", "battle_count", "collection_level"],
          },
          default: ["trophies"],
        },
        from: { type: "string", description: WINDOW_DATE_ONLY_DESC },
        to: { type: "string", description: WINDOW_DATE_ONLY_DESC },
        granularity: { type: "string", enum: ["day", "week"], default: "day" },
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
        )
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
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player"]),
      };
    },
  },

  players_collection: {
    description:
      "Full card collection as last recorded: levels (in-game 1-16 scale), counts, alternate forms, star levels, collection level. evolutionLevel and maxEvolutionLevel are FORM BIT FIELDS with the same coding as battle decks - 1 = Evolution, 2 = Hero, 3 = both - NEVER a level or a progress counter: maxEvolutionLevel says which forms exist for the card, evolutionLevel which the player has unlocked (a battle-deck card carries only the single form it was played as). Each card also carries the decoded forms_available and forms_unlocked arrays so nothing has to know the bits. starLevel is cosmetic. API-shaped passthrough of the latest profile payload, plus the decoded fields.",
    inputSchema: {
      type: "object",
      properties: { player_tag: TAG_SCHEMA, on_behalf_of: ON_BEHALF_OF_SCHEMA },
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
        )
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
        // Levels on the in-game display scale (contracts displayCard);
        // forms decoded from the bit field (feedback #20: the raw values
        // read as ordinals and were reported as "2 of 3 progress").
        cards: (row.cards ?? []).map((c) => ({
          ...displayCard(c),
          forms_available: cardForms(c.maxEvolutionLevel),
          forms_unlocked: cardForms(c.evolutionLevel),
        })),
        support_cards: (row.support_cards ?? []).map(displayCard),
        as_of_payload: row.last_fetched_at.toISOString(),
        forms_note:
          "forms_available decodes maxEvolutionLevel (which alternate forms exist for the card); forms_unlocked decodes evolutionLevel (which the player has unlocked). Both are bit fields: 1 = Evolution, 2 = Hero, 3 = both. Never read them as levels or progress.",
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player"]),
      };
    },
  },

  players_names: {
    description:
      "Bulk tag-to-name resolution from the corpus (universal reads): up to 100 tags in, for each the last-observed name and where it came from, plus an explicit unknown list for tags the service has never seen a name for. Costs nothing from the live lane; resolving a miss is then a deliberate players_profile(live: true) per tag. The inverse of players_search, sized for name-first presentation of opponent lists.",
    inputSchema: {
      type: "object",
      properties: {
        player_tags: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 100,
        },
      },
      required: ["player_tags"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const raw = Array.isArray(args.player_tags) ? args.player_tags : [];
      if (raw.length === 0 || raw.length > 100)
        throw new ToolFailure("bad_request", "player_tags takes 1-100 tags.");
      const tags = [];
      for (const t of raw) {
        try {
          tags.push(normalizeTag(String(t)));
        } catch {
          throw new ToolFailure("invalid_tag", `Invalid tag: ${t}`);
        }
      }
      const unique = [...new Set(tags)];
      const { rows } = await ctx.db.query(
        `select p.player_tag, p.name, p.last_seen_at, nn.nickname,
                p.last_known_clan_tag as clan_tag,
                (select max(s.snapshot_date) from player_snapshot_daily s
                 where s.player_tag = p.player_tag) as profile_seen,
                (select max(bp.battle_time) from battle_participant bp
                 where bp.player_tag = p.player_tag) as battle_seen
         from player p
         left join player_nickname nn on nn.account_id = $2 and nn.player_tag = p.player_tag
         where p.player_tag = any($1)`,
        [unique, ctx.account.accountId],
      );
      const byTag = new Map(rows.map((r) => [r.player_tag, r]));
      const names = [];
      const unknown = [];
      for (const tag of unique) {
        const r = byTag.get(tag);
        if (r && r.name !== null) {
          names.push({
            player_tag: tag,
            name: r.name,
            ...(r.nickname ? { nickname: r.nickname } : {}),
            clan_tag: r.clan_tag,
            source: r.profile_seen
              ? "profile"
              : r.battle_seen
                ? "battlelog"
                : "roster",
            last_seen: r.last_seen_at?.toISOString() ?? null,
          });
        } else {
          unknown.push({
            player_tag: tag,
            in_corpus: Boolean(r),
          });
        }
      }
      return {
        names,
        unknown,
        note: "Names are as last observed by any recording (a rename since is invisible until the tag is seen again). unknown lists tags with no observed name: in_corpus true means the tag appears in recorded battles but no observation ever carried its name; players_profile(live: true) resolves one at the cost of a live fetch.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  players_search: {
    description:
      'Name-to-tag resolution across the whole recorded corpus (universal reads): case-insensitive substring on last-observed display names AND your private nicknames (elixir_nickname) - "tyler" finds the player you call Tyler, ranked first (source: nickname | claim | clanmate | corpus). Unknown names return an honest empty list, never a guess. The inverse (tags to names, in bulk) is players_names.',
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
      // The query is a literal, never a pattern: %, _ and \ are LIKE
      // metacharacters and went in unescaped, so "100%" matched everything
      // and "_" matched any character.
      const pattern = `%${likeLiteral(q)}%`;
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
        [ctx.account.accountId, pattern, limit],
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
