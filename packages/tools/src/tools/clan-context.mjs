import { responseMeta } from "@elixir-mcp/contracts";
import {
  readAgentPolicyContext,
  readOwnClanView,
} from "@elixir-mcp/auth/clan-context";
import { ToolFailure, docsRef, entitledClan, notes } from "./shared.mjs";

/** The two seams into private Clan state (`@elixir-mcp/auth/clan-context`),
 *  and the only tools that may read through it
 *  (services/web-api/test/clan-boundary.test.mjs). */

const LEADERS = new Set(["leader", "coLeader"]);

/** What a refused caller is told: the view is a person's own, for a player
 *  they have verified (Jamie, 2026-10-12, #535). */
const OWN_VIEW_REFUSALS = {
  not_a_person: [
    "Your own Clan view is read only by a person's own connection.",
    "An agent or an integration never reads a person's Clan view: connect as yourself at /mcp. A clan agent reads its clan's war intent with clans_context.",
  ],
  not_verified_member: [
    "None of your verified players is a current member of this clan.",
    "Your own Clan view needs a player of yours you have verified in Elixir (Console, Verify) who is in this clan now; an unverified claim reads nothing here. elixir_my_players lists your players and which are verified.",
  ],
};

export const clanContextTools = {
  clans_context: {
    description:
      "Your assigned clan’s explicit war participation intent and policy revision, for an agent with a separately approved private-context grant. No clan argument: the current assignment, actual owner and verified current membership are checked on every read. Unknown intent is never a participation decision. Refresh at startup, before planning and immediately before firing an affected routine; defer that routine on unknown or error. No scoring, notes, member decisions or other private policy fields.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      const context = await readAgentPolicyContext(ctx.db, ctx.account);
      if (!context)
        throw new ToolFailure(
          "not_entitled",
          "Private clan context is not authorized.",
          "A separately approved grant and current verified owner membership are required; game read scopes and tracked clans do not grant policy access.",
        );
      return {
        context,
        applied: {},
        notes: notes(
          "policy_saved_at is save provenance; read_at times this current read. Unknown or failed context must defer the affected routine.",
        ),
        docs: docsRef("clan-policy", "agent-context"),
        meta: responseMeta({ as_of: context.read_at }),
      };
    },
  },
  clans_my_view: {
    description:
      "Your own view of your clan in Elixir Clan, your primary player's clan by default: the policy summary, your own standing line, and the Actions waiting for you as summary lines, each with a url to open it in Clan. For your own connection and a player you have verified. From Clan's last evaluation; never another member's line or clock, never a removal Action, never an Action's evidence or log. Read-only: deciding happens in Clan.",
    inputSchema: {
      type: "object",
      properties: {
        clan_tag: {
          type: "string",
          description:
            "Clan tag like #J2RGCRVG. Omit to mean your primary player's clan; a clan named must be one Elixir records.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      if ((ctx.account?.kind ?? "person") !== "person")
        throw new ToolFailure(
          "not_entitled",
          ...OWN_VIEW_REFUSALS.not_a_person,
        );
      const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
      const read = await readOwnClanView(ctx.db, ctx.account, clanTag);
      if (read.refused)
        throw new ToolFailure(
          "not_entitled",
          ...OWN_VIEW_REFUSALS[read.refused],
        );
      const { view } = read;
      return {
        view,
        applied: { clan_tag: clanTag },
        notes: notes(
          view.reason === null
            ? "standing and actions are from Clan's last evaluation (standing.evaluated_at); Clan's own page reads live, so it can be newer. Open an Action's url to read it whole and decide it in Clan."
            : view.reason === "not_evaluated"
              ? "Clan has not evaluated the clan under its current policy for your player yet, so standing and actions are null; Clan's own page evaluates when it is opened."
              : null,
          LEADERS.has(view.you.role)
            ? "Some Actions are shown only in Elixir Clan: open the clan's Actions list there for every Action waiting for you."
            : null,
        ),
        docs: docsRef("clan-policy", "your-own-view"),
        meta: responseMeta({ as_of: view.read_at }),
      };
    },
  },
};
