/** collections_browse · collections_get — moved verbatim from the
 *  single-file registry (review item 8). */

import { responseMeta } from "@elixir-mcp/contracts";
import { ToolFailure } from "./shared.mjs";

export const collectionsTools = {
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
};
