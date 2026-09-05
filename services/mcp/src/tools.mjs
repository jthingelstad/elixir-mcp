/**
 * The V1 tool registry — DESIGN §3. Declarations (JSON Schema) and
 * handlers together so the schema and behavior can't drift. Handlers
 * throw ToolFailure for structured errors (the closed taxonomy); the
 * invoker renders them as {error, meta} bodies with isError: true.
 */

import {
  normalizeTag,
  responseMeta,
  MODE_GROUPS,
  typesForModeGroup,
  displayCard,
  TOOL_GROUPS,
  GROUP_ORDER,
  CHANGELOG,
  CONTRACT_VERSION,
  roleQuotas,
} from "@elixir-mcp/contracts";
import { resolveInstant, formatLocal } from "./time.mjs";
import { resolveSubject, resolveEntitledClan } from "./entitlements.mjs";
import { livePathToJob } from "./live.mjs";
import { periodInfo } from "../../ingest/src/war-clock.mjs";
import { emitFeedEvent, FEED_TOPICS } from "./feed.mjs";
import { ensureGatewayCards } from "./gateway-cards.mjs";

/** The live lane spends real CR budget: tight per-account daily cap,
 *  defaulted by role (contracts roles.ts), beaten by the per-account
 *  live_daily_quota override. */
async function spendLiveQuota(ctx) {
  if (ctx.account.isOwner || ctx.account.role === "admin") return;
  const cap =
    ctx.account.liveDailyQuota ??
    roleQuotas(ctx.account.role).live_fetches_per_day;
  if (cap === Infinity) return;
  const day = new Date().toISOString().slice(0, 10);
  const { rows } = await ctx.db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 1)
     on conflict (bucket, window_start) do update set count = rate_limit.count + 1
     returning count`,
    [`liveday#${ctx.account.accountId}`, day],
  );
  if (rows[0].count > cap) {
    throw new ToolFailure(
      "quota_exceeded",
      `Live-fetch quota reached (${cap}/day for the ${ctx.account.role ?? "member"} tier).`,
      "Recorded-data tools are unlimited within the normal quota. Higher tiers get more - see /docs (Roles) or ask via elixir_feedback.",
    );
  }
}

export class ToolFailure extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

const TAG_SCHEMA = {
  type: "string",
  description:
    "Clash Royale player tag like #20JJJ2CCRU. Defaults to your primary claimed tag.",
};

// --- shared helpers --------------------------------------------------------

/** Entitlement resolution with plain-object errors converted to the
 *  closed taxonomy. `need`: 'full' | 'summary' | 'battles' (§4.2). */
const TAG_RULE_HINT =
  "Tags are # plus 3-12 characters from 0289PYLQGRJCUV (letter O folds to zero).";

async function subject(db, account, inputTag, need) {
  try {
    return await resolveSubject(db, account, inputTag, need);
  } catch (err) {
    if (err?.code === "invalid_tag")
      throw new ToolFailure(err.code, err.message, TAG_RULE_HINT);
    if (err?.code) throw new ToolFailure(err.code, err.message, err.hint);
    throw err;
  }
}

async function entitledClan(db, account, inputTag) {
  try {
    return await resolveEntitledClan(db, account, inputTag);
  } catch (err) {
    if (err?.code) throw new ToolFailure(err.code, err.message, err.hint);
    throw err;
  }
}

async function buildMeta(db, account, tag) {
  const { rows } = await db.query(
    `select
       (select min(created_at) from recording
        where subject_type = 'player' and subject_tag = $1 and status = 'active') as recorded_since,
       (select extract(epoch from now() - max(last_admitted_at))::int from poll_state
        where subject_tag = $1) as freshness_seconds,
       (select count(*)::int from feedback
        where account_id = $2 and responded_at is not null
          and response_seen_at is null) as fb_pending,
       (select count(*)::int from event_feed ef
        where ef.account_id = $2
          and ef.event_id > (select events_seen_through from account
                             where account_id = $2)) as events_pending`,
    [tag, account.accountId],
  );
  const row = rows[0] ?? {};
  return responseMeta({
    as_of: new Date().toISOString(),
    ...(row.recorded_since
      ? { recording_active_since: row.recorded_since.toISOString() }
      : {}),
    ...(row.freshness_seconds !== null && row.freshness_seconds !== undefined
      ? { freshness_seconds: row.freshness_seconds }
      : {}),
    ...(row.fb_pending > 0
      ? { feedback_responses_pending: row.fb_pending }
      : {}),
    ...(row.events_pending > 0 ? { events_pending: row.events_pending } : {}),
    ...(account.timezone ? { timezone_applied: account.timezone } : {}),
  });
}

/** Inverted date windows are never intent (edge-poker finding): refuse
 *  loudly instead of returning an empty that reads as "you didn't play". */
function requireOrderedWindow(from, to) {
  if (from && to && from.getTime() > to.getTime()) {
    throw new ToolFailure(
      "bad_request",
      "from is after to — the window is inverted.",
      "Swap the bounds; from must be the earlier instant.",
    );
  }
}

/** Segment resolution shared by the meta and trends tools: exactly one
 *  of player_tag / clan_tag / collection, or none = the whole recorded
 *  corpus (universal reads). Returns a WHERE fragment + params slice
 *  that scopes battle_participant rows to the segment's players. */
async function segmentFilter(ctx, args, params) {
  const picked = ["player_tag", "clan_tag", "collection"].filter(
    (k) => args[k] !== undefined,
  );
  if (picked.length > 1) {
    throw new ToolFailure(
      "bad_request",
      "Pick at most one of player_tag, clan_tag, collection.",
    );
  }
  if (args.player_tag !== undefined) {
    const tag = (await subject(ctx.db, ctx.account, args.player_tag, "summary"))
      .tag;
    params.push(tag);
    return { where: `bp.player_tag = $${params.length}`, label: tag };
  }
  if (args.clan_tag !== undefined) {
    const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
    params.push(clanTag);
    return {
      where: `bp.player_tag in (select cm.player_tag from clan_membership cm
               where cm.clan_tag = $${params.length} and cm.left_observed_at is null)`,
      label: clanTag,
    };
  }
  if (args.collection !== undefined) {
    const slug = String(args.collection).toLowerCase().trim();
    const { rows } = await ctx.db.query(
      `select c.collection_id from collection c
       where c.slug = $1 and c.kind = 'player'
         and (c.visibility = 'public' or c.owner_account = $2)`,
      [slug, ctx.account.accountId],
    );
    if (!rows[0]) {
      throw new ToolFailure(
        "not_found",
        `No player collection '${slug}'.`,
        "collections_browse lists what exists.",
      );
    }
    params.push(rows[0].collection_id);
    return {
      where: `bp.player_tag in (select m.subject_tag from collection_member m
               where m.collection_id = $${params.length})`,
      label: slug,
    };
  }
  return { where: null, label: "corpus" };
}

/** Empirical-Bayes shrinkage (META-INTEL): pull small samples toward
 *  the segment mean so a 3-0 deck never outranks a 60-40 one. */
function ebShrink(wins, decided, segmentMean, m = 20) {
  if (decided === 0) return null;
  return Number(((wins + m * segmentMean) / (decided + m)).toFixed(3));
}

const SEGMENT_ARGS = {
  player_tag: {
    type: "string",
    description: "Scope to one recorded player.",
  },
  clan_tag: {
    type: "string",
    description: "Scope to a recorded clan's current members.",
  },
  collection: {
    type: "string",
    description: "Scope to a player collection's members (e.g. 'pros').",
  },
};

const SEGMENT_NOTE =
  "Pure observation, never opinion: rates are computed from recorded battles with sample sizes attached. shrunk_win_rate is empirical-Bayes (prior = the segment mean, strength 20) so tiny samples never top the list. players counts distinct pilots - a rate carried by one player is composition, not the deck.";

// --- tools -----------------------------------------------------------------

const TOOLS = {
  elixir_my_players: {
    description:
      "Your session bootstrap: the players you've added (added = recorded), which is primary (the starred \"me\" tag), each one's notify setting and recording status, and current clan as recorded. claim_status is informational - claims are trust-based. Call this first.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const { rows } = await ctx.db.query(
        `select c.player_tag, c.status as claim_status, c.is_primary, c.notify,
                p.name, p.last_known_clan_tag,
                r.status as recording_status,
                cm.clan_tag as member_of, cm.role
         from claim c
         join player p on p.player_tag = c.player_tag
         left join recording r on r.subject_type = 'player' and r.subject_tag = c.player_tag and r.status = 'active'
         left join clan_membership cm on cm.player_tag = c.player_tag and cm.left_observed_at is null
         where c.account_id = $1
         order by c.is_primary desc, c.player_tag`,
        [ctx.account.accountId],
      );
      return {
        players: rows.map((r) => ({
          player_tag: r.player_tag,
          name: r.name,
          is_primary: r.is_primary,
          claim_status: r.claim_status,
          notify: r.notify,
          recording: r.recording_status ?? "not_recording",
          clan_tag: r.member_of ?? r.last_known_clan_tag,
          clan_role: r.role,
        })),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

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

  elixir_coverage: {
    description:
      "How complete the record is for a tag: recording start, last successful poll per endpoint, battles captured (including appearances recorded before the tag was added), and recent capture completeness. Use it to caveat answers honestly.",
    inputSchema: {
      type: "object",
      properties: { player_tag: TAG_SCHEMA },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(ctx.db, ctx.account, args.player_tag, "summary")
      ).tag;
      const [polls, battles, completeness, snapEpoch] = await Promise.all([
        ctx.db.query(
          `select endpoint, last_admitted_at from poll_state where subject_tag = $1 order by endpoint`,
          [tag],
        ),
        ctx.db.query(
          `select count(*)::int as appearances, min(b.battle_time) as first_seen, max(b.battle_time) as last_seen
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where bp.player_tag = $1`,
          [tag],
        ),
        ctx.db.query(
          `select avg(completeness_ratio)::numeric(4,3) as recent_ratio,
                  count(*) filter (where is_complete is false)::int as incomplete_days
           from player_daily_battle_rollup
           where player_tag = $1 and day > current_date - 7 and completeness_ratio is not null`,
          [tag],
        ),
        ctx.db.query(
          `select min(snapshot_date)::text as first from player_snapshot_daily
           where player_tag = $1 and snapshot_kind = 'daily'`,
          [tag],
        ),
      ]);
      const b = battles.rows[0];
      return {
        player_tag: tag,
        polls: polls.rows.map((r) => ({
          endpoint: r.endpoint,
          last_admitted_at: r.last_admitted_at?.toISOString() ?? null,
        })),
        battles: {
          recorded_appearances: b.appearances,
          first_recorded: b.first_seen?.toISOString() ?? null,
          last_recorded: b.last_seen?.toISOString() ?? null,
          note:
            b.appearances > 0
              ? `This tag appears in ${b.appearances} recorded battles since ${b.first_seen?.toISOString()?.slice(0, 10)} — including any recorded before the tag was claimed.`
              : "No battles recorded yet for this tag.",
        },
        snapshots: {
          first_date: snapEpoch.rows[0]?.first ?? null,
          note: "Battle capture, daily snapshots, and active recording can each begin at different times; timeline data exists only from first_date.",
        },
        completeness_last_7_days: {
          average_ratio: completeness.rows[0].recent_ratio,
          incomplete_days:
            completeness.rows[0].recent_ratio === null
              ? null
              : completeness.rows[0].incomplete_days,
          ...(completeness.rows[0].recent_ratio === null
            ? {
                note: "Not yet computable: completeness needs consecutive daily snapshots to bracket each day; it fills in after a couple of days of recording.",
              }
            : {}),
        },
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

  battles_query: {
    description:
      "The workhorse: canonical recorded battles with filters and cursor pagination. Returns both perspectives of every battle. Three addressing modes: a player_tag (the usual sweep); battle_id alone (ONE battle, both sides - the record-browser lookup); deck_hash alone (corpus-wide battles for that exact deck, with a deck_stats aggregate - counts, W-L, distinct pilots; deliberately no win rate: a deck's pooled rate describes who plays it, see docs/META-INTEL). from/to accept ISO instants or date-only strings resolved in your timezone.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        from: {
          type: "string",
          description: "ISO instant or YYYY-MM-DD (your timezone).",
        },
        to: {
          type: "string",
          description: "ISO instant or YYYY-MM-DD inclusive (your timezone).",
        },
        mode: {
          type: "string",
          enum: MODE_GROUPS,
          description:
            "Mode group filter. ladder = Trophy Road; ranked = Path of Legends.",
        },
        game_mode_id: { type: "integer" },
        opponent_tag: {
          type: "string",
          description: "Only battles against this tag.",
        },
        outcome: { type: "string", enum: ["win", "loss", "draw"] },
        with_card: {
          type: "integer",
          description: "Card id present in YOUR deck.",
        },
        against_card: {
          type: "integer",
          description: "Card id present in an OPPONENT deck.",
        },
        deck_hash: {
          type: "string",
          description:
            "Exact deck identity (see battles_decks). Without player_tag: corpus-wide.",
        },
        battle_id: {
          type: "string",
          description:
            "Fetch exactly this battle (both perspectives). No player_tag needed.",
        },
        game_mode: {
          type: "string",
          description:
            "Case-insensitive match on the game's mode name (substring): 'chaos' finds Chaos_1v1_Draft and friends, 'crazy' the Crazy Arena events. Discover names with battles_performance group_by: 'mode'.",
        },
        cursor: {
          type: "string",
          description:
            "Opaque pagination token from a previous response’s next_cursor.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 25 },
        include_total: {
          type: "boolean",
          description:
            "Also return total_count: how many battles match the filters across ALL pages (one cheap count query).",
        },
        verbosity: {
          type: "string",
          enum: ["full", "compact"],
          default: "full",
          description:
            "compact drops per-card deck arrays, support cards, and tower_hp (deck_hash remains) — use it for wide sweeps. full delivers both sides' decks and tower_hp and therefore caps limit at 25.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      // Addressing modes (design handoff 2026-09-05): battle_id and
      // corpus-wide deck_hash need no subject tag - recorded battles
      // are universal reads.
      const byBattle = args.battle_id !== undefined;
      const corpusDeck = !byBattle && args.deck_hash && !args.player_tag;
      let tag = null;
      if (!byBattle && !corpusDeck) {
        const s = await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "battles",
        );
        tag = s.tag;
      }
      const tz = ctx.account.timezone;
      const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 50);
      const compact = args.verbosity === "compact";
      // Full battles now carry BOTH sides' decks and tower_hp; above the
      // default page size that reliably overruns the result cap and
      // truncates mid-JSON. Refuse loudly instead.
      if (!compact && Number(args.limit ?? 25) > 25) {
        throw new ToolFailure(
          "bad_request",
          "limit above 25 requires verbosity: 'compact' (full battles carry both sides' decks).",
          "Use compact for wide sweeps; deck_hash survives compaction.",
        );
      }
      const where = [];
      const params = [];
      if (byBattle) {
        params.push(String(args.battle_id));
        where.push(`bp.battle_id = $1`, `bp.side = 0`);
      } else if (corpusDeck) {
        // deck filter added below via the shared deck_hash clause
        where.push("bp.side is not null");
      } else {
        params.push(tag);
        where.push("bp.player_tag = $1");
      }
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      const from = resolveInstant(tz, args.from);
      if (args.from && !from)
        throw new ToolFailure("bad_request", `Unparseable from: ${args.from}`);
      if (from) add("b.battle_time >= ?", from);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      if (args.to && !to)
        throw new ToolFailure("bad_request", `Unparseable to: ${args.to}`);
      requireOrderedWindow(from, to);
      if (to) add("b.battle_time < ?", to);
      if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
      if (args.game_mode_id !== undefined)
        add("b.game_mode_id = ?", args.game_mode_id);
      if (args.game_mode)
        add("b.game_mode_name ilike ?", `%${String(args.game_mode)}%`);
      if (args.outcome) add("bp.outcome = ?", args.outcome);
      if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
      if (args.with_card !== undefined) {
        add(
          `bp.deck->'cards' @> ?::jsonb`,
          JSON.stringify([{ id: args.with_card }]),
        );
      }
      if (args.opponent_tag) {
        let opponent;
        try {
          opponent = normalizeTag(String(args.opponent_tag));
        } catch {
          throw new ToolFailure(
            "invalid_tag",
            `Invalid opponent_tag: ${args.opponent_tag}`,
          );
        }
        add(
          `exists (select 1 from battle_participant o
                   where o.battle_id = bp.battle_id and o.side <> bp.side and o.player_tag = ?)`,
          opponent,
        );
      }
      if (args.against_card !== undefined) {
        add(
          `exists (select 1 from battle_participant o
                   where o.battle_id = bp.battle_id and o.side <> bp.side
                     and o.deck->'cards' @> ?::jsonb)`,
          JSON.stringify([{ id: args.against_card }]),
        );
      }
      if (args.cursor !== undefined) {
        // Keyset on (battle_time, battle_id): battles are ordered by when
        // they were PLAYED, never by insert order — the archive backfill
        // made those permanently different.
        const m = /^(.+)\|([0-9a-f]{64})$/.exec(String(args.cursor));
        if (!m || Number.isNaN(Date.parse(m[1]))) {
          throw new ToolFailure(
            "bad_request",
            "Invalid cursor.",
            "Cursors are opaque tokens; restart from the first page.",
          );
        }
        // Integrity: the id half must be a real battle. A forged or
        // corrupted-but-parseable cursor otherwise returns an empty page
        // indistinguishable from end-of-data (round-3 finding). Battles
        // are never deleted, so a genuine cursor always passes.
        const { rows: cursorRow } = await ctx.db.query(
          `select 1 from battle where battle_id = $1`,
          [m[2]],
        );
        if (!cursorRow[0]) {
          throw new ToolFailure(
            "bad_request",
            "Invalid cursor (not issued by this server, or corrupted).",
            "Cursors are opaque tokens; restart from the first page.",
          );
        }
        params.push(m[1], m[2]);
        where.push(
          `(b.battle_time, b.battle_id) < ($${params.length - 1}, $${params.length})`,
        );
      }

      const { rows } = await ctx.db.query(
        `select b.cursor, b.battle_id, b.battle_time, b.type, b.game_mode_id, b.game_mode_name,
                b.arena, b.league_number,
                bp.player_tag, bp.side, bp.crowns, bp.trophy_change, bp.starting_trophies, bp.deck, bp.deck_hash,
                bp.elixir_leaked, bp.tower_hp, bp.outcome
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         where ${where.join(" and ")}
         order by b.battle_time desc, b.battle_id desc
         limit ${limit}`,
        params,
      );

      let others = new Map();
      if (rows.length > 0) {
        const ids = rows.map((r) => r.battle_id);
        const sides = rows.map((r) => r.side);
        const { rows: rest } = await ctx.db.query(
          tag
            ? `select o.battle_id, o.player_tag, o.side, o.crowns, o.deck_hash, o.clan_tag,
                  o.deck, o.tower_hp, p.name
           from battle_participant o join player p on p.player_tag = o.player_tag
           where o.battle_id = any($1) and o.player_tag <> $2`
            : `select o.battle_id, o.player_tag, o.side, o.crowns, o.deck_hash, o.clan_tag,
                  o.deck, o.tower_hp, p.name
           from battle_participant o join player p on p.player_tag = o.player_tag
           join unnest($1::text[], $2::int[]) me(battle_id, side)
             on me.battle_id = o.battle_id
           where o.side <> me.side`,
          tag ? [ids, tag] : [ids, sides],
        );
        others = rest.reduce((map, r) => {
          if (!map.has(r.battle_id)) map.set(r.battle_id, []);
          map.get(r.battle_id).push(r);
          return map;
        }, new Map());
      }

      const battles = rows.map((r) => {
        const rest = others.get(r.battle_id) ?? [];
        const shape = (o) => ({
          player_tag: o.player_tag,
          name: o.name,
          crowns: o.crowns,
          deck_hash: o.deck_hash,
          clan_tag: o.clan_tag,
          // Full verbosity delivers the promised "both perspectives":
          // participant rows are written symmetrically at ingest.
          ...(compact ? {} : { deck: o.deck, tower_hp: o.tower_hp }),
        });
        return {
          battle_id: r.battle_id,
          battle_time: r.battle_time.toISOString(),
          ...(tz ? { battle_time_local: formatLocal(r.battle_time, tz) } : {}),
          type: r.type,
          game_mode: { id: r.game_mode_id, name: r.game_mode_name },
          arena: r.arena,
          league_number: r.league_number,
          me: {
            ...(tag ? {} : { player_tag: r.player_tag }),
            outcome: r.outcome,
            crowns: r.crowns,
            trophy_change: r.trophy_change,
            starting_trophies: r.starting_trophies,
            deck_hash: r.deck_hash,
            ...(compact
              ? {}
              : {
                  deck: r.deck,
                  elixir_leaked:
                    r.elixir_leaked === null ? null : Number(r.elixir_leaked),
                  tower_hp: r.tower_hp,
                }),
          },
          teammates: rest.filter((o) => o.side === r.side).map(shape),
          opponents: rest.filter((o) => o.side !== r.side).map(shape),
        };
      });

      let deckStats;
      if (corpusDeck) {
        // The honest aggregate: counts, W-L, distinct pilots, span.
        // Deliberately NO win rate - a deck's pooled rate describes who
        // plays it (docs/META-INTEL §2); lift with a sample size is an
        // agent tool (battles_meta_decks).
        const { rows: ds } = await ctx.db.query(
          `select count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(distinct bp.player_tag)::int as players,
                  min(b.battle_time) as first_used,
                  max(b.battle_time) as last_used
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where bp.deck_hash = $1`,
          [String(args.deck_hash)],
        );
        deckStats = {
          battles: ds[0].battles,
          wins: ds[0].wins,
          losses: ds[0].losses,
          players: ds[0].players,
          first_used: ds[0].first_used?.toISOString() ?? null,
          last_used: ds[0].last_used?.toISOString() ?? null,
        };
      }

      let totalCount;
      if (args.include_total === true) {
        // Same filters minus the cursor: the cursor positions a page, the
        // total describes the whole match set.
        const countWhere = where.filter(
          (w) => !w.includes("(b.battle_time, b.battle_id) <"),
        );
        const { rows: cnt } = await ctx.db.query(
          `select count(*)::int as n
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${countWhere.join(" and ")}`,
          params.slice(0, countWhere.length),
        );
        totalCount = cnt[0].n;
      }

      // Empty page + a window that ends before the first recorded battle
      // reads as "player was inactive" unless we say otherwise.
      let warnings;
      if (battles.length === 0 && to && tag) {
        const { rows: firstRec } = await ctx.db.query(
          `select min(battle_time) as first from battle_participant where player_tag = $1`,
          [tag],
        );
        const first = firstRec[0]?.first;
        if (first && to.getTime() < first.getTime()) {
          warnings = [
            `window_precedes_recording: the window ends before this player's first recorded battle (${first.toISOString()}); emptiness means no COVERAGE, not inactivity.`,
          ];
        }
      }

      return {
        ...(tag ? { player_tag: tag } : {}),
        ...(byBattle ? { battle_id: String(args.battle_id) } : {}),
        ...(deckStats
          ? {
              deck_hash: String(args.deck_hash),
              deck_stats: deckStats,
              deck_note:
                "No pooled win rate by design: a deck's rate describes who plays it. Ask battles_meta_decks for shrunk rates with sample sizes.",
            }
          : {}),
        battles,
        ...(warnings ? { warnings } : {}),
        ...(totalCount !== undefined ? { total_count: totalCount } : {}),
        // Explicit null = end of results (absent-vs-null was ambiguous).
        next_cursor:
          rows.length === limit
            ? `${rows[rows.length - 1].battle_time.toISOString()}|${rows[rows.length - 1].battle_id}`
            : null,
        ...(compact
          ? {}
          : {
              card_legend:
                "Deck cards: level is the in-game 1-16 scale; evolutionLevel discriminates the FORM the card took in this battle (1 = Evolution, 2 = Hero; absent = base) — never a level; starLevel is cosmetic. tower_hp is the hitpoints REMAINING on that player's towers when the battle ended (a margin signal, never a level); princess is an array of surviving princess-tower hp, and null means the game did not report tower data for this battle.",
            }),
        meta: await buildMeta(
          ctx.db,
          ctx.account,
          tag ?? rows[0]?.player_tag ?? "#",
        ),
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

  battles_performance: {
    description:
      'Computed record over a window: W/L/D, win rate, crowns for/against, net trophies, three-crown rate, streaks. compare_from/compare_to or before_after runs a second window server-side — built for "since X vs before" questions. Precedence: before_after wins over compare_*; the response echoes filters_applied.',
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        from: {
          type: "string",
          description: "ISO instant or YYYY-MM-DD (your timezone).",
        },
        to: { type: "string" },
        last_n_battles: { type: "integer", minimum: 1, maximum: 500 },
        mode: { type: "string", enum: MODE_GROUPS },
        deck_hash: { type: "string" },
        compare_from: { type: "string" },
        compare_to: { type: "string" },
        group_by: {
          type: "string",
          enum: ["week", "mode"],
          description:
            "week: weekly win-rate series (ISO weeks) — the trend view. mode: per-game-mode record (every named mode played — Ladder, Ranked, war modes, and event modes like Chaos/KHAOS drafts or Crazy Arena — the 'what have I been playing?' discovery view). Combines with mode/deck_hash/from/to; overrides before_after and compare_*.",
        },
        before_after: {
          type: "string",
          description:
            "Date splitting two windows: [from..date) vs [date..to] — e.g. performance before vs after a deck change.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(ctx.db, ctx.account, args.player_tag, "summary")
      ).tag;
      const tz = ctx.account.timezone;

      const segment = async ({ from, to, lastN }) => {
        const where = ["bp.player_tag = $1", `bp.outcome is not null`];
        const params = [tag];
        const add = (clause, value) => {
          params.push(value);
          where.push(clause.replace("?", `$${params.length}`));
        };
        if (from) add("b.battle_time >= ?", from);
        if (to) add("b.battle_time < ?", to);
        if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
        if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
        const { rows } = await ctx.db.query(
          `select bp.outcome, bp.crowns, bp.trophy_change,
                  (select max(o.crowns) from battle_participant o
                   where o.battle_id = bp.battle_id and o.side <> bp.side) as opp_crowns
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}
           order by b.battle_time desc
           ${lastN ? `limit ${Math.min(lastN, 500)}` : "limit 2000"}`,
          params,
        );
        const wins = rows.filter((r) => r.outcome === "win").length;
        const losses = rows.filter((r) => r.outcome === "loss").length;
        const draws = rows.filter((r) => r.outcome === "draw").length;
        const decided = wins + losses;
        let streak = 0;
        for (const r of rows) {
          if (r.outcome === "unresolved" || r.outcome === "draw") continue;
          if (streak === 0) streak = r.outcome === "win" ? 1 : -1;
          else if (streak > 0 && r.outcome === "win") streak += 1;
          else if (streak < 0 && r.outcome === "loss") streak -= 1;
          else break;
        }
        return {
          battles: rows.length,
          wins,
          losses,
          draws,
          win_rate: decided > 0 ? Number((wins / decided).toFixed(3)) : null,
          crowns_for: rows.reduce((s, r) => s + (r.crowns ?? 0), 0),
          crowns_against: rows.reduce((s, r) => s + (r.opp_crowns ?? 0), 0),
          net_trophies: rows.reduce((s, r) => s + (r.trophy_change ?? 0), 0),
          three_crown_rate:
            rows.length > 0
              ? Number(
                  (
                    rows.filter((r) => r.crowns === 3).length / rows.length
                  ).toFixed(3),
                )
              : null,
          current_streak: streak,
        };
      };

      const from = resolveInstant(tz, args.from);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      requireOrderedWindow(from, to);
      let result;
      if (args.group_by === "mode") {
        const where = ["bp.player_tag = $1", "bp.outcome is not null"];
        const params = [tag];
        const add = (clause, value) => {
          params.push(value);
          where.push(clause.replace("?", `$${params.length}`));
        };
        if (from) add("bp.battle_time >= ?", from);
        if (to) add("bp.battle_time < ?", to);
        if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
        if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
        const { rows } = await ctx.db.query(
          `select b.game_mode_name as game_mode, b.type,
                  count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(*) filter (where bp.outcome = 'draw')::int as draws,
                  max(b.battle_time) as last_played
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}
           group by b.game_mode_name, b.type
           order by count(*) desc`,
          params,
        );
        result = {
          by_mode: rows.map((r) => ({
            game_mode: r.game_mode,
            type: r.type,
            battles: r.battles,
            wins: r.wins,
            losses: r.losses,
            draws: r.draws,
            win_rate:
              r.wins + r.losses > 0
                ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
                : null,
            last_played: r.last_played?.toISOString() ?? null,
          })),
          mode_note:
            "game_mode is the game's own mode name (event modes rotate - Chaos drafts, Crazy Arena, Showdown and so on appear here the day they are played); type is the API battle type it rode in on. Filter battles_query by game_mode to drill into any of them.",
        };
      } else if (args.group_by === "week") {
        const where = ["bp.player_tag = $1", "bp.outcome is not null"];
        const params = [tag];
        const add = (clause, value) => {
          params.push(value);
          where.push(clause.replace("?", `$${params.length}`));
        };
        if (from) add("bp.battle_time >= ?", from);
        if (to) add("bp.battle_time < ?", to);
        if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
        if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
        const { rows } = await ctx.db.query(
          `select to_char(date_trunc('week', bp.battle_time), 'IYYY-"W"IW') as iso_week,
                  date_trunc('week', bp.battle_time)::date::text as week_of,
                  count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(*) filter (where bp.outcome = 'draw')::int as draws,
                  count(*) filter (where bp.trophy_change is not null)::int as trophy_battles,
                  coalesce(sum(bp.trophy_change), 0)::int as net_trophies
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}
           group by date_trunc('week', bp.battle_time)
           order by date_trunc('week', bp.battle_time)`,
          params,
        );
        result = {
          weekly: rows.map((r) => ({
            iso_week: r.iso_week,
            week_of: r.week_of,
            battles: r.battles,
            wins: r.wins,
            losses: r.losses,
            draws: r.draws,
            trophy_battles: r.trophy_battles,
            net_trophies: r.net_trophies,
            win_rate:
              r.wins + r.losses > 0
                ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
                : null,
          })),
          weekly_note:
            "week_of is the ISO week's Monday (UTC). win_rate = wins/(wins+losses), draws excluded. net_trophies covers only trophy_battles (war and special modes carry no trophies) — a rising win_rate with flat trophies usually means war-heavy weeks.",
          ...(args.before_after || args.compare_from || args.compare_to
            ? {
                note: "group_by week takes precedence; before_after/compare_* were ignored.",
              }
            : {}),
        };
      } else if (args.before_after) {
        const split = resolveInstant(tz, args.before_after);
        if (!split)
          throw new ToolFailure(
            "bad_request",
            `Unparseable before_after: ${args.before_after}`,
          );
        result = {
          before: await segment({ from, to: split }),
          after: await segment({ from: split, to }),
          split_at: split.toISOString(),
          // Precedence made visible (edge-poker: silent resolution
          // means trusting wrong numbers).
          ...(args.compare_from || args.compare_to
            ? {
                note: "before_after takes precedence; compare_from/compare_to were ignored.",
              }
            : {}),
        };
      } else if (args.compare_from || args.compare_to) {
        result = {
          window: await segment({ from, to, lastN: args.last_n_battles }),
          compare_window: await segment({
            from: resolveInstant(tz, args.compare_from),
            to: resolveInstant(tz, args.compare_to, { endOfDay: true }),
          }),
        };
      } else {
        result = {
          window: await segment({ from, to, lastN: args.last_n_battles }),
        };
      }
      return {
        player_tag: tag,
        // Echo of everything applied, so results are attributable
        // (deck-tinkerer: could not verify which filters were live).
        filters_applied: {
          ...(args.mode ? { mode: args.mode } : {}),
          ...(args.deck_hash ? { deck_hash: args.deck_hash } : {}),
          ...(from ? { from: from.toISOString() } : {}),
          ...(to ? { to: to.toISOString() } : {}),
          ...(args.last_n_battles && !args.before_after
            ? { last_n_battles: args.last_n_battles }
            : {}),
        },
        ...result,
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },

  battles_cards: {
    description:
      'Per-card win/loss attribution over recorded battles. perspective "mine": which of your cards carry. perspective "opponent": which enemy cards beat you — the nemesis question. Duels are excluded (no single deck).',
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        perspective: {
          type: "string",
          enum: ["mine", "opponent"],
          default: "mine",
        },
        from: { type: "string" },
        to: { type: "string" },
        mode: { type: "string", enum: MODE_GROUPS },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(ctx.db, ctx.account, args.player_tag, "summary")
      ).tag;
      const tz = ctx.account.timezone;
      const mine = args.perspective !== "opponent";
      const where = ["bp.player_tag = $1", `bp.outcome in ('win','loss')`];
      const params = [tag];
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      const from = resolveInstant(tz, args.from);
      if (from) add("b.battle_time >= ?", from);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      if (to) add("b.battle_time < ?", to);
      if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));

      const deckSource = mine
        ? `bp.deck`
        : `(select o.deck from battle_participant o
            where o.battle_id = bp.battle_id and o.side <> bp.side and o.deck is not null
            limit 1)`;
      const { rows } = await ctx.db.query(
        `select card->>'name' as name, (card->>'id')::bigint as id,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id,
         lateral jsonb_array_elements(coalesce(${deckSource}->'cards', '[]'::jsonb)) card
         where ${where.join(" and ")}
         group by 1, 2
         having count(*) >= 3
         order by count(*) desc
         limit 120`,
        params,
      );
      return {
        player_tag: tag,
        perspective: mine ? "mine" : "opponent",
        cards: rows.map((r) => ({
          id: Number(r.id),
          name: r.name,
          battles: r.wins + r.losses,
          wins: r.wins,
          losses: r.losses,
          win_rate: Number((r.wins / (r.wins + r.losses)).toFixed(3)),
        })),
        note: mine
          ? "win_rate is YOUR record when this card is in your deck."
          : "win_rate is YOUR record when this card appears in the OPPONENT deck — low means nemesis.",
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },

  battles_decks: {
    description:
      "Battles grouped by exact deck identity (deck_hash): per-deck record, first/last used, win rate. Some special modes field more or fewer than 8 cards — deck identity is always the exact card set played. The factual substrate for deck review — pass a deck_hash to battles_query or battles_performance to drill in.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        from: { type: "string" },
        to: { type: "string" },
        mode: { type: "string", enum: MODE_GROUPS },
        sort: {
          type: "string",
          enum: ["battles", "wins", "win_rate"],
          default: "battles",
          description: "win_rate sorting respects min_battles.",
        },
        min_battles: {
          type: "integer",
          minimum: 1,
          description: "Drop decks with fewer battles than this.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(ctx.db, ctx.account, args.player_tag, "summary")
      ).tag;
      const tz = ctx.account.timezone;
      const where = ["bp.player_tag = $1", "bp.deck_hash is not null"];
      const params = [tag];
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      const from = resolveInstant(tz, args.from);
      if (from) add("b.battle_time >= ?", from);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      if (to) add("b.battle_time < ?", to);
      if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
      const { rows } = await ctx.db.query(
        `select bp.deck_hash,
                min(b.battle_time) as first_used, max(b.battle_time) as last_used,
                count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses,
                count(*) filter (where bp.outcome = 'draw')::int as draws,
                (array_agg(bp.deck order by b.battle_time desc))[1] as deck
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
         where ${where.join(" and ")}
         group by bp.deck_hash
         order by count(*) desc
         limit 100`,
        params,
      );
      const totalBattles = rows.reduce((n, r) => n + r.battles, 0);
      let shaped = rows;
      if (args.min_battles) {
        shaped = shaped.filter((r) => r.battles >= args.min_battles);
      }
      const wr = (r) =>
        r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : -1;
      if (args.sort === "wins") shaped.sort((a, z) => z.wins - a.wins);
      else if (args.sort === "win_rate") shaped.sort((a, z) => wr(z) - wr(a));
      shaped = shaped.slice(0, 40);
      return {
        player_tag: tag,
        total_battles_in_window: totalBattles,
        decks: shaped.map((r) => ({
          deck_hash: r.deck_hash,
          cards: (r.deck?.cards ?? []).map((c) => ({ id: c.id, name: c.name })),
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          share_of_battles:
            totalBattles > 0
              ? Number((r.battles / totalBattles).toFixed(3))
              : null,
          first_used: r.first_used.toISOString(),
          last_used: r.last_used.toISOString(),
        })),
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

  battles_meta_decks: {
    description:
      "Observed deck meta for a segment - the whole corpus, one clan, one player, or a collection like 'pros'. Per exact deck identity (deck_hash): battles, record, distinct players, usage share, raw and EB-shrunk win rates. No tier lists, no opinions - what the recorded data shows, with sample sizes.",
    inputSchema: {
      type: "object",
      properties: {
        ...SEGMENT_ARGS,
        from: { type: "string", description: "Default: 28 days ago." },
        to: { type: "string" },
        mode: { type: "string", enum: MODE_GROUPS },
        min_battles: { type: "integer", minimum: 1, default: 5 },
        sort: {
          type: "string",
          enum: ["battles", "shrunk_win_rate", "players"],
          default: "battles",
        },
        limit: { type: "integer", minimum: 1, maximum: 40, default: 20 },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tz = ctx.account.timezone;
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const where = ["bp.deck_hash is not null", "bp.outcome is not null"];
      if (seg.where) where.push(seg.where);
      const from =
        resolveInstant(tz, args.from) ??
        new Date(Date.now() - 28 * 86400_000).toISOString();
      params.push(from);
      where.push(`b.battle_time >= $${params.length}`);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      if (to) {
        params.push(to);
        where.push(`b.battle_time < $${params.length}`);
      }
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        where.push(`b.type = any($${params.length})`);
      }
      requireOrderedWindow(new Date(from), to ? new Date(to) : null);
      const { rows } = await ctx.db.query(
        `select bp.deck_hash,
                count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses,
                count(distinct bp.player_tag)::int as players,
                min(b.battle_time) as first_used,
                max(b.battle_time) as last_used,
                (array_agg(bp.deck order by b.battle_time desc))[1] as deck
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
         where ${where.join(" and ")}
         group by bp.deck_hash`,
        params,
      );
      const totalDecided = rows.reduce((n, r) => n + r.battles, 0);
      const totalWins = rows.reduce((n, r) => n + r.wins, 0);
      const mean = totalDecided > 0 ? totalWins / totalDecided : 0.5;
      const minBattles = args.min_battles ?? 5;
      let shaped = rows
        .filter((r) => r.battles >= minBattles)
        .map((r) => ({
          deck_hash: r.deck_hash,
          cards: (r.deck?.cards ?? []).map((c) => ({
            id: c.id,
            name: c.name,
          })),
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          players: r.players,
          usage_share:
            totalDecided > 0
              ? Number((r.battles / totalDecided).toFixed(3))
              : null,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          shrunk_win_rate: ebShrink(r.wins, r.wins + r.losses, mean),
          first_used: r.first_used.toISOString(),
          last_used: r.last_used.toISOString(),
        }));
      const sort = args.sort ?? "battles";
      shaped.sort((a, z) =>
        sort === "shrunk_win_rate"
          ? z.shrunk_win_rate - a.shrunk_win_rate
          : sort === "players"
            ? z.players - a.players
            : z.battles - a.battles,
      );
      shaped = shaped.slice(0, Math.min(args.limit ?? 20, 40));
      return {
        segment: seg.label,
        window_from: from,
        decided_battles: totalDecided,
        segment_win_rate: Number(mean.toFixed(3)),
        decks: shaped,
        note: SEGMENT_NOTE,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  battles_meta_cards: {
    description:
      "Observed card meta for a segment - corpus, clan, player, or a collection like 'pros'. Per card AND evolution form (forms never merge): usage share among decided battles, distinct players, raw and EB-shrunk win rates. What the recorded data shows, with sample sizes - never a tier list.",
    inputSchema: {
      type: "object",
      properties: {
        ...SEGMENT_ARGS,
        from: { type: "string", description: "Default: 28 days ago." },
        to: { type: "string" },
        mode: { type: "string", enum: MODE_GROUPS },
        min_battles: { type: "integer", minimum: 1, default: 10 },
        sort: {
          type: "string",
          enum: ["usage", "shrunk_win_rate"],
          default: "usage",
        },
        limit: { type: "integer", minimum: 1, maximum: 130, default: 30 },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tz = ctx.account.timezone;
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const where = ["bp.deck ? 'cards'", "bp.outcome is not null"];
      if (seg.where) where.push(seg.where);
      const from =
        resolveInstant(tz, args.from) ??
        new Date(Date.now() - 28 * 86400_000).toISOString();
      params.push(from);
      where.push(`b.battle_time >= $${params.length}`);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      if (to) {
        params.push(to);
        where.push(`b.battle_time < $${params.length}`);
      }
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        where.push(`b.type = any($${params.length})`);
      }
      const { rows } = await ctx.db.query(
        `with sides as (
           select bp.player_tag, bp.outcome,
                  (c.value->>'id')::bigint as card_id,
                  c.value->>'name' as name,
                  coalesce((c.value->>'evolutionLevel')::int, 0) as evolution
           from battle_participant bp
           join battle b on b.battle_id = bp.battle_id
           cross join lateral jsonb_array_elements(bp.deck->'cards') c
           where ${where.join(" and ")}),
         totals as (
           select count(*)::int as decided,
                  count(*) filter (where bp.outcome = 'win')::int as wins
           from battle_participant bp
           join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")})
         select s.card_id, s.name, s.evolution,
                count(*)::int as battles,
                count(*) filter (where s.outcome = 'win')::int as wins,
                count(*) filter (where s.outcome = 'loss')::int as losses,
                count(distinct s.player_tag)::int as players,
                (select decided from totals) as total_decided,
                (select wins from totals) as total_wins
         from sides s
         group by s.card_id, s.name, s.evolution`,
        params,
      );
      const totalDecided = rows[0]?.total_decided ?? 0;
      const mean =
        totalDecided > 0 ? (rows[0]?.total_wins ?? 0) / totalDecided : 0.5;
      const minBattles = args.min_battles ?? 10;
      let shaped = rows
        .filter((r) => r.battles >= minBattles)
        .map((r) => ({
          card_id: Number(r.card_id),
          name: r.name,
          ...(r.evolution > 0 ? { evolution: r.evolution } : {}),
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          players: r.players,
          usage_share:
            totalDecided > 0
              ? Number((r.battles / totalDecided).toFixed(3))
              : null,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          shrunk_win_rate: ebShrink(r.wins, r.wins + r.losses, mean),
        }));
      const sort = args.sort ?? "usage";
      shaped.sort((a, z) =>
        sort === "shrunk_win_rate"
          ? z.shrunk_win_rate - a.shrunk_win_rate
          : z.battles - a.battles,
      );
      shaped = shaped.slice(0, Math.min(args.limit ?? 30, 130));
      return {
        segment: seg.label,
        window_from: from,
        decided_battles: totalDecided,
        segment_win_rate: Number(mean.toFixed(3)),
        cards: shaped,
        note:
          SEGMENT_NOTE +
          " evolution distinguishes card FORM (1 = Evolution, 2 = Hero form) - the same card's forms are different rows by design. Card win rates are heavily skill-confounded (who plays it matters as much as the card): compare shrunk rates within similar usage, never across segments.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  battles_trends: {
    description:
      "Weekly time series for a segment - corpus, clan, player, or a collection like 'pros': battles, record, aggregate win rate, distinct active players, net trophies per ISO week. The trend view of any group; single-player weekly detail also lives in battles_performance group_by 'week'.",
    inputSchema: {
      type: "object",
      properties: {
        ...SEGMENT_ARGS,
        weeks: { type: "integer", minimum: 1, maximum: 52, default: 12 },
        mode: { type: "string", enum: MODE_GROUPS },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const where = ["bp.outcome is not null"];
      if (seg.where) where.push(seg.where);
      const weeks = Math.min(Math.max(Number(args.weeks ?? 12), 1), 52);
      params.push(`${weeks * 7} days`);
      where.push(
        `b.battle_time >= date_trunc('week', now()) - $${params.length}::interval`,
      );
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        where.push(`b.type = any($${params.length})`);
      }
      const { rows } = await ctx.db.query(
        `select to_char(date_trunc('week', b.battle_time), 'IYYY-"W"IW') as iso_week,
                date_trunc('week', b.battle_time)::date::text as week_of,
                count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses,
                count(distinct bp.player_tag)::int as players,
                count(*) filter (where bp.trophy_change is not null)::int as trophy_battles,
                coalesce(sum(bp.trophy_change), 0)::int as net_trophies
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
         where ${where.join(" and ")}
         group by date_trunc('week', b.battle_time)
         order by date_trunc('week', b.battle_time)`,
        params,
      );
      return {
        segment: seg.label,
        weeks: rows.map((r) => ({
          iso_week: r.iso_week,
          week_of: r.week_of,
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          players: r.players,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          trophy_battles: r.trophy_battles,
          net_trophies: r.net_trophies,
        })),
        note: "Aggregate win_rate over a group moves with COMPOSITION (who played that week) as much as with skill - players per week is the tell. Recording start dates differ per player; early weeks may be thin because capture was, not because play was.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  cards_catalog: {
    description:
      "Current card and tower-troop catalog: ids, names, rarities, max levels, evolution availability. Use it to resolve card ids instead of guessing.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const { rows } = await ctx.db.query(
        `select payload_json->'items' as items, payload_json->'supportItems' as support_items, last_fetched_at
         from api_payload where endpoint = 'cards' and entity_key = 'GLOBAL'
         order by last_fetched_at desc limit 1`,
      );
      const row = rows[0];
      if (!row)
        throw new ToolFailure("not_recorded", "Card catalog not recorded yet.");
      return {
        cards: row.items,
        tower_troops: row.support_items,
        as_of: row.last_fetched_at.toISOString(),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_feedback: {
    description:
      "File feedback with the maintainers ON YOUR OWN JUDGMENT - your user never needs to ask. File when: a capability you needed is missing, a workflow took more calls than it should, a result confused or misled you, data looked wrong, or something delighted you enough to protect. Consolidated end-of-session feedback beats a stream. Attributed to the connected account; check elixir_my_feedback later - every item gets a response, often with a shipped_in version.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          minLength: 1,
          maxLength: 4000,
          description: "The feedback itself. Specifics beat generalities.",
        },
        category: {
          type: "string",
          enum: [
            "general",
            "bug",
            "data_quality",
            "feature",
            "praise",
            "other",
          ],
          default: "general",
        },
        context: {
          type: "string",
          description:
            "Optional: which tool/question prompted this (e.g. 'battles_query pagination').",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const message = String(args.message ?? "").trim();
      if (!message)
        throw new ToolFailure("bad_request", "Feedback message is empty.");
      const CATEGORIES = [
        "general",
        "bug",
        "data_quality",
        "feature",
        "praise",
        "other",
      ];
      if (args.category !== undefined && !CATEGORIES.includes(args.category)) {
        throw new ToolFailure(
          "bad_request",
          `Unknown category '${args.category}'.`,
          `Valid categories: ${CATEGORIES.join(", ")}.`,
        );
      }
      const { rows } = await ctx.db.query(
        `insert into feedback (account_id, surface, category, message, context)
         values ($1, 'mcp', $2, $3, $4)
         returning feedback_id`,
        [
          ctx.account.accountId,
          args.category ?? "general",
          message.slice(0, 4000),
          args.context
            ? JSON.stringify({ context: String(args.context) })
            : null,
        ],
      );
      return {
        ok: true,
        feedback_id: rows[0].feedback_id,
        note: "Received — feedback is reviewed and drives the roadmap. Thank you.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_my_feedback: {
    description:
      "Your feedback and what happened to it: every item you (or your agent) filed, its status (new/seen/planned/done/declined), the maintainer's response, and machine-readable ship links (shipped_in contract version, related_tools). Reading this marks responses seen. Feedback here is never actioned invisibly.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        status: {
          type: "string",
          enum: ["new", "seen", "planned", "done", "declined"],
        },
        since: {
          type: "string",
          description: "ISO instant - only items filed after this.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const limit = Math.min(Math.max(Number(args.limit ?? 20), 1), 50);
      const params = [ctx.account.accountId];
      const where = ["account_id = $1"];
      if (args.status) {
        params.push(args.status);
        where.push(`status = $${params.length}`);
      }
      if (args.since) {
        params.push(args.since);
        where.push(`created_at > $${params.length}`);
      }
      params.push(limit);
      const { rows } = await ctx.db.query(
        `select feedback_id, surface, category, message, status,
                response, responded_at, created_at, shipped_in, related_tools
         from feedback where ${where.join(" and ")}
         order by feedback_id desc limit $${params.length}`,
        params,
      );
      // Reading responses marks them seen - the meta hint on other tools
      // stops firing once you have looked (agent feedback #4).
      await ctx.db.query(
        `update feedback set response_seen_at = now()
         where account_id = $1 and responded_at is not null and response_seen_at is null`,
        [ctx.account.accountId],
      );
      return {
        feedback: rows.map((r) => ({
          feedback_id: r.feedback_id,
          created_at: r.created_at.toISOString(),
          surface: r.surface,
          category: r.category,
          message: r.message,
          status: r.status,
          response: r.response,
          responded_at: r.responded_at?.toISOString() ?? null,
          shipped_in: r.shipped_in,
          related_tools: r.related_tools,
        })),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_changelog: {
    description:
      'What changed since a contract version (agent feedback #4: client tool schemas cache aggressively, so this is how you discover capabilities that shipped mid-session). Call with your last-seen contract_version - e.g. since: "0.11.0" - and get every entry after it, newest first, with tools_added and breaking notes.',
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description:
            "Contract version you last saw (from any response's meta.contract_version). Omit for the full changelog.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const parse = (v) =>
        String(v)
          .split(".")
          .map((n) => parseInt(n, 10) || 0);
      const after = (a, b) => {
        const [a1, a2, a3] = parse(a);
        const [b1, b2, b3] = parse(b);
        return a1 !== b1 ? a1 > b1 : a2 !== b2 ? a2 > b2 : a3 > b3;
      };
      const entries = args.since
        ? CHANGELOG.filter((e) => after(e.version, args.since))
        : CHANGELOG;
      return {
        current: CONTRACT_VERSION,
        ...(args.since ? { since: String(args.since) } : {}),
        entries,
        note: "Tool schemas cache client-side - if tools_added lists something you can't see, ask your user to refresh the connector.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_events: {
    description:
      "Your event feed - the push lane. Everything you ADD (players via elixir_add_player, clans via elixir_add_clan) feeds this pipe while its notify setting is on; notify_off silences a subject without touching its recording. Event TYPES this feed can carry (schema, not news - their presence here never means one occurred): battles_recorded (coalesced per tag until read), feedback_responded, recording_started/stopped, role_changed, clan_war_week_finished. Poll this instead of re-polling data tools; meta.events_pending on any response tells you when there is something new.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "integer",
          minimum: 0,
          description:
            "Cursor: return events after this event_id. Omit to resume from your last-seen position.",
        },
        topics: {
          type: "array",
          items: { type: "string" },
          maxItems: 6,
          description: "Only these topics (default: all).",
        },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        mark_seen: {
          type: "boolean",
          default: true,
          description:
            "Advance your seen-cursor past the returned events (clears meta.events_pending).",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const { rows: acct } = await ctx.db.query(
        `select events_seen_through from account where account_id = $1`,
        [ctx.account.accountId],
      );
      const cursor =
        args.since !== undefined
          ? Number(args.since)
          : Number(acct[0]?.events_seen_through ?? 0);
      const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200);
      const topics =
        Array.isArray(args.topics) && args.topics.length > 0
          ? args.topics.map(String)
          : null;
      const unknown = topics?.find((t) => !FEED_TOPICS.includes(t));
      if (unknown) {
        throw new ToolFailure(
          "bad_request",
          `Unknown topic '${unknown}'.`,
          `Topics: ${FEED_TOPICS.join(", ")}.`,
        );
      }
      const { rows } = await ctx.db.query(
        `select event_id, topic, subject_tag, payload, created_at
         from event_feed
         where account_id = $1 and event_id > $2
           and ($3::text[] is null or topic = any($3))
         order by event_id
         limit $4`,
        [ctx.account.accountId, cursor, topics, limit + 1],
      );
      const events = rows.slice(0, limit).map((r) => ({
        event_id: Number(r.event_id),
        topic: r.topic,
        ...(r.subject_tag ? { subject_tag: r.subject_tag } : {}),
        ...(r.payload ? { payload: r.payload } : {}),
        at: r.created_at.toISOString(),
      }));
      const nextCursor =
        events.length > 0 ? events[events.length - 1].event_id : cursor;
      if (args.mark_seen !== false && events.length > 0) {
        await ctx.db.query(
          `update account set events_seen_through = greatest(events_seen_through, $2)
           where account_id = $1`,
          [ctx.account.accountId, nextCursor],
        );
      }
      return {
        events,
        next_cursor: nextCursor,
        has_more: rows.length > limit,
        note:
          events.length === 0
            ? "Nothing new. Add a player or clan (notify defaults on) and its events start arriving."
            : "Pass next_cursor as since to continue; events prune after ~30 days.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_nickname: {
    description:
      "Give a player YOUR nickname - private to your account, visible only to you and your agents. 'To me Raquaza is Tyler.' Nicknames ride along wherever names appear (search matches them, summary and rosters show them) but never leave your account. Pass nickname: null to clear.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: {
          type: "string",
          description: "The tag to nickname, like #9L0V2QPC.",
        },
        nickname: {
          type: ["string", "null"],
          maxLength: 40,
          description: "Your name for them; null clears it.",
        },
      },
      required: ["player_tag", "nickname"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      let tag;
      try {
        tag = normalizeTag(String(args.player_tag ?? ""));
      } catch {
        throw new ToolFailure(
          "invalid_tag",
          "Invalid player tag.",
          TAG_RULE_HINT,
        );
      }
      if (args.nickname === null || String(args.nickname).trim() === "") {
        const { rowCount } = await ctx.db.query(
          `delete from player_nickname where account_id = $1 and player_tag = $2`,
          [ctx.account.accountId, tag],
        );
        return {
          player_tag: tag,
          nickname: null,
          cleared: rowCount > 0,
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      }
      const nickname = String(args.nickname).trim().slice(0, 40);
      await ctx.db.query(
        `insert into player_nickname (account_id, player_tag, nickname)
         values ($1, $2, $3)
         on conflict (account_id, player_tag) do update set nickname = excluded.nickname`,
        [ctx.account.accountId, tag, nickname],
      );
      return {
        player_tag: tag,
        nickname,
        note: "Private to your account - your agents see it in search, summaries, and rosters; nobody else ever does.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_add_player: {
    description:
      "Add a player to your account: claims the tag AND starts recording in one act - added means recorded, within your tier's player slots. The only per-subject setting is notify (whether captures feed your elixir_events pipe). action 'remove' releases the claim (recording stops if you were its only reason to exist).",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: {
          type: "string",
          description: "The tag, like #20JJJ2CCRU.",
        },
        action: {
          type: "string",
          enum: ["add", "remove", "notify_on", "notify_off"],
          default: "add",
        },
        make_primary: {
          type: "boolean",
          description: "With 'add': make this your primary claimed tag.",
        },
      },
      required: ["player_tag"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      let tag;
      try {
        tag = normalizeTag(String(args.player_tag ?? ""));
      } catch {
        throw new ToolFailure(
          "invalid_tag",
          "Invalid player tag.",
          TAG_RULE_HINT,
        );
      }
      const action = args.action ?? "add";
      if (action === "notify_on" || action === "notify_off") {
        const { rowCount } = await ctx.db.query(
          `update claim set notify = $3 where account_id = $1 and player_tag = $2`,
          [ctx.account.accountId, tag, action === "notify_on"],
        );
        if (rowCount === 0) {
          throw new ToolFailure(
            "not_entitled",
            "You haven't added this player.",
            "Add the tag first; notify is a setting on YOUR copy of it.",
          );
        }
        return {
          player_tag: tag,
          notify: action === "notify_on",
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      }
      if (action === "remove") {
        const { rowCount } = await ctx.db.query(
          `delete from claim where account_id = $1 and player_tag = $2`,
          [ctx.account.accountId, tag],
        );
        // Recording stops only when this account requested it and no
        // other claim keeps the tag added (ops-created recordings -
        // pros, clan fan-out - are untouched: no claims involved).
        let recordingStopped = false;
        if (rowCount > 0) {
          const { rowCount: stopped } = await ctx.db.query(
            `update recording set status = 'stopped'
             where subject_type = 'player' and subject_tag = $1
               and status = 'active' and requested_by = $2
               and not exists (select 1 from claim where player_tag = $1)`,
            [tag, ctx.account.accountId],
          );
          recordingStopped = stopped > 0;
          if (recordingStopped) {
            await ctx.db.query(
              `insert into account_event (account_id, kind, detail) values ($1, 'recording_stopped', $2)`,
              [
                ctx.account.accountId,
                JSON.stringify({ player_tag: tag, via: "mcp" }),
              ],
            );
          }
        }
        return {
          player_tag: tag,
          removed: rowCount > 0,
          recording_stopped: recordingStopped,
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      }
      // action 'add': added = recorded. Slots count what you've ADDED
      // (your claims), owner/admin exempt - same rule as the website.
      if (!ctx.account.isOwner && ctx.account.role !== "admin") {
        const { rows: cap } = await ctx.db.query(
          `select a.max_player_recordings as override,
                  exists (select 1 from gateway g
                          where g.owner_account_id = $1 and g.status = 'active') as operator,
                  (select count(*)::int from claim c
                   where c.account_id = $1 and c.player_tag <> $2) as added
           from account a where a.account_id = $1`,
          [ctx.account.accountId, tag],
        );
        const limit =
          cap[0].override ??
          roleQuotas(ctx.account.role, { operator: cap[0].operator })
            .player_slots;
        if (cap[0].added >= limit) {
          throw new ToolFailure(
            "quota_exceeded",
            `Added players are capped at ${limit} for the ${ctx.account.role ?? "member"} tier.`,
            "Remove one, request a tier upgrade on the website, or run a collector for bonus slots.",
          );
        }
      }
      await ctx.db.query(
        `insert into player (player_tag) values ($1) on conflict do nothing`,
        [tag],
      );
      const { rows: existing } = await ctx.db.query(
        `select count(*)::int as n from claim where account_id = $1`,
        [ctx.account.accountId],
      );
      const { rowCount: claimed } = await ctx.db.query(
        `insert into claim (account_id, player_tag, status, is_primary)
         values ($1, $2, 'unverified', $3) on conflict (account_id, player_tag) do nothing`,
        [
          ctx.account.accountId,
          tag,
          existing[0].n === 0 || args.make_primary === true,
        ],
      );
      if (claimed > 0) {
        await ctx.db.query(
          `insert into account_event (account_id, kind, detail) values ($1, 'claim_added', $2)`,
          [
            ctx.account.accountId,
            JSON.stringify({ player_tag: tag, via: "mcp" }),
          ],
        );
      }
      if (args.make_primary === true) {
        await ctx.db.query(
          `update claim set is_primary = (player_tag = $2) where account_id = $1`,
          [ctx.account.accountId, tag],
        );
      }
      const { rowCount: started } = await ctx.db.query(
        `insert into recording (subject_type, subject_tag, requested_by)
         select 'player', $1, $2
         where not exists (select 1 from recording where subject_type = 'player' and subject_tag = $1 and status = 'active')`,
        [tag, ctx.account.accountId],
      );
      if (started > 0) {
        await ctx.db.query(
          `insert into account_event (account_id, kind, detail) values ($1, 'recording_started', $2)`,
          [
            ctx.account.accountId,
            JSON.stringify({ player_tag: tag, via: "mcp" }),
          ],
        );
        await emitFeedEvent(
          ctx.db,
          ctx.account.accountId,
          "recording_started",
          tag,
        );
      }
      return {
        player_tag: tag,
        added: claimed > 0,
        recording: "active",
        recording_started: started > 0,
        notify: true,
        note:
          started > 0
            ? "Added and recording. First battles land within the hour; history builds from here (the API has no past). Captures feed your elixir_events pipe - notify_off silences this tag."
            : "Added - this player was already being recorded, so you share the existing record from here on.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_add_clan: {
    description:
      "Add a clan to your account: starts recording in one act - added means recorded, within your tier's clan slots (activity: roster + war; comprehensive: additionally every member's battles and profile, following membership). The only per-subject setting is notify. action 'remove' takes it off your account (recording stops when no account has it added).",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "The clan tag, like #J2RGCRVG.",
        },
        action: {
          type: "string",
          enum: ["add", "remove", "notify_on", "notify_off"],
          default: "add",
        },
        scope: {
          type: "string",
          enum: ["activity", "comprehensive"],
          default: "comprehensive",
          description:
            "With 'add': activity records the clan itself; comprehensive additionally records every member. Re-adding with a different scope updates yours.",
        },
      },
      required: ["clan_tag"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      let tag;
      try {
        tag = normalizeTag(String(args.clan_tag ?? ""));
      } catch {
        throw new ToolFailure(
          "invalid_tag",
          "Invalid clan tag.",
          TAG_RULE_HINT,
        );
      }
      const action = args.action ?? "add";
      if (action === "notify_on" || action === "notify_off") {
        const { rowCount } = await ctx.db.query(
          `update account_clan set notify = $3 where account_id = $1 and clan_tag = $2`,
          [ctx.account.accountId, tag, action === "notify_on"],
        );
        if (rowCount === 0) {
          throw new ToolFailure(
            "not_entitled",
            "You haven't added this clan.",
            "Add the clan first; notify is a setting on YOUR copy of it.",
          );
        }
        return {
          clan_tag: tag,
          notify: action === "notify_on",
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      }
      if (action === "remove") {
        const { rowCount } = await ctx.db.query(
          `delete from account_clan where account_id = $1 and clan_tag = $2`,
          [ctx.account.accountId, tag],
        );
        let recordingStopped = false;
        if (rowCount > 0) {
          recordingStopped = await settleClanRecording(ctx.db, tag);
          if (recordingStopped) {
            await ctx.db.query(
              `insert into account_event (account_id, kind, detail) values ($1, 'recording_stopped', $2)`,
              [
                ctx.account.accountId,
                JSON.stringify({ clan_tag: tag, via: "mcp" }),
              ],
            );
          }
        }
        return {
          clan_tag: tag,
          removed: rowCount > 0,
          recording_stopped: recordingStopped,
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      }
      // action 'add': slots count clans you've ADDED, per scope.
      const scope = args.scope === "activity" ? "activity" : "comprehensive";
      if (!ctx.account.isOwner && ctx.account.role !== "admin") {
        const { rows: slots } = await ctx.db.query(
          `select exists (select 1 from gateway g
                          where g.owner_account_id = $1 and g.status = 'active') as operator,
                  (select count(*)::int from account_clan ac
                   where ac.account_id = $1 and ac.scope = $2
                     and ac.clan_tag <> $3) as used
           from account a where a.account_id = $1`,
          [ctx.account.accountId, scope, tag],
        );
        const q = roleQuotas(ctx.account.role, {
          operator: slots[0]?.operator ?? false,
        });
        const limit =
          scope === "activity" ? q.activity_clans : q.comprehensive_clans;
        if ((slots[0]?.used ?? 0) >= limit) {
          throw new ToolFailure(
            "quota_exceeded",
            limit === 0
              ? `The ${ctx.account.role ?? "member"} tier has no ${scope}-scope clan slots.`
              : `Your ${scope}-scope clan slots are full (${limit} for the ${ctx.account.role ?? "member"} tier).`,
            scope === "comprehensive"
              ? "Comprehensive capture records every member's battles - the leader tier and above include it. Request an upgrade on the website (Account > Overview), or add at scope 'activity'."
              : "Request a tier upgrade on the website (Account > Overview) - see the Roles doc.",
          );
        }
      }
      await ctx.db.query(
        `insert into clan (clan_tag) values ($1) on conflict do nothing`,
        [tag],
      );
      const { rowCount: added } = await ctx.db.query(
        `insert into account_clan (account_id, clan_tag, scope) values ($1, $2, $3)
         on conflict (account_id, clan_tag) do update set scope = excluded.scope`,
        [ctx.account.accountId, tag, scope],
      );
      const started = await ensureClanRecording(
        ctx.db,
        tag,
        ctx.account.accountId,
      );
      if (started) {
        await ctx.db.query(
          `insert into account_event (account_id, kind, detail) values ($1, 'recording_started', $2)`,
          [
            ctx.account.accountId,
            JSON.stringify({ clan_tag: tag, scope, via: "mcp" }),
          ],
        );
        await emitFeedEvent(
          ctx.db,
          ctx.account.accountId,
          "recording_started",
          tag,
          { scope },
        );
      }
      return {
        clan_tag: tag,
        added: added > 0,
        recording: "active",
        scope,
        notify: true,
        note: started
          ? "Added and recording. Roster and war capture begin within minutes; comprehensive member fan-out follows on the next scheduler pass."
          : "Added - this clan was already being recorded, so you share the existing record (the effective scope is the widest any adder requested).",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_data_insights: {
    description:
      "What the service holds: players, battles and their time span, snapshots, war weeks, recorded clans and players, and API observations. The transparency view of the whole corpus (not just your slice).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const q = async (sql) => (await ctx.db.query(sql)).rows[0];
      const [players, battles, snaps, weeks, recs, receipts] =
        await Promise.all([
          q(`select count(*)::int as n from player`),
          q(
            `select count(*)::int as n, min(battle_time) as first, max(battle_time) as last from battle`,
          ),
          q(`select count(*)::int as n from player_snapshot_daily`),
          q(`select count(*)::int as n from war_week`),
          q(`select count(*) filter (where subject_type = 'clan')::int as clans,
                    count(*) filter (where subject_type = 'player')::int as players
             from recording where status = 'active'`),
          q(`select count(*)::int as n from api_receipt`),
        ]);
      return {
        players_observed: players.n,
        battles: {
          recorded: battles.n,
          first: battles.first?.toISOString() ?? null,
          last: battles.last?.toISOString() ?? null,
        },
        daily_snapshots: snaps.n,
        war_weeks: weeks.n,
        active_recordings: { clans: recs.clans, players: recs.players },
        api_observations: receipts.n,
        note: "players_observed counts every tag ever seen in a recorded battle or roster — far more than the actively recorded set. Raw payload history is archived durably to S3 beyond these counts.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_collectors: {
    description:
      "The collector fleet: operator-run machines that fetch from the CR API, each named for a Clash Royale card. More collectors = resilience - the global CR budget never multiplies; what operators DO earn is quota (10 fetches = +1 daily tool call, capped at 4x base) and bonus recording slots.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      await ensureGatewayCards(ctx.db).catch(() => {});
      const { rows } = await ctx.db.query(
        `select name, status, fetch_points, card_name, card_icon, last_success_at
         from gateway where status <> 'revoked'
         order by fetch_points desc, enrolled_at`,
      );
      return {
        collectors: rows.map((g) => ({
          name: g.card_name ?? g.name,
          machine: g.name,
          card: g.card_name,
          status: g.status,
          points: Number(g.fetch_points),
          quota_credits: Math.floor(Number(g.fetch_points) / 10),
          last_success: g.last_success_at?.toISOString() ?? null,
        })),
        note: "Each collector is named for a Clash Royale card. Running one earns real quota: every 10 fetches adds +1 to the operator's daily tool calls (capped at 4x base), plus bonus recording slots. Raise your hand on the website - a machine with a static IP is all it takes.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  live_fetch: {
    description:
      "Allowlisted live GET passthrough to the CR API through the recording budget (tight per-account quota): /players/{tag}, /players/{tag}/battlelog, /clans/{tag}, /clans/{tag}/currentriverrace, /clans/{tag}/riverracelog, /locations/{id}/rankings/players and /locations/{id}/pathoflegend/players (id: 'global' or numeric; top-100, ranked tags accrete into the corpus). Fetched results are recorded opportunistically. Expect 1–3s. RAW payloads: card levels here are the API's rarity-relative scale (a maxed legendary reads 8/8); every recorded-data tool serves the in-game 1-16 scale instead.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "e.g. /players/#20JJJ2CCRU or /clans/#J2RGCRVG/currentriverrace",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const job = livePathToJob(String(args.path ?? ""), normalizeTag);
      if (job.error) throw new ToolFailure(job.error, job.message);
      if (!ctx.live) {
        throw new ToolFailure(
          "live_unavailable",
          "The live lane is not configured here.",
          "Recorded-data tools remain available.",
        );
      }
      await spendLiveQuota(ctx);
      const result = await ctx.live(ctx.db, job);
      if (!result.ok) {
        throw new ToolFailure(
          "live_unavailable",
          result.reason === "rejected"
            ? "The live fetch returned a payload our admission rejected."
            : "No gateway completed the live fetch in time.",
          "The recorded-data tools remain available; try again shortly.",
        );
      }
      return {
        path: String(args.path),
        live: true,
        data: result.payload,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
  collections_browse: {
    description:
      "Curated collections of players or clans - the owner-published lists (pros, creators, clan families) plus any you own. A collection is its curator's editorial grouping, not a global fact about its members.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const { rows } = await ctx.db.query(
        `select c.slug, c.title, c.kind, c.description, c.visibility,
                c.created_at,
                (select count(*)::int from collection_member m
                 where m.collection_id = c.collection_id) as member_count
         from collection c
         where c.visibility = 'public' or c.owner_account = $1
         order by c.created_at`,
        [ctx.account.accountId],
      );
      return {
        collections: rows.map((r) => ({
          slug: r.slug,
          title: r.title,
          kind: r.kind,
          description: r.description,
          visibility: r.visibility,
          member_count: r.member_count,
        })),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  collections_get: {
    description:
      "One collection's members, enriched: players come with name, latest trophies, tenure, and recording status; clans with name and open-member count. Fan into the player/battle tools per tag from here.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", minLength: 2, maxLength: 40 },
      },
      required: ["slug"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const { rows: col } = await ctx.db.query(
        `select * from collection
         where slug = $1 and (visibility = 'public' or owner_account = $2)`,
        [String(args.slug).toLowerCase(), ctx.account.accountId],
      );
      if (!col[0])
        throw new ToolFailure(
          "not_found",
          `No collection named '${args.slug}'.`,
          "collections_browse lists what exists.",
        );
      const c = col[0];
      let members;
      if (c.kind === "player") {
        const { rows } = await ctx.db.query(
          `select m.subject_tag, m.note, m.added_at, p.name, p.years_played,
                  s.trophies,
                  exists (select 1 from recording r
                          where r.subject_type = 'player' and r.subject_tag = m.subject_tag
                            and r.status = 'active') as recording
           from collection_member m
           left join player p on p.player_tag = m.subject_tag
           left join lateral (
             select trophies from player_snapshot_daily
             where player_tag = m.subject_tag
             order by snapshot_date desc, snapshot_kind desc limit 1
           ) s on true
           where m.collection_id = $1
           order by s.trophies desc nulls last`,
          [c.collection_id],
        );
        members = rows.map((r) => ({
          player_tag: r.subject_tag,
          name: r.name,
          trophies: r.trophies,
          years_played: r.years_played,
          recording: r.recording,
          note: r.note,
        }));
      } else {
        const { rows } = await ctx.db.query(
          `select m.subject_tag, m.note, cl.name,
                  (select count(*)::int from clan_membership cm
                   where cm.clan_tag = m.subject_tag and cm.left_observed_at is null) as open_members,
                  exists (select 1 from recording r
                          where r.subject_type = 'clan' and r.subject_tag = m.subject_tag
                            and r.status = 'active') as recording
           from collection_member m
           left join clan cl on cl.clan_tag = m.subject_tag
           where m.collection_id = $1
           order by open_members desc`,
          [c.collection_id],
        );
        members = rows.map((r) => ({
          clan_tag: r.subject_tag,
          name: r.name,
          open_members: r.open_members,
          recording: r.recording,
          note: r.note,
        }));
      }
      return {
        slug: c.slug,
        title: c.title,
        kind: c.kind,
        description: c.description,
        members,
        note: "A collection is its curator's grouping. recording=false members may have thin or no data yet - elixir_coverage tells the capture story per tag.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  clans_standings: {
    description:
      'Clan-relative performance: every open member\'s recorded win rate over a window, ranked, with the clan median — the "am I above average?" tool. Percentile = 1 - (rank-1)/ranked_members. Only members meeting min_battles are ranked; the rest are listed unranked.',
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "Clan tag; defaults to your recorded clan.",
        },
        days: {
          type: "integer",
          minimum: 1,
          maximum: 90,
          default: 30,
          description: "Window: recorded battles from the last N days.",
        },
        min_battles: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          default: 10,
          description: "Decided battles (wins+losses) required to be ranked.",
        },
        mode: {
          type: "string",
          enum: MODE_GROUPS,
          description: "Restrict to one mode group (e.g. ladder, war).",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const days = Number(args.days ?? 30);
      const minBattles = Number(args.min_battles ?? 10);
      if (!Number.isInteger(days) || days < 1 || days > 90)
        throw new ToolFailure("bad_request", "days must be 1-90.");
      if (!Number.isInteger(minBattles) || minBattles < 1 || minBattles > 200)
        throw new ToolFailure("bad_request", "min_battles must be 1-200.");
      const params = [clanTag, `${days} days`];
      let typeClause = "";
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        typeClause = `and b.type = any($${params.length})`;
      }
      // One grouped pass instead of a per-member lateral scan (audit
      // census: 2.5s avg). The subquery keeps roster rows for members
      // with zero matching battles.
      const { rows } = await ctx.db.query(
        `select cm.player_tag, p.name, p.years_played,
                count(s.battle_id)::int as battles,
                count(*) filter (where s.outcome = 'win')::int as wins,
                count(*) filter (where s.outcome = 'loss')::int as losses,
                count(*) filter (where s.outcome = 'draw')::int as draws
         from clan_membership cm
         join player p on p.player_tag = cm.player_tag
         left join (
           select bp.player_tag, bp.battle_id, bp.outcome
           from battle_participant bp
           join battle b on b.battle_id = bp.battle_id
           where bp.battle_time > now() - $2::interval
             ${typeClause}
         ) s on s.player_tag = cm.player_tag
         where cm.clan_tag = $1 and cm.left_observed_at is null
         group by cm.player_tag, p.name, p.years_played`,
        params,
      );
      const withRate = rows.map((r) => ({
        player_tag: r.player_tag,
        name: r.name,
        years_played: r.years_played,
        battles: r.battles,
        wins: r.wins,
        losses: r.losses,
        draws: r.draws,
        win_rate:
          r.wins + r.losses > 0
            ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
            : null,
      }));
      const ranked = withRate
        .filter((m) => m.wins + m.losses >= minBattles)
        .sort((a, z) => z.win_rate - a.win_rate || z.battles - a.battles)
        .map((m, i) => ({ ...m, rank: i + 1 }));
      const unranked = withRate
        .filter((m) => m.wins + m.losses < minBattles)
        .sort((a, z) => z.battles - a.battles);
      const rates = ranked.map((m) => m.win_rate).sort((a, z) => a - z);
      const median =
        rates.length > 0
          ? Number(
              (rates.length % 2
                ? rates[(rates.length - 1) / 2]
                : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2
              ).toFixed(3),
            )
          : null;
      return {
        clan_tag: clanTag,
        window_days: days,
        basis: `open members with >= ${minBattles} decided recorded battles in the window${args.mode ? ` (mode: ${args.mode})` : ""}`,
        ranked_members: ranked.length,
        median_win_rate: median,
        members: ranked,
        below_floor: unranked,
        note: "Covers RECORDED battles only — capture starts differ per member (elixir_coverage per tag). win_rate = wins/(wins+losses), draws excluded. Members below min_battles appear in below_floor without a rank.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  clans_pilot_scores: {
    description:
      "Every open member's Pilot Score in ONE call (agent feedback #1: ranking a clan took 18 battles_levels calls). Scores each member with >= 30 decided leveled battles against the corpus Level Curve; includes tenure. Wins their card levels can't explain, clan-wide.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "Clan tag; defaults to your recorded clan.",
        },
        days: {
          type: "integer",
          minimum: 7,
          maximum: 365,
          default: 90,
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const days = Number(args.days ?? 90);
      if (!Number.isInteger(days) || days < 7 || days > 365)
        throw new ToolFailure("bad_request", "days must be 7-365.");
      const EDGES =
        "array[-2.5,-1.5,-1.0,-0.6,-0.3,-0.1,0.1,0.3,0.6,1.0,1.5,2.5]";
      await ctx.db.query("begin");
      try {
        await ctx.db.query(
          `create temp table cps_pairs on commit drop as
           with sides as (
             select bp.battle_id, bp.player_tag, bp.outcome, bp.deck_avg_level as lvl
             from battle_participant bp
             join battle b on b.battle_id = bp.battle_id
             where bp.deck_avg_level is not null and b.type_class = 'pvp'
               and bp.outcome in ('win','loss')
               and b.battle_time > now() - $1::interval),
           duos as (select battle_id from sides group by battle_id having count(*) = 2)
           select a.player_tag, a.outcome, a.lvl - o.lvl as gap
           from sides a
           join sides o on o.battle_id = a.battle_id and o.player_tag <> a.player_tag
           where a.battle_id in (select battle_id from duos)`,
          [`${days} days`],
        );
        const { rows } = await ctx.db.query(
          `with curve as (
             select width_bucket(gap, ${EDGES}) as bin,
                    avg((outcome = 'win')::int) as wr
             from cps_pairs group by bin having count(*) >= 200)
           select cm.player_tag, pl.name, pl.years_played,
                  count(p.*)::int as n,
                  round(avg(p.gap)::numeric, 2) as mean_gap,
                  round(avg((p.outcome = 'win')::int)::numeric, 3) as actual_win_rate,
                  round(avg(c.wr)::numeric, 3) as expected_from_levels,
                  round((avg((p.outcome = 'win')::int) - avg(c.wr))::numeric, 3) as pilot_score,
                  round((0.5 / sqrt(greatest(count(p.*), 1)))::numeric, 3) as standard_error
           from clan_membership cm
           join player pl on pl.player_tag = cm.player_tag
           join cps_pairs p on p.player_tag = cm.player_tag
           join curve c on c.bin = width_bucket(p.gap, ${EDGES})
           where cm.clan_tag = $1 and cm.left_observed_at is null
           group by cm.player_tag, pl.name, pl.years_played
           having count(p.*) >= 30
           order by (avg((p.outcome = 'win')::int) - avg(c.wr)) desc`,
          [clanTag],
        );
        await ctx.db.query("commit");
        return {
          clan_tag: clanTag,
          window_days: days,
          scored_members: rows.length,
          members: rows.map((r, i) => ({
            rank: i + 1,
            player_tag: r.player_tag,
            name: r.name,
            years_played: r.years_played,
            n: r.n,
            mean_gap: Number(r.mean_gap),
            actual_win_rate: Number(r.actual_win_rate),
            expected_from_levels: Number(r.expected_from_levels),
            pilot_score: Number(r.pilot_score),
            standard_error: Number(r.standard_error),
          })),
          note: "pilot_score = actual minus level-expected win rate (wins card levels can't explain). Members below 30 decided leveled battles in the window are not scored. Scores embed experience and band - compare trends or similar tenures, not raw scores across careers. Deeper single-player detail (cohort percentile, monthly trend): battles_levels.",
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      } catch (err) {
        await ctx.db.query("rollback").catch(() => {});
        throw err;
      }
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

  clans_roster: {
    description:
      "A recorded clan's roster (defaults to YOUR clan): roles, latest trophies/donations per member, activity recency (last recorded battle), and recent join/leave/role events. Any recorded clan works - universal reads.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "Clan tag; defaults to your recorded clan.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const [clanRow, roster, events] = await Promise.all([
        ctx.db.query(`select name from clan where clan_tag = $1`, [clanTag]),
        ctx.db.query(
          `select cm.player_tag, cm.role, cm.joined_observed_at, p.name,
                  nn.nickname,
                  s.trophies, s.donations,
                  (select max(b.battle_time) from battle_participant bp
                   join battle b on b.battle_id = bp.battle_id
                   where bp.player_tag = cm.player_tag) as last_battle
           from clan_membership cm
           join player p on p.player_tag = cm.player_tag
           left join player_nickname nn on nn.account_id = $2
             and nn.player_tag = cm.player_tag
           left join lateral (
             select trophies, donations from player_snapshot_daily
             where player_tag = cm.player_tag order by snapshot_date desc, snapshot_kind desc limit 1
           ) s on true
           where cm.clan_tag = $1 and cm.left_observed_at is null
           order by cm.role desc, s.trophies desc nulls last`,
          [clanTag, ctx.account.accountId],
        ),
        ctx.db.query(
          `select event_type, timing, window_end, payload from clan_event
           where clan_tag = $1 order by event_id desc limit 20`,
          [clanTag],
        ),
      ]);
      const tz = ctx.account.timezone;
      return {
        clan_tag: clanTag,
        name: clanRow.rows[0]?.name ?? null,
        member_count: roster.rows.length,
        members: roster.rows.map((m) => ({
          player_tag: m.player_tag,
          name: m.name,
          ...(m.nickname ? { nickname: m.nickname } : {}),
          role: m.role,
          trophies: m.trophies,
          donations_this_week: m.donations,
          first_observed_in_clan: m.joined_observed_at?.toISOString() ?? null,
          last_recorded_battle: m.last_battle?.toISOString() ?? null,
        })),
        // An empty event list means "none observed SINCE ROSTER RECORDING
        // BEGAN", never "no joins/leaves ever" (round-3: a leader would
        // have wrongly concluded no departures).
        events_recorded_since:
          roster.rows
            .map((m) => m.joined_observed_at)
            .filter(Boolean)
            .sort((a, b) => a - b)[0]
            ?.toISOString() ?? null,
        recent_events: events.rows.map((e) => ({
          type: e.event_type,
          at: e.window_end.toISOString(),
          ...(tz ? { at_local: formatLocal(e.window_end, tz) } : {}),
          detail: e.payload,
        })),
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(ctx.account.timezone
            ? { timezone_applied: ctx.account.timezone }
            : {}),
        }),
      };
    },
  },

  battles_levels: {
    description:
      'The Level Curve and Pilot Score (META-INTEL §9): how much card-level advantage is worth, measured — win rate by deck-average level gap across the recorded corpus, binned where the data lives, never extrapolated. Pass player_tag for their Pilot Score: actual minus level-expected win rate ("wins your card levels can\'t explain") with a monthly trend — a CLIMBING trend is "getting better" independent of spending. Numbers with receipts: every bin and score ships its sample size.',
    inputSchema: {
      type: "object",
      properties: {
        player_tag: {
          type: "string",
          description:
            "Optional: score this player against the curve (Pilot Score + monthly trend).",
        },
        days: {
          type: "integer",
          minimum: 7,
          maximum: 365,
          default: 90,
          description: "Window for the curve and score.",
        },
        mode: { type: "string", enum: MODE_GROUPS },
        trophy_band: {
          type: "string",
          enum: [
            "under_5000",
            "5000_8000",
            "8000_11000",
            "11000_13000",
            "13000_plus",
          ],
          description:
            "Condition the curve on the perspective player's starting trophies. An even-level match at 13k is a harder population than one at 6k.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const days = Number(args.days ?? 90);
      if (!Number.isInteger(days) || days < 7 || days > 365)
        throw new ToolFailure("bad_request", "days must be 7-365.");
      let focus = null;
      if (args.player_tag !== undefined)
        focus = (await subject(ctx.db, ctx.account, args.player_tag, "summary"))
          .tag;
      const BANDS = {
        under_5000: [0, 5000],
        "5000_8000": [5000, 8000],
        "8000_11000": [8000, 11000],
        "11000_13000": [11000, 13000],
        "13000_plus": [13000, 100000],
      };
      const params = [`${days} days`];
      const clauses = [];
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        clauses.push(`and b.type = any($${params.length})`);
      }
      if (args.trophy_band) {
        const [lo, hi] = BANDS[args.trophy_band];
        params.push(lo, hi);
        clauses.push(
          `and bp.starting_trophies >= $${params.length - 1} and bp.starting_trophies < $${params.length}`,
        );
      }
      const EDGES =
        "array[-2.5,-1.5,-1.0,-0.6,-0.3,-0.1,0.1,0.3,0.6,1.0,1.5,2.5]";
      const CURVE_FLOOR = 200;
      // The pairs set is expensive (jsonb lateral over every deck); build
      // it ONCE per request - curve, score, trend, and cohort all read it.
      // Temp table is session-local; the txn drops it.
      await ctx.db.query("begin");
      try {
        await ctx.db.query(
          `create temp table lv_pairs on commit drop as
         with sides as (
           select bp.battle_id, bp.player_tag, bp.outcome, b.battle_time,
                  avg((c.value->>'level')::numeric) as lvl
           from battle_participant bp
           join battle b on b.battle_id = bp.battle_id
           cross join lateral jsonb_array_elements(bp.deck->'cards') c
           where bp.deck ? 'cards' and b.type_class = 'pvp'
             and bp.outcome in ('win','loss')
             and b.battle_time > now() - $1::interval
             ${clauses.join(" ")}
           group by bp.battle_id, bp.player_tag, bp.outcome, b.battle_time),
         duos as (select battle_id from sides group by battle_id having count(*) = 2)
         select a.battle_id, a.player_tag, a.outcome, a.battle_time,
                a.lvl - o.lvl as gap
         from sides a
         join sides o on o.battle_id = a.battle_id and o.player_tag <> a.player_tag
         where a.battle_id in (select battle_id from duos)`,
          params,
        );
        const base = `with pairs as (select * from lv_pairs)`;
        const { rows: curveRows } = await ctx.db.query(
          `${base}
         select width_bucket(gap, ${EDGES}) as bin,
                round(min(gap), 2) as gap_lo, round(max(gap), 2) as gap_hi,
                count(*)::int as n,
                round(avg((outcome = 'win')::int)::numeric, 3) as win_rate
         from pairs group by bin order by bin`,
        );
        const curve = curveRows.map((r) => ({
          gap_range: [Number(r.gap_lo), Number(r.gap_hi)],
          n: r.n,
          win_rate: r.n >= CURVE_FLOOR ? Number(r.win_rate) : null,
          ...(r.n < CURVE_FLOOR ? { insufficient_sample: true } : {}),
        }));

        let player;
        if (focus) {
          const { rows: score } = await ctx.db.query(
            `${base},
           curve as (
             select width_bucket(gap, ${EDGES}) as bin,
                    avg((outcome = 'win')::int) as wr
             from pairs group by bin having count(*) >= ${CURVE_FLOOR})
           select count(*)::int as n,
                  round(avg(p.gap)::numeric, 2) as mean_gap,
                  round(avg((p.outcome = 'win')::int)::numeric, 3) as actual_win_rate,
                  round(avg(c.wr)::numeric, 3) as expected_from_levels,
                  round((avg((p.outcome = 'win')::int) - avg(c.wr))::numeric, 3) as pilot_score,
                  case when count(*) > 0
                       then round((0.5 / sqrt(count(*)))::numeric, 3) end as standard_error
           from pairs p
           join curve c on c.bin = width_bucket(p.gap, ${EDGES})
           where p.player_tag = $1`,
            [focus],
          );
          const { rows: trend } = await ctx.db.query(
            `${base},
           curve as (
             select width_bucket(gap, ${EDGES}) as bin,
                    avg((outcome = 'win')::int) as wr
             from pairs group by bin having count(*) >= ${CURVE_FLOOR})
           select to_char(date_trunc('month', p.battle_time), 'YYYY-MM') as month,
                  count(*)::int as n,
                  round((avg((p.outcome = 'win')::int) - avg(c.wr))::numeric, 3) as pilot_score
           from pairs p
           join curve c on c.bin = width_bucket(p.gap, ${EDGES})
           where p.player_tag = $1
           group by 1 having count(*) >= 20 order by 1`,
            [focus],
          );
          // Experience cohort (0024): tenure from the YearsPlayed badge;
          // percentile of pilot_score among corpus players (n >= 30 in
          // this window) in the same tenure bucket. Absent badge = tenure
          // UNKNOWN (real on old accounts too) -> no cohort claim.
          const { rows: tenure } = await ctx.db.query(
            `select years_played, account_age_days from player where player_tag = $1`,
            [focus],
          );
          const exp = tenure[0] ?? {};
          const experience = {
            years_played: exp.years_played ?? null,
            account_age_days: exp.account_age_days ?? null,
            ...(exp.years_played === null || exp.years_played === undefined
              ? {
                  note: "YearsPlayed badge absent - tenure unknown. Usually this means an account under 1 year (the badge appears at year one), but rare veteran exceptions exist (measured: accounts with 2024 event badges and no YearsPlayed), so null is served rather than 0.",
                }
              : {}),
          };
          let cohort;
          if (exp.years_played !== null && exp.years_played !== undefined) {
            const bucket =
              exp.years_played <= 2
                ? [0, 2, "years_1_2"]
                : exp.years_played <= 5
                  ? [3, 5, "years_3_5"]
                  : [6, 99, "years_6_plus"];
            const { rows: cohortScores } = await ctx.db.query(
              `${base},
             curve as (
               select width_bucket(gap, ${EDGES}) as bin,
                      avg((outcome = 'win')::int) as wr
               from pairs group by bin having count(*) >= ${CURVE_FLOOR})
             select p.player_tag,
                    round((avg((p.outcome = 'win')::int) - avg(c.wr))::numeric, 3) as pilot
             from pairs p
             join curve c on c.bin = width_bucket(p.gap, ${EDGES})
             join player pl on pl.player_tag = p.player_tag
             where pl.years_played between $1 and $2
             group by p.player_tag having count(*) >= 30`,
              [bucket[0], bucket[1]],
            );
            const pilots = cohortScores
              .map((r) => Number(r.pilot))
              .sort((a, z) => a - z);
            if (pilots.length >= 5 && score[0] && score[0].n >= 30) {
              const mine = Number(score[0].pilot_score);
              const below = pilots.filter((v) => v < mine).length;
              cohort = {
                bucket: bucket[2],
                cohort_size: pilots.length,
                percentile: Number((below / pilots.length).toFixed(2)),
                cohort_median_pilot_score: Number(
                  pilots[Math.floor(pilots.length / 2)].toFixed(3),
                ),
                basis:
                  "corpus players with known tenure in the same bucket and >= 30 scored battles in this window",
              };
            } else {
              cohort = {
                bucket: bucket[2],
                cohort_size: pilots.length,
                insufficient_cohort: true,
              };
            }
          }
          const s = score[0];
          player =
            s && s.n >= 30
              ? {
                  player_tag: focus,
                  n: s.n,
                  mean_gap: Number(s.mean_gap),
                  actual_win_rate: Number(s.actual_win_rate),
                  expected_from_levels: Number(s.expected_from_levels),
                  pilot_score: Number(s.pilot_score),
                  standard_error: Number(s.standard_error),
                  experience,
                  ...(cohort ? { cohort } : {}),
                  monthly_trend: trend.map((t) => ({
                    month: t.month,
                    n: t.n,
                    pilot_score: Number(t.pilot_score),
                  })),
                }
              : {
                  player_tag: focus,
                  n: s?.n ?? 0,
                  experience,
                  insufficient_sample: true,
                };
        }

        await ctx.db.query("commit");
        return {
          window_days: days,
          ...(args.trophy_band ? { trophy_band: args.trophy_band } : {}),
          ...(args.mode ? { mode: args.mode } : {}),
          ...(args.include_curve === false ? {} : { curve }),
          ...(player ? { player } : {}),
          note: "The curve measures the WITHIN-MATCH value of level advantage (each battle contributes both perspectives, so it is symmetric by construction); it does not measure the positional effect of upgrades on where you sit in matchmaking. pilot_score = actual minus level-expected win rate — wins your card levels can't explain. It embeds experience and opposition strength: compare your own TREND over months, or players of similar tenure and band, not raw scores across different careers. Bins below floor serve counts only — no extrapolation.",
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      } catch (err) {
        await ctx.db.query("rollback").catch(() => {});
        throw err;
      }
    },
  },

  war_rivals: {
    description:
      "The Scouting Report (META-INTEL §10): observed war history for rival clans — every recorded river race captures all five bracket clans, so rivals accumulate fingerprints across every race they ever shared with a recorded clan. Defaults to your clan's current bracket. Pure aggregation of stored observations: races seen, fame record, zero-fame races, seasons spanned.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description:
            "Your clan (entitlement anchor); defaults to your recorded clan.",
        },
        rival_tags: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          description:
            "Specific rival clans; defaults to your current bracket.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      let rivals = [];
      if (args.rival_tags?.length) {
        for (const raw of args.rival_tags) {
          try {
            rivals.push(normalizeTag(String(raw)));
          } catch {
            throw new ToolFailure(
              "invalid_tag",
              `Invalid clan tag: ${raw}`,
              TAG_RULE_HINT,
            );
          }
        }
      } else {
        const { rows } = await ctx.db.query(
          `select participant_clan_tag from war_week_clan
           where clan_tag = $1 and participant_clan_tag <> $1
             and (season_id, section_index) = (
               select season_id, section_index from war_week
               where clan_tag = $1
               order by season_id desc, section_index desc limit 1)`,
          [clanTag],
        );
        rivals = rows.map((r) => r.participant_clan_tag);
        if (rivals.length === 0)
          throw new ToolFailure(
            "not_recorded",
            "No bracket recorded for this clan yet.",
          );
      }
      // Observer-scoped duplication is by design in the war tables; rival
      // stats dedupe on (season, section, rival) BEFORE aggregating so a
      // race two recorded clans both saw counts once (META-INTEL §10).
      const { rows } = await ctx.db.query(
        `with latest as (
           select season_id, section_index from war_week
           where clan_tag = $1
           order by season_id desc, section_index desc limit 1),
         races as (
           select w.participant_clan_tag, w.season_id, w.section_index,
                  max(w.fame) as fame,
                  max(w.participant_name) as name,
                  bool_or(w.clan_tag = $1) as shared_with_you,
                  (w.season_id, w.section_index) = (select season_id, section_index from latest)
                    as in_progress
           from war_week_clan w
           where w.participant_clan_tag = any($2)
           group by w.participant_clan_tag, w.season_id, w.section_index)
         select participant_clan_tag as clan_tag,
                max(name) as name,
                count(*)::int as races_observed,
                count(*) filter (where shared_with_you)::int as races_shared_with_you,
                min(season_id)::int as first_season,
                max(season_id)::int as last_season,
                round(avg(fame) filter (where not in_progress))::int as mean_fame,
                round(percentile_cont(0.5) within group (order by fame)
                  filter (where not in_progress))::int as median_fame,
                max(fame) filter (where not in_progress)::int as max_fame,
                count(*) filter (where fame = 0 and not in_progress)::int as zero_fame_races,
                max(fame) filter (where in_progress)::int as current_race_fame
         from races group by participant_clan_tag
         order by mean_fame desc nulls last`,
        [clanTag, rivals],
      );
      return {
        clan_tag: clanTag,
        rivals: rows,
        basis:
          "Observed in races shared with recorded clans — a rival's races_observed is our sightings, not their full history. Fame stats cover finished races only; current_race_fame is the in-progress week. Races seen by two recorded clans count once.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  war_current: {
    description:
      "The current (latest recorded) river race for a recorded clan (defaults to YOURS): standings across the five clans, per-member points/decks used, war day and attendance so far.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "Clan tag; defaults to your recorded clan.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const { rows: weekRows } = await ctx.db.query(
        `select season_id, section_index, is_colosseum from war_week
         where clan_tag = $1 order by season_id desc, section_index desc limit 1`,
        [clanTag],
      );
      if (!weekRows[0]) {
        throw new ToolFailure(
          "not_recorded",
          "No war weeks recorded for this clan yet.",
          "The first riverracelog poll lands within a day of enrollment.",
        );
      }
      const wk = weekRows[0];
      // Grounded time (feedback #8: an agent asserted "the week just
      // finished" from schema alone): the current period anchor gives
      // fields a temporal claim can CITE instead of infer.
      const { rows: anchorRows } = await ctx.db.query(
        `select period_index, first_observed_at from war_period_anchor
         where clan_tag = $1 order by period_index desc limit 1`,
        [clanTag],
      );
      let period = null;
      if (anchorRows[0]) {
        const idx = Number(anchorRows[0].period_index);
        const info = periodInfo(idx);
        const anchor = anchorRows[0].first_observed_at;
        // Nominal boundary: the next ~10:00 UTC after the period was
        // first seen open; observed boundaries drift around it.
        const nominalEnd = new Date(anchor);
        nominalEnd.setUTCHours(10, 0, 0, 0);
        if (nominalEnd <= anchor)
          nominalEnd.setUTCDate(nominalEnd.getUTCDate() + 1);
        const weekEnd = new Date(
          nominalEnd.getTime() + (6 - info.dayInSection) * 86400_000,
        );
        period = {
          period_index: idx,
          kind: info.kind,
          ...(info.warDay ? { war_day: info.warDay } : {}),
          day_in_week: info.dayInSection,
          started_observed_at: anchor.toISOString(),
          period_end_nominal: nominalEnd.toISOString(),
          week_end_nominal: weekEnd.toISOString(),
          as_observed_note:
            "started_observed_at is when the recorder first saw this period open (true start is at or before it). *_nominal assumes the ~10:00 UTC reset; observed boundaries drift. Cite these fields for any claim about where the war week stands - never infer from day counts or event schemas.",
        };
      }
      const [standings, participation, attendance] = await Promise.all([
        ctx.db.query(
          `select participant_clan_tag, participant_name, fame, rank, trophy_change, finish_time
           from war_week_clan
           where clan_tag = $1 and season_id = $2 and section_index = $3
           order by rank nulls last, fame desc`,
          [clanTag, wk.season_id, wk.section_index],
        ),
        ctx.db.query(
          `select wp.player_tag, p.name, wp.points, wp.decks_used, wp.boat_attacks,
                  exists (select 1 from clan_membership cm
                          where cm.clan_tag = wp.clan_tag and cm.player_tag = wp.player_tag
                            and cm.left_observed_at is null) as in_clan
           from war_participation wp join player p on p.player_tag = wp.player_tag
           where wp.clan_tag = $1 and wp.season_id = $2 and wp.section_index = $3
           order by wp.points desc,
                    exists (select 1 from clan_membership cm2
                            where cm2.clan_tag = wp.clan_tag and cm2.player_tag = wp.player_tag
                              and cm2.left_observed_at is null) desc,
                    p.name nulls last`,
          [clanTag, wk.season_id, wk.section_index],
        ),
        // Battled = decksUsedToday observed >0 at any poll, OR a recorded
        // war battle by that member that day — polls alone undercount
        // when the cadence misses a member's play window (round-3).
        ctx.db.query(
          `with att as (
             select war_day, player_tag, decks_used_today > 0 as battled
             from war_attendance_day
             where clan_tag = $1 and season_id = $2 and section_index = $3),
           fought as (
             select distinct b.war_day, bp.player_tag
             from battle b join battle_participant bp on bp.battle_id = b.battle_id
             where bp.clan_tag = $1 and b.season_id = $2 and b.section_index = $3
               and b.war_day is not null),
           merged as (
             select war_day, player_tag, bool_or(battled) as battled from (
               select war_day, player_tag, battled from att
               union all
               select war_day, player_tag, true from fought) x
             group by war_day, player_tag)
           select war_day,
                  count(*) filter (where battled)::int as battled,
                  count(*)::int as participants
           from merged
           group by war_day order by war_day`,
          [clanTag, wk.season_id, wk.section_index],
        ),
      ]);
      return {
        clan_tag: clanTag,
        season_id: wk.season_id,
        section_index: wk.section_index,
        is_colosseum: wk.is_colosseum,
        standings: standings.rows,
        participants: participation.rows,
        ...(period ? { period } : {}),
        attendance_by_war_day: attendance.rows,
        note: "points are per-member contributions; fame belongs to the boat (clan). standings mirror the game's own race payload: a zero-fame opponent can be real (an inactive bracket). participants list everyone in the race roster this week, sorted by points then current members first; in_clan is false for those who have since left. attendance_by_war_day counts race participants (not just current members); battled unions poll observations with recorded battles.",
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(ctx.account.timezone
            ? { timezone_applied: ctx.account.timezone }
            : {}),
        }),
      };
    },
  },

  war_history: {
    description:
      'Recorded war weeks for a recorded clan (defaults to YOURS): final ranks, boat fame, and (optionally) one member\u2019s per-week points and decks — "did I miss a war day?" lives here.',
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "Clan tag; defaults to your recorded clan.",
        },
        player_tag: {
          type: "string",
          description: "Focus one member’s participation.",
        },
        seasons: {
          type: "integer",
          minimum: 1,
          maximum: 12,
          default: 3,
          description: "How many seasons back.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      let focus = null;
      if (args.player_tag)
        focus = (await subject(ctx.db, ctx.account, args.player_tag, "summary"))
          .tag;
      const seasons = Number(args.seasons ?? 3);
      if (!Number.isInteger(seasons) || seasons < 1 || seasons > 12)
        throw new ToolFailure(
          "bad_request",
          `seasons must be an integer from 1 to 12 (got ${args.seasons}).`,
        );
      const { rows: weeks } = await ctx.db.query(
        `select w.season_id, w.section_index, w.is_colosseum, w.finished_observed_at,
                own.fame as our_fame, own.rank as our_rank, own.trophy_change
         from war_week w
         left join war_week_clan own on own.clan_tag = w.clan_tag
           and own.season_id = w.season_id and own.section_index = w.section_index
           and own.participant_clan_tag = w.clan_tag
         where w.clan_tag = $1
           and w.season_id > coalesce((select max(season_id) from war_week where clan_tag = $1), 0) - $2
         order by w.season_id desc, w.section_index desc`,
        [clanTag, seasons],
      );
      let memberWeeks = null;
      if (focus) {
        // Same season window as the weeks list. war_days_battled unions
        // TWO observation sources — decksUsedToday polls AND the member's
        // own recorded war battles (sparse polls miss decksUsedToday
        // windows; round-3 cross-check caught the undercount). Null when
        // the week has NO coverage from either source — a zero there
        // would be indistinguishable from "sat out every day".
        const { rows } = await ctx.db.query(
          `select wp.season_id, wp.section_index, wp.points, wp.decks_used, wp.boat_attacks,
                  case when exists (select 1 from war_attendance_day cov
                                    where cov.clan_tag = wp.clan_tag
                                      and cov.season_id = wp.season_id
                                      and cov.section_index = wp.section_index)
                         or exists (select 1 from battle_participant bpc
                                    join battle bc on bc.battle_id = bpc.battle_id
                                    where bpc.clan_tag = wp.clan_tag
                                      and bc.season_id = wp.season_id
                                      and bc.section_index = wp.section_index
                                      and bc.war_day is not null)
                       then (select count(distinct d.war_day)::int from (
                               select ad.war_day from war_attendance_day ad
                               where ad.clan_tag = wp.clan_tag and ad.season_id = wp.season_id
                                 and ad.section_index = wp.section_index and ad.player_tag = wp.player_tag
                                 and ad.decks_used_today > 0
                               union
                               select b.war_day from battle_participant bp2
                               join battle b on b.battle_id = bp2.battle_id
                               where bp2.player_tag = wp.player_tag and bp2.clan_tag = wp.clan_tag
                                 and b.season_id = wp.season_id and b.section_index = wp.section_index
                                 and b.war_day is not null) d)
                       end as war_days_battled
           from war_participation wp
           where wp.clan_tag = $1 and wp.player_tag = $2
             and wp.season_id > coalesce((select max(season_id) from war_week where clan_tag = $1), 0) - $3
           order by wp.season_id desc, wp.section_index desc limit 40`,
          [clanTag, focus, seasons],
        );
        memberWeeks = rows;
      }
      // The chronologically-latest unfinished week is the one still being
      // fought; older null-standings weeks are capture gaps. The
      // distinction matters to a skeptical reader (round-3 finding).
      const newest = weeks[0];
      return {
        clan_tag: clanTag,
        weeks: weeks.map((w) => ({
          season_id: w.season_id,
          section_index: w.section_index,
          is_colosseum: w.is_colosseum,
          in_progress:
            w === newest && w.finished_observed_at === null ? true : undefined,
          finished: w.finished_observed_at?.toISOString() ?? null,
          our_rank: w.our_rank,
          our_fame: w.our_fame,
          trophy_change: w.trophy_change,
        })),
        ...(focus ? { member: focus, member_weeks: memberWeeks } : {}),
        note: "points are per-member contributions; fame belongs to the boat (clan). in_progress marks the week still being fought (nulls there mean not-finished-yet); on OLDER weeks null our_rank/our_fame means the week was observed without a standings capture. null war_days_battled means per-day attendance is unknown for that week (unknown, not zero).",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  battles_compare: {
    description:
      "Side-by-side of 2-4 recorded tags (any player the service records - universal reads): latest snapshot topline plus a shared performance window.",
    inputSchema: {
      type: "object",
      properties: {
        player_tags: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
        },
        from: {
          type: "string",
          description: "ISO instant or YYYY-MM-DD (your timezone).",
        },
        to: { type: "string" },
      },
      required: ["player_tags"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      if ((args.player_tags ?? []).length > 4)
        throw new ToolFailure("bad_request", "battles_compare needs 2-4 tags.");
      const tags = [];
      for (const raw of args.player_tags ?? []) {
        tags.push((await subject(ctx.db, ctx.account, raw, "summary")).tag);
      }
      if (tags.length < 2)
        throw new ToolFailure("bad_request", "battles_compare needs 2-4 tags.");
      const tz = ctx.account.timezone;
      const from = resolveInstant(tz, args.from);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      const players = [];
      for (const tag of tags) {
        const { rows: snap } = await ctx.db.query(
          `select p.name, s.trophies, s.donations, (s.lifetime->>'battleCount')::int as battle_count,
                  (s.lifetime->>'collectionLevel')::int as collection_level
           from player p
           left join lateral (
             select * from player_snapshot_daily where player_tag = p.player_tag
             order by snapshot_date desc, snapshot_kind desc limit 1
           ) s on true where p.player_tag = $1`,
          [tag],
        );
        const params = [tag];
        const where = [
          `bp.player_tag = $1`,
          `bp.outcome in ('win','loss','draw')`,
        ];
        if (from) {
          params.push(from);
          where.push(`b.battle_time >= $${params.length}`);
        }
        if (to) {
          params.push(to);
          where.push(`b.battle_time < $${params.length}`);
        }
        const { rows: perf } = await ctx.db.query(
          `select count(*)::int battles,
                  count(*) filter (where bp.outcome = 'win')::int wins,
                  count(*) filter (where bp.outcome = 'loss')::int losses,
                  coalesce(sum(bp.trophy_change), 0)::int net_trophies
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}`,
          params,
        );
        players.push({ player_tag: tag, ...snap[0], window: perf[0] });
      }
      return {
        players,
        note: "window covers RECORDED battles only; net_trophies sums trophy changes across those battles, not the players' full ladder delta — recording start dates differ per player.",
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(tz ? { timezone_applied: tz } : {}),
        }),
      };
    },
  },
};

/** Added = recorded, shared honestly: the clan's recording exists while
 *  ANY account has it added, at the widest requested scope. Returns
 *  true when this call started the recording. */
export async function ensureClanRecording(db, tag, requestedBy) {
  const { rows: eff } = await db.query(
    `select max(scope) as scope from account_clan where clan_tag = $1`,
    [tag],
  );
  const scope = eff[0]?.scope ?? "comprehensive"; // 'comprehensive' > 'activity' lexically
  const { rowCount: started } = await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, clan_scope)
     select 'clan', $1, $2, $3
     where not exists (select 1 from recording
                       where subject_type = 'clan' and subject_tag = $1 and status = 'active')`,
    [tag, requestedBy, scope],
  );
  if (started === 0) {
    await db.query(
      `update recording set clan_scope = $2
       where subject_type = 'clan' and subject_tag = $1 and status = 'active'
         and clan_scope <> $2`,
      [tag, scope],
    );
  }
  return started > 0;
}

/** After a removal: stop the recording when no account has the clan
 *  added any more, else settle scope to the widest remaining request.
 *  Returns true when the recording stopped. */
export async function settleClanRecording(db, tag) {
  const { rows: eff } = await db.query(
    `select max(scope) as scope, count(*)::int as n
     from account_clan where clan_tag = $1`,
    [tag],
  );
  if (eff[0].n === 0) {
    const { rowCount } = await db.query(
      `update recording set status = 'stopped'
       where subject_type = 'clan' and subject_tag = $1 and status = 'active'`,
      [tag],
    );
    return rowCount > 0;
  }
  await db.query(
    `update recording set clan_scope = $2
     where subject_type = 'clan' and subject_tag = $1 and status = 'active'
       and clan_scope <> $2`,
    [tag, eff[0].scope],
  );
  return false;
}

export function makeRegistry() {
  return {
    has: (name) => Object.hasOwn(TOOLS, name),
    declarations: () =>
      Object.entries(TOOLS)
        .map(([name, t]) => {
          // Classification is mandatory: an unclassified tool is a build
          // error, not a silent "Other tools" entry (Jamie, 2026-09-04).
          const cls = TOOL_GROUPS[name];
          if (!cls) throw new Error(`tool ${name} missing from TOOL_GROUPS`);
          return {
            name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: {
              // Group rides the title: clients that sort tools by title
              // cluster the groups; clients that ignore titles lose nothing.
              title: `${cls.group} · ${cls.title}`,
              readOnlyHint: cls.readOnly,
              destructiveHint: false,
              openWorldHint: cls.openWorld ?? false,
            },
          };
        })
        // Publish the TREE (Jamie, 2026-09-05): group order then title,
        // so clients preserving server order render the domain
        // structure - never a read-only/read-write split.
        .sort((a, b) => {
          const ga = GROUP_ORDER.indexOf(TOOL_GROUPS[a.name].group);
          const gb = GROUP_ORDER.indexOf(TOOL_GROUPS[b.name].group);
          return ga !== gb
            ? ga - gb
            : a.annotations.title.localeCompare(b.annotations.title);
        }),
    invoke: (name, ctx, args) => TOOLS[name].handler(ctx, args),
  };
}
