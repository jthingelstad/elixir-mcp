import { readRecordedProfile } from "../../../ingest/src/recorded-profile.mjs";
/** players_summary · players_profile · players_timeline ·
 *  players_collection · players_names · players_search. Conventions
 *  (1.0.0): `applied`, `notes[]` + `docs`, `verbosity`. */

import {
  MAX_DISPLAY_LEVEL,
  cardForms,
  normalizeTag,
  responseMeta,
} from "@elixir-mcp/contracts";
import {
  WINDOW_DATE_ONLY_DESC,
  TIMEZONE_SCHEMA,
  VERBOSITY,
  requireEnum,
  ToolFailure,
  spendLiveQuota,
  TAG_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  subject,
  buildMeta,
  zoneFor,
  appliedBlock,
  notes,
  docsRef,
} from "./shared.mjs";

/** Escape LIKE/ILIKE metacharacters so user text matches literally
 *  (Postgres' default escape character is the backslash). */
function likeLiteral(text) {
  return String(text).replace(/[\\%_]/g, (c) => `\\${c}`);
}

const FORMS_DOCS = docsRef("battles", "deck-identity-and-forms");

export const playersTools = {
  players_summary: {
    description:
      "The headline in one call: current trophies and clan, last-30-days record and win rate, and the most-played deck with its record. Start here for “how am I doing?”; drill in with battles_performance / battles_decks.",
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
      const asOf = new Date();
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
          "players_profile({ player_tag, live: true }) reads any tag from the game.",
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
        applied: appliedBlock({
          window: {
            from: new Date(asOf.getTime() - 30 * 86400_000).toISOString(),
            to: asOf.toISOString(),
            source: "fixed",
            days: 30,
          },
        }),
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
        // most-played is often NOT the best-performing deck.
        best_deck: b && b.deck_hash !== d?.deck_hash ? deckShape(b) : null,
        notes: notes(
          "Counts include every recorded battle (war modes carry no trophies); win_rate = wins/(wins+losses), draws excluded.",
          "best_deck needs 10+ battles in the window and is omitted when it IS the top deck.",
          "History may predate active recording; elixir_coverage has the capture story.",
        ),
        docs: docsRef("recording", "completeness"),
        meta: await buildMeta(ctx.db, ctx.account, tag, [
          "player",
          "player_battlelog",
        ]),
      };
    },
  },

  players_profile: {
    description:
      "Latest recorded profile snapshot for a tag: trophies, Path of Legends, league stats, donations, lifetime counters, collection level, clan (with badge and the player's role), attributes (arena, best trophies, favourite card, account age) and current badge state, as of the last profile poll. live: true fetches ANY tag fresh from the game (one live fetch), recorded or not, and records it. For tag-to-name only, players_names resolves up to 100 tags without the live lane.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        live: {
          type: "boolean",
          description:
            "Fetch fresh from the game first (one live fetch); works for a player nobody records.",
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
          "live: true reads any tag from the game.",
        );
      if (!row.snapshot_date) {
        throw new ToolFailure(
          "not_recorded",
          `${tag} is known but has no profile snapshot yet.`,
          "Recording may have just started; try elixir_coverage, or live: true.",
        );
      }
      return {
        player_tag: row.player_tag,
        name: row.name,
        applied: appliedBlock({ live: args.live === true ? true : undefined }),
        clan: row.last_known_clan_tag
          ? {
              clan_tag: row.last_known_clan_tag,
              name: row.clan_name,
              badge_id: row.clan_badge_id,
              role: row.last_known_clan_role,
            }
          : null,
        last_seen_in_game: row.game_last_seen_at?.toISOString() ?? null,
        // The player as a game entity, separate from the daily numbers.
        // Ids only: names and icons resolve from cards_catalog.
        attributes: {
          arena_id: row.arena_id,
          best_trophies: row.best_trophies,
          favorite_card_id: row.favorite_card_id,
          years_played: row.years_played,
          account_age_days: row.account_age_days,
        },
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
        notes: notes(
          "last_seen_in_game is the game's own lastSeen from clan roster polls (when the player was last active); null until a polled roster carried them.",
          "attributes and clan carry ids only; names and icons resolve through cards_catalog.",
        ),
        docs: docsRef("recording", "the-games-own-last-seen"),
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player"]),
      };
    },
  },

  players_timeline: {
    description:
      "Time series from daily snapshots: trophies, donations (the weekly counter, which resets Mondays), battle_count, collection_level. The trophy-graph tool. Granularity week returns the last snapshot of each ISO week.",
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
          description: "Which series to return.",
        },
        from: { type: "string", description: WINDOW_DATE_ONLY_DESC },
        to: { type: "string", description: WINDOW_DATE_ONLY_DESC },
        timezone: TIMEZONE_SCHEMA,
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
      const tz = zoneFor(ctx, args);
      for (const d of ["from", "to"]) {
        if (
          args[d] !== undefined &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(String(args[d])) ||
            Number.isNaN(Date.parse(args[d])))
        ) {
          throw new ToolFailure(
            "bad_request",
            `Unparseable ${d}: ${args[d]}`,
            WINDOW_DATE_ONLY_DESC,
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
      // Epoch disclosure: snapshots start later than battles; never let a
      // truncated series read as smooth history.
      const { rows: epoch } = await ctx.db.query(
        `select min(snapshot_date)::text as first from player_snapshot_daily
         where player_tag = $1 and snapshot_kind = 'daily'`,
        [tag],
      );
      const snapshotsFrom = epoch[0]?.first ?? null;
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
        applied: appliedBlock({
          window: {
            from: args.from ?? null,
            to: args.to ?? null,
            source: args.from || args.to ? "argument" : "unbounded",
            ...(tz ? { timezone: tz } : {}),
          },
          granularity: weekly ? "week" : "day",
          metrics,
        }),
        snapshots_available_from: snapshotsFrom,
        series: points.map((r) => ({
          date: r.snapshot_date.toISOString().slice(0, 10),
          ...(weekly ? { iso_week: r.iso_week } : {}),
          ...Object.fromEntries(metrics.map((m) => [m, r[m]])),
        })),
        notes: notes(
          snapshotsFrom && args.from && args.from < snapshotsFrom
            ? `Requested from ${args.from}, but daily snapshots begin ${snapshotsFrom}; earlier dates have battles (see elixir_coverage) but no snapshots.`
            : null,
          metrics.includes("donations")
            ? "donations is the weekly counter as of each snapshot; it resets Mondays around 00:10 UTC."
            : null,
          "Snapshot days are UTC dates; the series exists only from snapshots_available_from.",
        ),
        docs: docsRef("recording", "completeness"),
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player"], {
          timezone: tz,
        }),
      };
    },
  },

  players_collection: {
    description:
      "Full card collection as last recorded: levels (in-game 1-16 scale), counts, forms, star levels, collection level. evolutionLevel / maxEvolutionLevel are FORM bit fields (1 = Evolution, 2 = Hero, 3 = both), decoded into forms_unlocked / forms_available. verbosity compact keeps id, name, level and forms per card.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        verbosity: VERBOSITY(
          "each card as id, name, level, forms_unlocked only; support_cards likewise.",
        ),
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
      // The collection is a table (0076), joined to the catalog for the
      // static facts; levels are already on the 1-16 scale.
      const { rows } = await ctx.db.query(
        `select pc.card_id, pc.level, pc.count, pc.evolution_level, pc.star_level, pc.observed_at,
                c.name, c.kind, c.rarity, c.elixir_cost, c.max_level, c.max_evolution_level, c.icon_urls
         from player_card pc
         left join card c on c.card_id = pc.card_id
         where pc.player_tag = $1
         order by pc.card_id`,
        [tag],
      );
      if (rows.length === 0) {
        throw new ToolFailure(
          "not_recorded",
          `No collection recorded for ${tag} yet.`,
          "The collection is read from the player's profile; players_profile({ live: true }) fetches one now.",
        );
      }
      const { rows: lvl } = await ctx.db.query(
        `select (lifetime->>'collectionLevel')::int as collection_level
         from player_snapshot_daily where player_tag = $1
         order by snapshot_date desc, snapshot_kind desc limit 1`,
        [tag],
      );
      const asOf = rows.reduce(
        (m, r) => (r.observed_at > m ? r.observed_at : m),
        rows[0].observed_at,
      );
      const compact = args.verbosity === "compact";
      const shape = (r) => {
        const full = {
          id: r.card_id,
          name: r.name ?? null,
          level: r.level,
          maxLevel: MAX_DISPLAY_LEVEL,
          ...(r.max_level !== null ? { maxLevelRarityScale: r.max_level } : {}),
          ...(r.count !== null ? { count: r.count } : {}),
          ...(r.star_level !== null ? { starLevel: r.star_level } : {}),
          ...(r.evolution_level !== null
            ? { evolutionLevel: r.evolution_level }
            : {}),
          ...(r.max_evolution_level !== null
            ? { maxEvolutionLevel: r.max_evolution_level }
            : {}),
          ...(r.rarity ? { rarity: r.rarity } : {}),
          ...(r.elixir_cost !== null ? { elixirCost: r.elixir_cost } : {}),
          ...(r.icon_urls ? { iconUrls: r.icon_urls } : {}),
          forms_available: cardForms(r.max_evolution_level),
          forms_unlocked: cardForms(r.evolution_level),
        };
        return compact
          ? {
              id: full.id,
              name: full.name,
              level: full.level,
              forms_unlocked: full.forms_unlocked,
            }
          : full;
      };
      return {
        player_tag: tag,
        applied: appliedBlock({ verbosity: compact ? "compact" : "full" }),
        collection_level: lvl[0]?.collection_level ?? null,
        cards: rows.filter((r) => r.kind !== "support").map(shape),
        support_cards: rows.filter((r) => r.kind === "support").map(shape),
        as_of_payload: asOf.toISOString(),
        notes: notes(
          "forms_available decodes maxEvolutionLevel (which forms exist), forms_unlocked decodes evolutionLevel (which the player holds); both are bit fields, never levels or progress.",
          "Levels are the in-game 1-16 scale; starLevel is cosmetic.",
        ),
        docs: FORMS_DOCS,
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player"]),
      };
    },
  },

  players_names: {
    description:
      "Bulk tag-to-name resolution from the corpus: up to 100 tags in, for each the last-observed name and where it came from, plus an explicit unknown list. Costs nothing from the live lane; resolving a miss is then a deliberate players_profile({ live: true }) per tag. The inverse of players_search.",
    inputSchema: {
      type: "object",
      properties: {
        player_tags: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 100,
          description: "One to one hundred player tags.",
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
        applied: appliedBlock({ player_tags: unique }),
        names,
        unknown,
        notes: notes(
          "Names are as last observed by any recording; a rename since is invisible until the tag is seen again.",
          "unknown.in_corpus true means the tag appears in recorded battles but no observation carried its name; players_profile({ live: true }) resolves one at the cost of a live fetch.",
        ),
        docs: docsRef("glossary"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  players_search: {
    description:
      'Name-to-tag resolution across the whole recorded corpus: case-insensitive substring on last-observed display names AND your private nicknames, nicknames ranked first ("tyler" finds the player you call Tyler). Unknown names return an honest empty list, never a guess. The inverse (tags to names, in bulk) is players_names.',
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 50,
          description: "Part of a name or nickname.",
        },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const q = String(args.query ?? "").trim();
      if (!q) throw new ToolFailure("bad_request", "query is empty.");
      const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 20);
      // The query is a literal, never a pattern.
      const pattern = `%${likeLiteral(q)}%`;
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
        applied: appliedBlock({ query: q, limit }),
        matches: rows,
        notes: notes(
          rows.length === 0
            ? "No recorded player matches that name; names change, tags are permanent, and only players the service has observed are findable."
            : "Your own players and clanmates rank first (source: nickname | claim | clanmate | corpus); names are as last observed.",
        ),
        docs: docsRef("protocol", "argument-conventions"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
