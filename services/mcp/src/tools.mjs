/**
 * The V1 tool registry — DESIGN §3. Declarations (JSON Schema) and
 * handlers together so the schema and behavior can't drift. Handlers
 * throw ToolFailure for structured errors (the closed taxonomy); the
 * invoker renders them as {error, meta} bodies with isError: true.
 */

import {
  normalizeTag,
  InvalidTagError,
  responseMeta,
  MODE_GROUPS,
  typesForModeGroup,
} from '@elixir-mcp/contracts';
import { resolveInstant, formatLocal } from './time.mjs';

export class ToolFailure extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

const TAG_SCHEMA = {
  type: 'string',
  description: 'Clash Royale player tag like #20JJJ2CCRU. Defaults to your primary claimed tag.',
};

// --- shared helpers --------------------------------------------------------

async function resolveEntitledTag(db, account, inputTag) {
  if (inputTag === undefined || inputTag === null || inputTag === '') {
    const { rows } = await db.query(
      `select player_tag from claim where account_id = $1 and is_primary`,
      [account.accountId],
    );
    if (!rows[0]) throw new ToolFailure('not_found', 'No primary claimed tag on this account.', 'Claim a player tag on the website first.');
    return rows[0].player_tag;
  }
  let tag;
  try {
    tag = normalizeTag(String(inputTag));
  } catch (err) {
    if (err instanceof InvalidTagError) throw new ToolFailure('invalid_tag', err.message);
    throw err;
  }
  const { rows } = await db.query(
    `select 1 from claim where account_id = $1 and player_tag = $2`,
    [account.accountId, tag],
  );
  if (!rows[0]) {
    throw new ToolFailure('not_entitled', `No claim on ${tag} for this account.`, 'V1 serves tags you have claimed; clan entitlements arrive in V2.');
  }
  return tag;
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
    ...(row.recorded_since ? { recorded_since: row.recorded_since.toISOString() } : {}),
    ...(row.freshness_seconds !== null && row.freshness_seconds !== undefined
      ? { freshness_seconds: row.freshness_seconds }
      : {}),
    ...(account.timezone ? { timezone_applied: account.timezone } : {}),
  });
}

// --- tools -----------------------------------------------------------------

const TOOLS = {
  list_my_players: {
    description:
      'Your session bootstrap: claimed tags, which is primary, verification and recording status, and current clan as recorded. Call this first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
          recording: r.recording_status ?? 'not_recording',
          clan_tag: r.member_of ?? r.last_known_clan_tag,
          clan_role: r.role,
        })),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  get_coverage: {
    description:
      'How complete the record is for a tag: recording start, last successful poll per endpoint, battles captured (including appearances recorded before you claimed the tag), and recent capture completeness. Use it to caveat answers honestly.',
    inputSchema: {
      type: 'object',
      properties: { player_tag: TAG_SCHEMA },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = await resolveEntitledTag(ctx.db, ctx.account, args.player_tag);
      const [polls, battles, completeness] = await Promise.all([
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
              : 'No battles recorded yet for this tag.',
        },
        completeness_last_7_days: {
          average_ratio: completeness.rows[0].recent_ratio,
          incomplete_days: completeness.rows[0].incomplete_days,
        },
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },

  get_player: {
    description:
      'Latest recorded profile snapshot for a tag: trophies, Path of Legends, league stats, donations, lifetime counters, collection level, clan. as-of the last profile poll.',
    inputSchema: {
      type: 'object',
      properties: {
        player_tag: TAG_SCHEMA,
        live: { type: 'boolean', description: 'Fetch fresh from the CR API via the live lane (quota-limited).' },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = await resolveEntitledTag(ctx.db, ctx.account, args.player_tag);
      if (args.live === true) {
        throw new ToolFailure(
          'live_unavailable',
          'The live lane is not deployed yet; serving recorded data only.',
          'Call again without live: true.',
        );
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
      if (!row) throw new ToolFailure('not_recorded', `${tag} is not in the record yet.`);
      if (!row.snapshot_date) {
        throw new ToolFailure(
          'not_recorded',
          `${tag} is known but has no profile snapshot yet.`,
          'Recording may have just started; try get_coverage.',
        );
      }
      return {
        player_tag: row.player_tag,
        name: row.name,
        clan: row.last_known_clan_tag ? { clan_tag: row.last_known_clan_tag, name: row.clan_name } : null,
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

  query_battles: {
    description:
      'The workhorse: canonical recorded battles for a tag with filters and cursor pagination. Returns both perspectives of every battle (your deck and the opponents’). from/to accept ISO instants or date-only strings resolved in your timezone.',
    inputSchema: {
      type: 'object',
      properties: {
        player_tag: TAG_SCHEMA,
        from: { type: 'string', description: 'ISO instant or YYYY-MM-DD (your timezone).' },
        to: { type: 'string', description: 'ISO instant or YYYY-MM-DD inclusive (your timezone).' },
        mode: { type: 'string', enum: MODE_GROUPS, description: 'Mode group filter.' },
        game_mode_id: { type: 'integer' },
        opponent_tag: { type: 'string', description: 'Only battles against this tag.' },
        outcome: { type: 'string', enum: ['win', 'loss', 'draw'] },
        with_card: { type: 'integer', description: 'Card id present in YOUR deck.' },
        against_card: { type: 'integer', description: 'Card id present in an OPPONENT deck.' },
        deck_hash: { type: 'string', description: 'Exact deck identity (see get_deck_performance).' },
        cursor: { type: 'integer', description: 'From a previous response’s next_cursor.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = await resolveEntitledTag(ctx.db, ctx.account, args.player_tag);
      const tz = ctx.account.timezone;
      const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 50);
      const where = ['bp.player_tag = $1'];
      const params = [tag];
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace('?', `$${params.length}`));
      };
      const from = resolveInstant(tz, args.from);
      if (args.from && !from) throw new ToolFailure('bad_request', `Unparseable from: ${args.from}`);
      if (from) add('b.battle_time >= ?', from);
      const to = resolveInstant(tz, args.to, { endOfDay: true });
      if (args.to && !to) throw new ToolFailure('bad_request', `Unparseable to: ${args.to}`);
      if (to) add('b.battle_time < ?', to);
      if (args.mode) add('b.type = any(?)', typesForModeGroup(args.mode));
      if (args.game_mode_id !== undefined) add('b.game_mode_id = ?', args.game_mode_id);
      if (args.outcome) add('bp.outcome = ?', args.outcome);
      if (args.deck_hash) add('bp.deck_hash = ?', args.deck_hash);
      if (args.with_card !== undefined) {
        add(`bp.deck->'cards' @> ?::jsonb`, JSON.stringify([{ id: args.with_card }]));
      }
      if (args.opponent_tag) {
        let opponent;
        try {
          opponent = normalizeTag(String(args.opponent_tag));
        } catch {
          throw new ToolFailure('invalid_tag', `Invalid opponent_tag: ${args.opponent_tag}`);
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
      if (args.cursor !== undefined) add('b.cursor < ?', args.cursor);

      const { rows } = await ctx.db.query(
        `select b.cursor, b.battle_id, b.battle_time, b.type, b.game_mode_id, b.game_mode_name,
                b.arena, b.league_number,
                bp.side, bp.crowns, bp.trophy_change, bp.starting_trophies, bp.deck, bp.deck_hash,
                bp.elixir_leaked, bp.tower_hp, bp.outcome
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         where ${where.join(' and ')}
         order by b.cursor desc
         limit ${limit}`,
        params,
      );

      let others = new Map();
      if (rows.length > 0) {
        const ids = rows.map((r) => r.battle_id);
        const { rows: rest } = await ctx.db.query(
          `select o.battle_id, o.player_tag, o.side, o.crowns, o.deck_hash, o.clan_tag, p.name
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
            deck: r.deck,
            deck_hash: r.deck_hash,
            elixir_leaked: r.elixir_leaked === null ? null : Number(r.elixir_leaked),
            tower_hp: r.tower_hp,
          },
          teammates: rest.filter((o) => o.side === r.side).map(shape),
          opponents: rest.filter((o) => o.side !== r.side).map(shape),
        };
      });

      return {
        player_tag: tag,
        battles,
        ...(rows.length === limit ? { next_cursor: rows[rows.length - 1].cursor } : {}),
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },
};

export function makeRegistry() {
  return {
    has: (name) => Object.hasOwn(TOOLS, name),
    declarations: () =>
      Object.entries(TOOLS).map(([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    invoke: (name, ctx, args) => TOOLS[name].handler(ctx, args),
  };
}
