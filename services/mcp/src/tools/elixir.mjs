/** elixir_my_players · elixir_coverage · elixir_feedback · elixir_my_feedback · elixir_changelog · elixir_events · elixir_nickname · elixir_add_player · elixir_add_clan · elixir_data_insights · elixir_collectors — moved verbatim from the
 *  single-file registry (review item 8). */

import {
  normalizeTag,
  responseMeta,
  CHANGELOG,
  CONTRACT_VERSION,
  roleQuotas,
} from "@elixir-mcp/contracts";
import { addPlayer, removePlayer } from "@elixir-mcp/claims";
import { emitFeedEvent, FEED_TOPICS } from "../feed.mjs";
import { ensureGatewayCards } from "../gateway-cards.mjs";
import {
  ToolFailure,
  TAG_SCHEMA,
  TAG_RULE_HINT,
  subject,
  buildMeta,
  ensureClanRecording,
  settleClanRecording,
} from "./shared.mjs";

export const elixirTools = {
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
      "Your event feed - the push lane. Everything you ADD (players via elixir_add_player, clans via elixir_add_clan) feeds this pipe while its notify setting is on; notify_off silences a subject without touching its recording. Event TYPES this feed can carry (schema, not news - their presence here never means one occurred): battles_recorded (coalesced per tag until read), member_joined / member_left / member_role_changed (clans you've added), clan_pulse (daily per-clan digest ~07:00Z: 24h battle activity, quiet members, war-day deck counts, roster changes - facts for YOUR clan-management judgment), war_day_open (a new war day was first observed), clan_war_week_finished, feedback_responded, recording_started/stopped, role_changed (your tier). Poll this instead of re-polling data tools; meta.events_pending on any response tells you when there is something new. For a scheduled clan-management routine: read this feed from your cursor, then drill with war_current (decks_today), clans_roster, and battles_query.",
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
          maxItems: 12,
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
        const r = await removePlayer(ctx.db, ctx.account, { tag, via: "mcp" });
        return {
          player_tag: tag,
          removed: r.removed,
          recording_stopped: r.recordingStopped,
          primary_player_tag: r.promotedPrimary,
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      }
      // 'add': added = recorded. Slots count what you've ADDED (your
      // claims); owner/admin exempt - the website applies the same rule
      // through the same function.
      const r = await addPlayer(ctx.db, ctx.account, {
        tag,
        makePrimary: args.make_primary === true,
        via: "mcp",
      });
      if (!r.ok && r.error === "quota_exceeded") {
        throw new ToolFailure(
          "quota_exceeded",
          `Added players are capped at ${r.limit} for the ${r.role} tier.`,
          "Remove one, request a tier upgrade on the website, or run a collector for bonus slots.",
        );
      }
      if (!r.ok) {
        throw new ToolFailure("not_found", "Account not found.");
      }
      if (r.recordingStarted) {
        await emitFeedEvent(
          ctx.db,
          ctx.account.accountId,
          "recording_started",
          tag,
        );
      }
      return {
        player_tag: tag,
        added: r.added,
        recording: "active",
        recording_started: r.recordingStarted,
        notify: true,
        note: r.recordingStarted
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
};
