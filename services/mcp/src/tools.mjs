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
  gatewayArena,
} from "@elixir-mcp/contracts";
import { resolveInstant, formatLocal } from "./time.mjs";
import { resolveSubject, resolveEntitledClan } from "./entitlements.mjs";
import { livePathToJob } from "./live.mjs";

const LIVE_DAILY_CAP = 50;

/** The live lane spends real CR budget: tight per-account daily cap. */
async function spendLiveQuota(ctx) {
  if (ctx.account.isOwner) return;
  const day = new Date().toISOString().slice(0, 10);
  const { rows } = await ctx.db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 1)
     on conflict (bucket, window_start) do update set count = rate_limit.count + 1
     returning count`,
    [`liveday#${ctx.account.accountId}`, day],
  );
  if (rows[0].count > LIVE_DAILY_CAP) {
    throw new ToolFailure(
      "quota_exceeded",
      `Live-fetch quota reached (${LIVE_DAILY_CAP}/day).`,
      "Recorded-data tools are unlimited within the normal quota.",
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
        where subject_tag = $1) as freshness_seconds`,
    [tag],
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

// --- tools -----------------------------------------------------------------

const TOOLS = {
  elixir_my_players: {
    description:
      "Your session bootstrap: claimed tags, which is primary, and recording status, and current clan as recorded. claim_status is informational — claims are trust-based. Call this first.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const { rows } = await ctx.db.query(
        `select c.player_tag, c.status as claim_status, c.is_primary,
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
                  s.trophies, s.snapshot_date
           from player p
           left join clan cl on cl.clan_tag = p.last_known_clan_tag
           left join lateral (
             select trophies, snapshot_date from player_snapshot_daily
             where player_tag = p.player_tag
             order by snapshot_date desc, snapshot_kind desc limit 1
           ) s on true
           where p.player_tag = $1`,
          [tag],
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
      "How complete the record is for a tag: recording start, last successful poll per endpoint, battles captured (including appearances recorded before you claimed the tag), and recent capture completeness. Use it to caveat answers honestly.",
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
      "The workhorse: canonical recorded battles for a tag with filters and cursor pagination. Returns both perspectives of every battle (your deck and the opponents’). from/to accept ISO instants or date-only strings resolved in your timezone.",
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
          description: "Exact deck identity (see battles_decks).",
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
      const s = await subject(ctx.db, ctx.account, args.player_tag, "battles");
      const tag = s.tag;
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
      const where = ["bp.player_tag = $1"];
      const params = [tag];
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
                bp.side, bp.crowns, bp.trophy_change, bp.starting_trophies, bp.deck, bp.deck_hash,
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
        const { rows: rest } = await ctx.db.query(
          `select o.battle_id, o.player_tag, o.side, o.crowns, o.deck_hash, o.clan_tag,
                  o.deck, o.tower_hp, p.name
           from battle_participant o join player p on p.player_tag = o.player_tag
           where o.battle_id = any($1) and o.player_tag <> $2`,
          [ids, tag],
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
          battle_time: r.battle_time.toISOString(),
          ...(tz ? { battle_time_local: formatLocal(r.battle_time, tz) } : {}),
          type: r.type,
          game_mode: { id: r.game_mode_id, name: r.game_mode_name },
          arena: r.arena,
          league_number: r.league_number,
          me: {
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
      if (battles.length === 0 && to) {
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
        player_tag: tag,
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
          enum: ["week"],
          description:
            "Weekly win-rate series over the window (ISO weeks) — the trend view. Combines with mode/deck_hash/from/to; overrides before_after and compare_*.",
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
      if (args.group_by === "week") {
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
      "Send feedback about Elixir MCP to its maintainers: bugs, data-quality issues, missing capabilities, or praise. Feedback from an agent is attributed to the account that connected it. Use freely — it directly drives what gets built.",
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
          enum: ["general", "bug", "data_quality", "feature", "praise"],
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

  elixir_watch_player: {
    description:
      "Start recording a player: claims the tag to your account (trust-based) and begins battle/profile capture. Same rules as the website — active player recordings are capped per account.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: {
          type: "string",
          description: "The tag to watch, like #20JJJ2CCRU.",
        },
        make_primary: {
          type: "boolean",
          description: "Make this your primary claimed tag.",
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
      // Recordings spend the one global rate budget: same cap as the web
      // flow (default 5 active player recordings, column override, owner
      // exempt) — the two doors must never disagree.
      const { rows: already } = await ctx.db.query(
        `select 1 from recording where subject_type = 'player' and subject_tag = $1 and status = 'active'`,
        [tag],
      );
      let recordingStarted = false;
      if (!already[0]) {
        if (!ctx.account.isOwner) {
          const { rows: cap } = await ctx.db.query(
            `select coalesce(a.max_player_recordings, 5) as cap,
                    (select count(*)::int from recording r
                     where r.requested_by = $1 and r.subject_type = 'player'
                       and r.status = 'active') as active
             from account a where a.account_id = $1`,
            [ctx.account.accountId],
          );
          if (cap[0].active >= cap[0].cap) {
            throw new ToolFailure(
              "quota_exceeded",
              `Active player recordings are capped at ${cap[0].cap} per account.`,
              "Stop one on the website dashboard, or ask via elixir_feedback for a higher cap.",
            );
          }
        }
        await ctx.db.query(
          `insert into recording (subject_type, subject_tag, requested_by)
           select 'player', $1, $2
           where not exists (select 1 from recording where subject_type = 'player' and subject_tag = $1 and status = 'active')`,
          [tag, ctx.account.accountId],
        );
        await ctx.db.query(
          `insert into account_event (account_id, kind, detail) values ($1, 'recording_started', $2)`,
          [
            ctx.account.accountId,
            JSON.stringify({ player_tag: tag, via: "mcp" }),
          ],
        );
        recordingStarted = true;
      }
      return {
        player_tag: tag,
        claimed: claimed > 0,
        recording: "active",
        recording_started: recordingStarted,
        note: recordingStarted
          ? "Watching. First battles land within the hour; history builds from here (the API has no past)."
          : "This player was already being recorded — you now share the existing record.",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_watch_clan: {
    description:
      "Ask Elixir MCP to record a whole clan (every member's battles, roster, war). Clan capture spends the shared collector budget, so this files a request the maintainer reviews rather than starting immediately.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description: "The clan tag, like #J2RGCRVG.",
        },
        note: {
          type: "string",
          maxLength: 500,
          description: "Optional: why, and your role in the clan.",
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
      const { rows: active } = await ctx.db.query(
        `select 1 from recording where subject_type = 'clan' and subject_tag = $1 and status = 'active'`,
        [tag],
      );
      if (active[0]) {
        return {
          clan_tag: tag,
          recording: "active",
          note: "This clan is already being recorded.",
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      }
      // The request rides the feedback triage lane the maintainer already
      // watches; membership can't be verified for an unrecorded clan, so
      // the reviewer is the gate.
      const { rows: fb } = await ctx.db.query(
        `insert into feedback (account_id, surface, category, message, context)
         values ($1, 'mcp', 'feature', $2, $3)
         returning feedback_id`,
        [
          ctx.account.accountId,
          `Clan watch request: ${tag}${args.note ? ` — ${String(args.note).slice(0, 500)}` : ""}`,
          JSON.stringify({ kind: "clan_watch_request", clan_tag: tag }),
        ],
      );
      await ctx.db.query(
        `insert into account_event (account_id, kind, detail) values ($1, 'clan_watch_requested', $2)`,
        [ctx.account.accountId, JSON.stringify({ clan_tag: tag })],
      );
      return {
        clan_tag: tag,
        recording: "requested",
        request_id: fb[0].feedback_id,
        note: "Request filed for review — clan capture spends the shared collector budget, so the maintainer approves these by hand. You'll see it on your dashboard when it starts.",
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
      "The collector ladder: the operator-run machines that fetch from the CR API, each named for a Clash Royale card, earning a point per fetch and climbing arena tiers. More collectors = resilience, never more quota.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const { rows } = await ctx.db.query(
        `select name, status, fetch_points, card_name, card_icon, last_success_at
         from gateway where status <> 'revoked'
         order by fetch_points desc, enrolled_at`,
      );
      return {
        collectors: rows.map((g, i) => ({
          rank: i + 1,
          name: g.name,
          card: g.card_name,
          status: g.status,
          points: Number(g.fetch_points),
          arena: gatewayArena(Number(g.fetch_points)).name,
          last_success: g.last_success_at?.toISOString() ?? null,
        })),
        note: "Run one yourself: raise your hand on the dashboard (a machine with a static IP is all it takes).",
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  live_fetch: {
    description:
      "Allowlisted live GET passthrough to the CR API through the recording budget (tight per-account quota): /players/{tag}, /players/{tag}/battlelog, /clans/{tag}, /clans/{tag}/currentriverrace, /clans/{tag}/riverracelog. Fetched results are recorded opportunistically. Expect 1–3s. RAW payloads: card levels here are the API's rarity-relative scale (a maxed legendary reads 8/8); every recorded-data tool serves the in-game 1-16 scale instead.",
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
  clans_roster: {
    description:
      "Your recorded clan: roster with roles, latest trophies/donations per member, activity recency (last recorded battle), and recent join/leave/role events. Defaults to your clan.",
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
                  s.trophies, s.donations,
                  (select max(b.battle_time) from battle_participant bp
                   join battle b on b.battle_id = bp.battle_id
                   where bp.player_tag = cm.player_tag) as last_battle
           from clan_membership cm
           join player p on p.player_tag = cm.player_tag
           left join lateral (
             select trophies, donations from player_snapshot_daily
             where player_tag = cm.player_tag order by snapshot_date desc, snapshot_kind desc limit 1
           ) s on true
           where cm.clan_tag = $1 and cm.left_observed_at is null
           order by cm.role desc, s.trophies desc nulls last`,
          [clanTag],
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

  war_current: {
    description:
      "The current (latest recorded) river race for your clan: standings across the five clans, per-member points/decks used, war day and attendance so far. Defaults to your clan.",
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
      'Recorded war weeks for your clan: final ranks, boat fame, and (optionally) one member’s per-week points and decks — "did I miss a war day?" lives here. Defaults to your clan.',
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
      "Side-by-side of 2–4 entitled tags (your claims or clanmates): latest snapshot topline plus a shared performance window.",
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

export function makeRegistry() {
  return {
    has: (name) => Object.hasOwn(TOOLS, name),
    declarations: () =>
      Object.entries(TOOLS).map(([name, t]) => {
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
      }),
    invoke: (name, ctx, args) => TOOLS[name].handler(ctx, args),
  };
}
