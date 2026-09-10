/** collections_browse · collections_get · collections_edit. 1.0.0: the
 *  argument is `collection`, the name every segment tool already used. */

import { responseMeta } from "@elixir-mcp/contracts";
import { normalizeTag, InvalidTagError } from "@elixir-mcp/contracts";
import { setCollectionMembers } from "@elixir-mcp/claims";
import { ToolFailure, appliedBlock, notes, docsRef } from "./shared.mjs";

const MAX_TAGS_PER_CALL = 500;
const COLLECTION_DOCS = docsRef("recording", "collections");

const COLLECTION_SCHEMA = {
  type: "string",
  minLength: 2,
  maxLength: 40,
  description: "The collection's slug, as collections_browse lists it.",
};

export const collectionsTools = {
  collections_browse: {
    description:
      "Curated collections of players or clans: the owner-published lists (pros, creators, clan families) plus any you own. A collection is its curator's editorial grouping, not a global fact about its members.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const { rows } = await ctx.db.query(
        `select c.slug, c.title, c.kind, c.description, c.visibility, c.scope,
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
          scope: r.scope,
          member_count: r.member_count,
        })),
        notes: notes(
          "Everything in a collection is recorded for as long as it stays there, at the collection's scope.",
        ),
        docs: COLLECTION_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  collections_get: {
    description:
      "One collection's members, enriched: players come with name, latest trophies, tenure and recording status; clans with name and open-member count. Fan into the player and battle tools per tag from here, or pass the collection as a segment to the meta tools.",
    inputSchema: {
      type: "object",
      properties: { collection: COLLECTION_SCHEMA },
      required: ["collection"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const slug = String(args.collection).toLowerCase();
      const { rows: col } = await ctx.db.query(
        `select * from collection
         where slug = $1 and (visibility = 'public' or owner_account = $2)`,
        [slug, ctx.account.accountId],
      );
      if (!col[0])
        throw new ToolFailure(
          "not_found",
          `No collection named '${slug}'.`,
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
          curator_note: r.note,
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
          curator_note: r.note,
        }));
      }
      return {
        slug: c.slug,
        applied: appliedBlock({ collection: c.slug }),
        title: c.title,
        kind: c.kind,
        description: c.description,
        scope: c.scope,
        members,
        notes: notes(
          "scope says how deeply members are recorded: comprehensive captures battles, activity only the surface.",
          "recording false members may have thin or no data yet; elixir_coverage tells the capture story per tag.",
        ),
        docs: COLLECTION_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },

  collections_edit: {
    description:
      "Change what is in a collection you own. action add and remove adjust membership; set replaces it with exactly the tags given (the shape an external roster sync wants). Everything in a collection is RECORDED while it stays there, so adding a tag starts collecting it and removing the last reason to keep it stops. Idempotent; up to 500 tags per call; one malformed tag refuses the whole call.",
    inputSchema: {
      type: "object",
      properties: {
        collection: {
          ...COLLECTION_SCHEMA,
          description: "The collection to change (its slug).",
        },
        action: {
          type: "string",
          enum: ["add", "remove", "set"],
          default: "add",
          description:
            "add/remove adjust the current membership; set replaces it wholesale.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Player or clan tags, matching the collection's kind. Folded to canonical form.",
        },
      },
      required: ["collection", "tags"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const slug = String(args.collection ?? "").toLowerCase();
      const { rows: col } = await ctx.db.query(
        `select collection_id, kind, owner_account, scope, title
         from collection where slug = $1`,
        [slug],
      );
      if (!col[0]) {
        throw new ToolFailure(
          "not_found",
          `No collection named '${slug}'.`,
          "collections_browse lists what exists.",
        );
      }
      // Curation is the curator's. Reading is open; writing is not.
      if (col[0].owner_account !== ctx.account.accountId) {
        throw new ToolFailure(
          "not_entitled",
          `'${slug}' belongs to someone else.`,
          "You can only edit collections you own.",
        );
      }
      const raw = Array.isArray(args.tags) ? args.tags : [];
      if (raw.length > MAX_TAGS_PER_CALL) {
        throw new ToolFailure(
          "bad_request",
          `${raw.length} tags in one call; the limit is ${MAX_TAGS_PER_CALL}.`,
          "Sync in batches with action 'add', or build the full roster and send one 'set'.",
        );
      }
      // A silent skip on a malformed tag would quietly drop somebody
      // from a synced roster, so a bad tag fails the whole call.
      const tags = [];
      for (const one of raw) {
        try {
          tags.push(normalizeTag(String(one)));
        } catch (err) {
          if (err instanceof InvalidTagError || err?.code) {
            throw new ToolFailure(
              "bad_request",
              `'${String(one).slice(0, 20)}' is not a valid Clash Royale tag.`,
              "Tags look like #20JJJ2CCRU. Nothing was changed.",
            );
          }
          throw err;
        }
      }

      const action = ["add", "remove", "set"].includes(args.action)
        ? args.action
        : "add";
      // add/remove are sent as deltas so two syncs cannot race each other.
      const r = await setCollectionMembers(
        ctx.db,
        {
          collectionId: col[0].collection_id,
          kind: col[0].kind,
          ownerAccount: col[0].owner_account,
        },
        tags,
        { mode: action },
      );
      return {
        slug,
        applied: appliedBlock({ collection: slug, action, tags: tags.length }),
        kind: col[0].kind,
        scope: col[0].scope,
        added: r.added,
        removed: r.removed,
        members: r.total,
        recordings_started: r.recordingsStarted,
        recordings_stopped: r.recordingsStopped,
        notes: notes(
          `'${col[0].title}' now holds ${r.total} ${col[0].kind}${r.total === 1 ? "" : "s"}, recorded at ${col[0].scope} scope.`,
          "New members begin collecting within the hour; players_profile or clans_roster with live: true reads one immediately.",
        ),
        docs: COLLECTION_DOCS,
        meta: responseMeta({ as_of: new Date().toISOString() }),
      };
    },
  },
};
