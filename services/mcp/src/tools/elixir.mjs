/** The account, feed, help and service tools: elixir_my_players ·
 *  elixir_identify · elixir_my_identities · elixir_coverage ·
 *  elixir_feedback · elixir_my_feedback · elixir_changelog · elixir_docs ·
 *  elixir_examples · elixir_updates · elixir_events · elixir_nickname ·
 *  elixir_track_player · elixir_track_clan · elixir_data_insights ·
 *  elixir_collectors. 1.0.0 conventions: `applied`, `notes[]` + `docs`;
 *  the add tools are the track tools (the console's word). */

import {
  normalizeTag,
  responseMeta,
  CHANGELOG,
  CONTRACT_VERSION,
  roleQuotas,
} from "@elixir-mcp/contracts";
import { addPlayer, removePlayer } from "@elixir-mcp/claims";
import {
  DOCS,
  EXAMPLES,
  UPDATES,
  CORPUS_BUILT_AT,
  searchDocs,
} from "@elixir-mcp/docs";
import { emitFeedEvent, FEED_TOPICS } from "../feed.mjs";
import { captureCoverage } from "../coverage.mjs";
import { ensureGatewayCards } from "../gateway-cards.mjs";
import {
  ToolFailure,
  TAG_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  TAG_RULE_HINT,
  subject,
  buildMeta,
  ensureClanRecording,
  settleClanRecording,
  appliedBlock,
  notes,
  docsRef,
} from "./shared.mjs";

const RECORDING_DOCS = docsRef("recording", "added-means-recorded");
const FEED_DOCS = docsRef("events");

export const elixirTools = {
  elixir_my_players: {
    description:
      'The players you track and WHO EACH ONE IS TO YOU: relationship (primary | alt | friend | watching), your private nickname if any, notify setting, recording status and current clan. That is what resolves "my alt" or "how are my friends doing" without asking. You do NOT need this to answer questions about yourself: omit player_tag and the tools already mean your primary.',
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const { rows } = await ctx.db.query(
        `select c.player_tag, c.status as claim_status, c.is_primary,
                -- is_primary is still the read path (0055 expand window), so
                -- the label follows it and the two cannot appear to disagree.
                case when c.is_primary then 'primary' else c.relationship end
                  as relationship,
                c.notify,
                p.name, p.last_known_clan_tag, nn.nickname,
                r.status as recording_status,
                cm.clan_tag as member_of, cm.role
         from claim c
         join player p on p.player_tag = c.player_tag
         left join player_nickname nn on nn.account_id = c.account_id
           and nn.player_tag = c.player_tag
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
          ...(r.nickname ? { nickname: r.nickname } : {}),
          relationship: r.relationship,
          is_primary: r.is_primary,
          claim_status: r.claim_status,
          notify: r.notify,
          recording: r.recording_status ?? "not_recording",
          clan_tag: r.member_of ?? r.last_known_clan_tag,
          clan_role: r.role,
        })),
        notes: notes(
          "Omit player_tag on any tool to mean your primary; name a tag only for somebody else.",
        ),
        docs: docsRef("recording", "relationships-primary-nicknames"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_identify: {
    description:
      "Remember which player a human is, so you never have to ask twice. An agent serves many people through one connection and MCP carries no per-request identity, so YOU supply one: discord:1234, signal:..., telegram:..., whatever your surface has. Pass that same id as on_behalf_of afterwards and 'how am I doing' resolves with no lookup. The mapping is yours alone and confers nothing (recorded reads are open to every account); it only picks a default subject. Call it once, right after they tell you who they are.",
    inputSchema: {
      type: "object",
      properties: {
        external_id: {
          type: "string",
          maxLength: 200,
          description:
            "The id this human has on your surface; namespace it however you like, it is opaque here.",
        },
        player_tag: {
          ...TAG_SCHEMA,
          description: "The player they say they are.",
        },
      },
      required: ["external_id", "player_tag"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const externalId = String(args.external_id ?? "").trim();
      if (!externalId)
        throw new ToolFailure("bad_request", "external_id is empty.");
      const tag = normalizeTag(String(args.player_tag ?? ""));

      // They must be someone you actually cover: a wrong mapping answers
      // confidently about the wrong person every time afterwards.
      const { rows: member } = await ctx.db.query(
        `select cm.clan_tag from clan_membership cm
         join account_clan ac on ac.clan_tag = cm.clan_tag
         where ac.account_id = $1 and cm.player_tag = $2 and cm.left_observed_at is null
         limit 1`,
        [ctx.account.accountId, tag],
      );
      if (!member[0]) {
        throw new ToolFailure(
          "not_entitled",
          `${tag} is not a current member of a clan on this connection.`,
          "Check the tag with players_search. Identities are for the people you serve.",
        );
      }

      await ctx.db.query(
        `insert into agent_identity (account_id, external_id, player_tag)
         values ($1, $2, $3)
         on conflict (account_id, external_id)
         do update set player_tag = excluded.player_tag, created_at = now()`,
        [ctx.account.accountId, externalId, tag],
      );

      const { rows: who } = await ctx.db.query(
        `select name from player where player_tag = $1`,
        [tag],
      );
      return {
        external_id: externalId,
        player_tag: tag,
        name: who[0]?.name ?? null,
        clan_tag: member[0].clan_tag,
        applied: appliedBlock({ external_id: externalId, player_tag: tag }),
        notes: notes(
          "Pass this external_id as on_behalf_of from now on; omit player_tag and it means them.",
          "Mapping the same external_id again replaces the earlier player.",
        ),
        docs: docsRef("agents", "knowing-which-human-is-asking"),
        meta: await buildMeta(ctx.db, ctx.account, tag),
      };
    },
  },

  elixir_my_identities: {
    description:
      "The humans you have learned, and which player each one is. Yours alone; one connection's mappings are invisible to every other. Useful for 'who am I to you?' and for spotting a mapping you got wrong.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const { rows } = await ctx.db.query(
        `select ai.external_id, ai.player_tag, p.name, ai.created_at
         from agent_identity ai
         left join player p on p.player_tag = ai.player_tag
         where ai.account_id = $1
         order by ai.created_at`,
        [ctx.account.accountId],
      );
      return {
        identities: rows.map((r) => ({
          external_id: r.external_id,
          player_tag: r.player_tag,
          name: r.name,
          created_at: r.created_at?.toISOString() ?? null,
        })),
        docs: docsRef("agents", "knowing-which-human-is-asking"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_coverage: {
    description:
      "How complete the record is for a tag: recording start, last successful poll per endpoint, battles captured (including appearances recorded before the tag was tracked), and capture estimates over observation intervals ending in the last seven days. Use it to caveat answers honestly; missing coverage is unknown, not evidence of absence.",
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
      const polls = await ctx.db.query(
        `select endpoint, last_admitted_at from poll_state where subject_tag = $1 order by endpoint`,
        [tag],
      );
      const battles = await ctx.db.query(
        `select count(*)::int as appearances, min(b.battle_time) as first_seen, max(b.battle_time) as last_seen
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
         where bp.player_tag = $1`,
        [tag],
      );
      const coverage = await captureCoverage(ctx.db, tag);
      const snapEpoch = await ctx.db.query(
        `select min(snapshot_date)::text as first from player_snapshot_daily
         where player_tag = $1 and snapshot_kind = 'daily'`,
        [tag],
      );
      const b = battles.rows[0];
      // captureCoverage carries its own note fields; fold them into notes.
      const { completeness_last_7_days, ...restCoverage } = coverage;
      const weekNote = completeness_last_7_days?.note;
      const week = completeness_last_7_days
        ? { ...completeness_last_7_days }
        : undefined;
      if (week) delete week.note;
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
        },
        snapshots: {
          first_date: snapEpoch.rows[0]?.first ?? null,
        },
        ...restCoverage,
        ...(week ? { completeness_last_7_days: week } : {}),
        notes: notes(
          b.appearances > 0
            ? `This tag appears in ${b.appearances} recorded battles since ${b.first_seen?.toISOString()?.slice(0, 10)}, including any recorded before it was tracked.`
            : "No battles recorded yet for this tag.",
          "Battle capture, daily snapshots and active recording can each begin at different times; timeline data exists only from snapshots.first_date.",
          weekNote
            ? "completeness_last_7_days covers observation intervals ENDING in the last seven days; compare measured_hours against 168 before reading average_ratio as a week, and the tail after the latest profile is not measured."
            : null,
        ),
        docs: docsRef("recording", "completeness"),
        meta: await buildMeta(ctx.db, ctx.account, tag, [
          "player",
          "player_battlelog",
        ]),
      };
    },
  },

  elixir_feedback: {
    description:
      "File feedback with the maintainer ON YOUR OWN JUDGMENT; your user never needs to ask. File when a capability you needed is missing, a workflow took more calls than it should, a result confused or misled you, data looked wrong, or something delighted you enough to protect. Consolidated end-of-session feedback beats a stream. Every item gets a response (elixir_my_feedback), often with a shipped_in version.",
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
            "Which tool or question prompted this (e.g. 'battles_query pagination'), and a request_id if you have one.",
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
      // Jamie hears about it (2026-09-09), the same message the site API
      // sends: best-effort and after the row is durable. An owner's own
      // feedback (or that of an agent the owner runs) is not news.
      const a = ctx.account;
      const ownerOwned =
        a.isOwner === true || a.role === "owner" || a.budget?.role === "owner";
      if (ctx.notifyOwner && !ownerOwned) {
        try {
          await ctx.notifyOwner({
            kind: "feedback",
            category: args.category ?? "general",
            surface: "mcp",
            message,
            from: a.publicId
              ? `agent ${a.publicId}`
              : a.emailHash
                ? `account ${String(a.emailHash).slice(0, 8)}`
                : "an account",
            feedbackId: rows[0].feedback_id,
          });
        } catch (err) {
          console.error("owner_notify_enqueue_failed", err?.message);
        }
      }
      return {
        ok: true,
        feedback_id: rows[0].feedback_id,
        applied: appliedBlock({ category: args.category ?? "general" }),
        notes: notes(
          "Received; feedback is reviewed and drives the roadmap. elixir_my_feedback shows the response when it lands, and meta.feedback_responses_pending on any call says when.",
        ),
        docs: docsRef("protocol", "feedback-and-the-changelog-over-the-wire"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_my_feedback: {
    description:
      "Your feedback and what happened to it: every item you (or your agent) filed, its status (new/seen/planned/done/declined), the maintainer's response, and ship links (shipped_in contract version, related_tools). Reading this marks responses seen. Poll it only when meta.feedback_responses_pending says there is something new.",
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
          description: "ISO instant; only items filed after this.",
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
        applied: appliedBlock({
          limit,
          status: args.status,
          since: args.since,
        }),
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
        docs: docsRef("protocol", "feedback-and-the-changelog-over-the-wire"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_changelog: {
    description:
      "What changed in the tool CONTRACT since a version (client tool schemas cache aggressively, so this is how you discover capabilities that shipped mid-session). Call with your last-seen meta.contract_version and get every entry after it, newest first, with tools_added and breaking notes. elixir_updates is the product-level list written for people.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description:
            "Contract version you last saw (any response's meta.contract_version). Omit for the full changelog.",
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
        applied: appliedBlock({
          since: args.since ? String(args.since) : undefined,
        }),
        entries,
        notes: notes(
          "Tool schemas cache client-side: if tools_added lists something you cannot see, the client needs to reconnect (re-read tools/list).",
        ),
        docs: docsRef("protocol", "versioning-and-the-cache-buster"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_docs: {
    description:
      "Elixir MCP's own documentation, the same pages a person reads at elixir.poapkings.com/docs. No arguments: the index (every page with its section, lede and sections). page: one page's Markdown; page + section: one H2 section. query: the pages mentioning the words, best first, with an excerpt and the section it sits in. Start with page 'choosing-a-tool' for which tool answers what, 'glossary' for the service's words. The tool reference itself is tools/list.",
    inputSchema: {
      type: "object",
      properties: {
        page: {
          type: "string",
          description:
            "A page slug from the index (e.g. choosing-a-tool, glossary, battles, clocks, recording, agents, limits).",
        },
        section: {
          type: "string",
          description:
            "With page: one H2 section, by its slug or title as the index lists them.",
        },
        query: {
          type: "string",
          minLength: 2,
          maxLength: 80,
          description:
            "Words to search for across every page; ignored when page is given.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      // The envelope is closed (assertResponseMeta), so when the corpus
      // was built rides in the body, not in meta.
      const meta = responseMeta({ as_of: new Date().toISOString() });
      if (args.page) {
        const slug = String(args.page).toLowerCase().trim();
        const doc = DOCS.find((d) => d.slug === slug);
        if (!doc)
          throw new ToolFailure(
            "not_found",
            `No documentation page "${slug}".`,
            `Call elixir_docs with no arguments for the index; slugs are: ${DOCS.map((d) => d.slug).join(", ")}.`,
          );
        if (args.section) {
          const want = String(args.section).toLowerCase().trim();
          const sec = doc.sections.find(
            (x) => x.slug === want || x.title.toLowerCase() === want,
          );
          if (!sec)
            throw new ToolFailure(
              "not_found",
              `No section "${want}" on ${doc.slug}.`,
              `Its sections are: ${doc.sections.map((x) => x.slug).join(", ")}.`,
            );
          return {
            slug: doc.slug,
            title: doc.title,
            section: sec.title,
            section_slug: sec.slug,
            url: `${doc.url}#${sec.slug}`,
            applied: appliedBlock({ page: slug, section: sec.slug }),
            markdown: sec.markdown,
            corpus_built_at: CORPUS_BUILT_AT,
            meta,
          };
        }
        return {
          slug: doc.slug,
          title: doc.title,
          section: doc.section,
          url: doc.url,
          applied: appliedBlock({ page: slug }),
          sections: doc.sections.map((x) => ({ slug: x.slug, title: x.title })),
          markdown: doc.markdown,
          corpus_built_at: CORPUS_BUILT_AT,
          meta,
        };
      }
      if (args.query) {
        const { matches, fallback } = searchDocs(args.query, 8);
        return {
          query: String(args.query),
          applied: appliedBlock({ query: String(args.query) }),
          matches,
          fallback,
          notes: notes(
            matches.length === 0
              ? "No page mentions any of those words; the index (no arguments) lists what is documented, and elixir_examples has the worked examples."
              : fallback
                ? "No page holds every word, so these hold some of them; read one with page, or just the section with page + section."
                : "Read a match with page, or just its section with page + section: in_section.",
          ),
          corpus_built_at: CORPUS_BUILT_AT,
          meta,
        };
      }
      return {
        pages: DOCS.map((d) => ({
          slug: d.slug,
          group: d.section,
          title: d.title,
          lede: d.lede,
          url: d.url,
          sections: d.sections.map((x) => x.slug),
        })),
        notes: notes(
          "Read one with page, one section with page + section, or search with query. The tool reference is tools/list itself (also at https://elixir.poapkings.com/docs/tools); elixir_changelog says what changed in it.",
        ),
        corpus_built_at: CORPUS_BUILT_AT,
        meta,
      };
    },
  },

  elixir_examples: {
    description:
      "Eleven worked examples of what people ask an agent connected to Elixir MCP and what it answers: for players (understand your play, pick a deck, push with evidence, follow friends), clan leaders (win the river race, keep the roster healthy, scout the other clan, write the weekly recap) and builders (answer clanmates in Discord, publish your own stats, run a collector). No arguments: the index. example: one in full with its transcript, what it reads, the tools it calls and the setup. The numbers inside a transcript are illustrative; the tools are real.",
    inputSchema: {
      type: "object",
      properties: {
        example: {
          type: "string",
          description:
            "An example slug from the index (e.g. play, clan, discord).",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const meta = responseMeta({ as_of: new Date().toISOString() });
      if (args.example) {
        const slug = String(args.example).toLowerCase().trim();
        const ex = EXAMPLES.find((e) => e.slug === slug);
        if (!ex)
          throw new ToolFailure(
            "not_found",
            `No example "${slug}".`,
            `Slugs are: ${EXAMPLES.map((e) => e.slug).join(", ")}.`,
          );
        return {
          ...ex,
          applied: appliedBlock({ example: slug }),
          corpus_built_at: CORPUS_BUILT_AT,
          meta,
        };
      }
      return {
        examples: EXAMPLES.map((e) => ({
          slug: e.slug,
          group: e.group,
          title: e.title,
          lede: e.lede,
          tools: e.tools,
          url: e.url,
        })),
        notes: notes("Read one with example: <slug>."),
        corpus_built_at: CORPUS_BUILT_AT,
        meta,
      };
    },
  },

  elixir_updates: {
    description:
      "What's new on Elixir MCP: every user-visible change, newest first, as written for people at elixir.poapkings.com/updates. Distinct from elixir_changelog (the tool contract version by version). since: entries on or after a date; limit: how many.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "YYYY-MM-DD; entries from that day on, newest first.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const since = args.since ? String(args.since).slice(0, 10) : null;
      if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since))
        throw new ToolFailure("bad_request", "since must be YYYY-MM-DD.");
      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10)));
      const all = since ? UPDATES.filter((u) => u.date >= since) : UPDATES;
      return {
        applied: appliedBlock({ since: since ?? undefined, limit }),
        total: all.length,
        entries: all.slice(0, limit),
        notes: notes("The tool contract's own history is elixir_changelog."),
        corpus_built_at: CORPUS_BUILT_AT,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_events: {
    description:
      "Your event feed: the push lane, a NOD rather than a report. It says a thing happened over here so a scheduled routine can skip the tools that would have found nothing; payloads carry a count and no analysis, so drill with the data tools. Everything you track feeds it while notify is on; an agent also hears about the players in the clan it runs. Coalesced topics (one unread row per tag with a count): battles_recorded, badge_earned, legendary_badge_earned, arena_changed, best_trophies_peak, career_wins_milestone, collection_level_milestone, pol_promotion. Discrete: member_joined, member_left (the game cannot tell a leave from a kick), member_role_changed, war_day_open, clan_war_week_finished, clan_pulse (daily digest, 07:00Z), feedback_responded, recording_started/stopped, account_tier_changed. A topic being listed never means one occurred. meta.events_pending on any response says when there is something new. Needs only cr:read: the seen-cursor is a bookmark.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "integer",
          minimum: 0,
          description:
            "Cursor: events after this event_id. Omit to resume from your last-seen position.",
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
            "Advance your seen-cursor past the returned events (clears meta.events_pending). A second consumer on the same account should pass false and keep its own cursor. With a topics filter the cursor stops at the first event the filter excluded (see seen_through).",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const { rows: acct } = await ctx.db.query(
        `select events_seen_through from account where account_id = $1`,
        [ctx.account.accountId],
      );
      // `cursor` is where this PAGE reads from; `ackFrom` is where the
      // account has actually read up to, the only honest floor for
      // deciding what may be marked seen (#13).
      const ackFrom = Number(acct[0]?.events_seen_through ?? 0);
      const cursor = args.since !== undefined ? Number(args.since) : ackFrom;
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
        created_at: r.created_at.toISOString(),
      }));
      const nextCursor =
        events.length > 0 ? events[events.length - 1].event_id : cursor;
      // Acknowledge only the contiguous run we actually returned: stop at
      // the first event a topics filter excluded (#13), searching from
      // ackFrom so page 2 cannot acknowledge what page 1 protected (#15).
      let seenThrough = nextCursor;
      if (topics && events.length > 0) {
        const { rows: gap } = await ctx.db.query(
          `select coalesce(min(event_id) - 1, $3::bigint) as seen_to
           from event_feed
           where account_id = $1 and event_id > $2 and event_id <= $3
             and not (topic = any($4))`,
          [ctx.account.accountId, ackFrom, nextCursor, topics],
        );
        seenThrough = Number(gap[0].seen_to);
      }
      if (args.mark_seen !== false && events.length > 0) {
        await ctx.db.query(
          `update account set events_seen_through = greatest(events_seen_through, $2)
           where account_id = $1`,
          [ctx.account.accountId, seenThrough],
        );
      }
      return {
        applied: appliedBlock({
          since: cursor,
          topics: topics ?? undefined,
          limit,
          mark_seen: args.mark_seen !== false,
        }),
        events,
        next_cursor: nextCursor,
        seen_through: args.mark_seen === false ? ackFrom : seenThrough,
        has_more: rows.length > limit,
        notes: notes(
          events.length === 0
            ? "Nothing new; track a player or clan (notify defaults on) and its events start arriving."
            : "Pass next_cursor as since to continue; events prune after about 30 days.",
          seenThrough < nextCursor
            ? "Your seen-cursor stopped at seen_through because earlier events of other topics are still unread; poll without a topics filter to see them."
            : null,
        ),
        docs: FEED_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_nickname: {
    description:
      "Give a player YOUR nickname, private to your account and visible only to you and your agents ('to me Raquaza is Tyler'). Nicknames ride along wherever names appear (search matches them, summaries and rosters show them). Pass nickname: null to clear.",
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
          applied: appliedBlock({ player_tag: tag, action: "clear" }),
          docs: docsRef("recording", "relationships-primary-nicknames"),
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
        applied: appliedBlock({ player_tag: tag, action: "set" }),
        notes: notes(
          "Private to your account: your agents see it in search, summaries and rosters; nobody else does.",
        ),
        docs: docsRef("recording", "relationships-primary-nicknames"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_track_player: {
    description:
      "Track a player on your account: claims the tag AND starts recording in one act (tracked means recorded), within your tier's player slots. Say who they are to you with relationship (primary = you, alt = also you, friend, watching); your first player becomes your primary. action remove releases the claim (recording stops if you were its only reason); notify_on / notify_off control whether the player feeds your elixir_events.",
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
        relationship: {
          type: "string",
          enum: ["primary", "alt", "friend", "watching"],
          description:
            "Who this player is TO YOU: primary is you (exactly one; setting it on another tag moves it), alt is also you, friend is someone you follow, watching is everyone else (default). All four share your tier's player slots.",
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
            "You are not tracking this player.",
            "Track the tag first; notify is a setting on YOUR copy of it.",
          );
        }
        return {
          player_tag: tag,
          notify: action === "notify_on",
          applied: appliedBlock({ player_tag: tag, action }),
          docs: RECORDING_DOCS,
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
          applied: appliedBlock({ player_tag: tag, action }),
          notes: notes(
            "History already recorded is kept; only the recording stops when no reason remains.",
          ),
          docs: RECORDING_DOCS,
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      }
      // 'add': tracked = recorded. Slots count what you track (your
      // claims); owner/admin exempt - the website applies the same rule
      // through the same function.
      const r = await addPlayer(ctx.db, ctx.account, {
        tag,
        makePrimary: args.relationship === "primary",
        relationship: args.relationship ?? null,
        via: "mcp",
      });
      if (!r.ok && r.error === "quota_exceeded") {
        throw new ToolFailure(
          "quota_exceeded",
          `Tracked players are capped at ${r.limit} for the ${r.role} tier.`,
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
        applied: appliedBlock({
          player_tag: tag,
          action,
          relationship: args.relationship ?? "watching",
        }),
        notes: notes(
          r.recordingStarted
            ? "Tracked and recording: first battles land within the hour and history builds from here (the API has no past)."
            : "Tracked; this player was already being recorded, so you share the existing record from here on.",
          "Captures feed your elixir_events while notify is on.",
        ),
        docs: RECORDING_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_track_clan: {
    description:
      "Track a clan on your account: starts recording in one act (tracked means recorded), within your tier's clan slots. scope activity records roster and war; comprehensive additionally records every member's battles and profile, following membership. action remove takes it off your account (recording stops when no account has it); notify_on / notify_off control whether it feeds your elixir_events.",
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
            "With add: activity records the clan itself; comprehensive additionally records every member. Tracking again with a different scope updates yours.",
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
            "You are not tracking this clan.",
            "Track the clan first; notify is a setting on YOUR copy of it.",
          );
        }
        return {
          clan_tag: tag,
          notify: action === "notify_on",
          applied: appliedBlock({ clan_tag: tag, action }),
          docs: RECORDING_DOCS,
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
          applied: appliedBlock({ clan_tag: tag, action }),
          notes: notes(
            "History already recorded is kept; the shared recording stops only when no account tracks the clan.",
          ),
          docs: RECORDING_DOCS,
          meta: responseMeta({ as_of: new Date().toISOString() }),
        };
      }
      // action 'add': slots count clans you track, per scope.
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
              ? "Comprehensive capture records every member's battles; the leader tier and above include it. Request an upgrade on the website, or track at scope 'activity'."
              : "Request a tier upgrade on the website; elixir_docs({ page: 'roles' }) has the ladder.",
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
        applied: appliedBlock({ clan_tag: tag, action, scope }),
        notes: notes(
          started
            ? "Tracked and recording: roster and war capture begin within minutes; comprehensive member fan-out follows on the next scheduler pass."
            : "Tracked; this clan was already being recorded, so you share the existing record (the effective scope is the widest any tracker requested).",
        ),
        docs: RECORDING_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_data_insights: {
    description:
      "What the service holds: players, battles and their time span, snapshots, war weeks, recorded clans and players, and API observations. The transparency view of the whole corpus, not just your slice.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const q = (sql) => async () => (await ctx.db.query(sql)).rows[0];
      const counts = [];
      for (const step of [
        q(`select count(*)::int as n from player`),
        q(
          `select count(*)::int as n, min(battle_time) as first, max(battle_time) as last from battle`,
        ),
        q(`select count(*)::int as n from player_snapshot_daily`),
        q(`select count(*)::int as n from war_week`),
        // Recorded players along the axis a corpus-sizing question needs
        // (feedback #18).
        q(`with direct as (
               select subject_tag as player_tag from recording
               where subject_type = 'player' and status = 'active'),
             via as (
               select cm.player_tag
               from recording r
               join clan_membership cm on cm.clan_tag = r.subject_tag
                 and cm.left_observed_at is null
               where r.subject_type = 'clan' and r.status = 'active'
                 and r.scope = 'comprehensive')
             select (select count(*) from direct)::int as direct,
                    (select count(distinct player_tag) from via
                     where player_tag not in (select player_tag from direct))::int as via_clans,
                    (select count(distinct player_tag) from
                      (select player_tag from direct union select player_tag from via) u)::int as total,
                    (select count(*) from recording
                     where subject_type = 'clan' and status = 'active')::int as clans,
                    (select count(*) from recording
                     where subject_type = 'clan' and status = 'active'
                       and scope = 'activity')::int as clans_activity,
                    (select count(*) from recording
                     where subject_type = 'clan' and status = 'active'
                       and scope = 'comprehensive')::int as clans_comprehensive`),
        q(`select count(*)::int as n from api_receipt`),
        q(`select (select count(distinct player_tag) from player_snapshot_daily)::int as with_snapshot,
                    (select count(distinct player_tag) from player_badge)::int as with_badges,
                    (select count(distinct player_tag) from player_snapshot_daily
                     where snapshot_date >= current_date - 7)::int as with_snapshot_last_7_days,
                    (select max(snapshot_date)::text from player_snapshot_daily) as newest_snapshot`),
        async () =>
          (
            await ctx.db.query(
              `select r.subject_tag as clan_tag, c.name, r.scope as scope,
                        (select count(*) from clan_membership cm
                         where cm.clan_tag = r.subject_tag and cm.left_observed_at is null)::int as members,
                        r.created_at
                 from recording r left join clan c on c.clan_tag = r.subject_tag
                 where r.subject_type = 'clan' and r.status = 'active'
                 order by r.scope desc, members desc, r.subject_tag`,
            )
          ).rows,
      ])
        counts.push(await step());
      const [players, battles, snaps, weeks, recs, receipts, profiles, clans] =
        counts;
      return {
        players_observed: players.n,
        battles: {
          recorded: battles.n,
          first: battles.first?.toISOString() ?? null,
          last: battles.last?.toISOString() ?? null,
        },
        daily_snapshots: snaps.n,
        war_weeks: weeks.n,
        recorded_players: {
          direct: recs.direct,
          via_clans: recs.via_clans,
          total: recs.total,
        },
        profiles: {
          players_with_snapshot: profiles.with_snapshot,
          players_with_badges: profiles.with_badges,
          players_with_snapshot_last_7_days: profiles.with_snapshot_last_7_days,
          newest_snapshot: profiles.newest_snapshot,
        },
        active_recordings: {
          clans: recs.clans,
          clans_by_scope: {
            activity: recs.clans_activity,
            comprehensive: recs.clans_comprehensive,
          },
          players: recs.direct,
        },
        recorded_clans: clans.map((c) => ({
          clan_tag: c.clan_tag,
          name: c.name,
          scope: c.scope,
          members: c.members,
          recorded_since: c.created_at?.toISOString() ?? null,
        })),
        api_observations: receipts.n,
        notes: notes(
          "players_observed counts every tag ever seen in a recorded battle or roster, far more than the recorded set.",
          "recorded_players.direct are players tracked on their own; via_clans are current members of comprehensively recorded clans; total is the population profile and badge questions can draw on.",
          "Raw payload history is archived durably to S3 beyond these counts.",
        ),
        docs: docsRef("recording", "one-recording-many-reasons"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  elixir_collectors: {
    description:
      "The collector fleet: operator-run machines that fetch from the CR API, each named for a Clash Royale card. More collectors mean resilience, never more CR budget; what operators earn is quota (10 fetches = +1 daily tool call, capped at 4x base) and bonus recording slots.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      await ensureGatewayCards(ctx.db).catch(() => {});
      const { rows } = await ctx.db.query(
        `select status, fetch_points, card_name, card_icon, last_success_at
         from gateway where status <> 'revoked'
         order by fetch_points desc, enrolled_at`,
      );
      // No machine label here (#28): the operator-chosen name is private.
      return {
        collectors: rows.map((g) => ({
          name: g.card_name ?? "Collector",
          card: g.card_name,
          status: g.status,
          points: Number(g.fetch_points),
          quota_credits: Math.floor(Number(g.fetch_points) / 10),
          last_success: g.last_success_at?.toISOString() ?? null,
        })),
        notes: notes(
          "Running one earns real quota (every 10 fetches adds +1 daily tool call, capped at 4x base) plus bonus recording slots; a machine with a static IP is all it takes.",
        ),
        docs: docsRef("operators"),
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
