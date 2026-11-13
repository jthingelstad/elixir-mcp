import { responseMeta } from "@elixir-mcp/contracts";
import {
  readClanDirectory,
  readOwnClanView,
} from "@elixir-mcp/auth/clan-context";
import { ToolFailure, docsRef, entitledClan, notes } from "./shared.mjs";

/** The two reads through the private-Clan-state seam
 *  (`@elixir-mcp/auth/clan-context`), and the only tools that may read
 *  through it (services/web-api/test/clan-boundary.test.mjs): a person's own
 *  view of their clan, and the clan directory (the policy's public part). */

const LEADERS = new Set(["leader", "coLeader"]);

/** The social reads are a person's and their agents' (DECISIONS "Agents
 *  read the social layer and never write it"): an integration, or an agent
 *  or person not approved, reads none of them. */
const SOCIAL_REFUSAL = [
  "not_entitled",
  "The clan directory is read by a person's own connection and their agents.",
  "An integration has no person to read for. Connect as yourself at /mcp, or through an agent of yours whose owner is approved.",
];

/** What a refused caller is told: the view is a person's own, for a player
 *  they have verified (Jamie, 2026-10-12, #535). */
const OWN_VIEW_REFUSALS = {
  not_a_person: [
    "Your own Clan view is read only by a person's own connection.",
    "An agent or an integration never reads a person's Clan view: connect as yourself at /mcp. A clan's war intent is public in the clan directory (clans_directory).",
  ],
  not_verified_member: [
    "None of your verified players is a current member of this clan.",
    "Your own Clan view needs a player of yours you have verified in Elixir (Settings, Players & following, Verify) who is in this clan now; an unverified claim reads nothing here. elixir_my_players lists your players and which are verified.",
  ],
};

export const clanContextTools = {
  clans_directory: {
    description:
      "The clan directory, as Home's Clans page lists it: every recorded clan whose leaders saved a policy in Clan, each with its recorded name, type, size, trophies to join and description, and the policy's public part (Clan Wars intent, posture, playing together, what counts, the removal day). yours marks a clan one of your verified players is in (an agent reads as its owner). Ordered by name, never ranked. For a person's own connection and their agents.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler(ctx) {
      if (ctx.account?.kind === "integration")
        throw new ToolFailure(...SOCIAL_REFUSAL);
      const read = await readClanDirectory(ctx.db, ctx.account);
      if (read.refused) throw new ToolFailure(...SOCIAL_REFUSAL);
      const { directory } = read;
      return {
        clans: directory.clans,
        truncated: directory.truncated,
        applied: {},
        notes: notes(
          "A clan is listed once its leaders save a policy in Clan; policy is the saved policy's public part, never who saved it, a note, a minimum or a member's standing.",
          ctx.account?.kind === "agent"
            ? "yours is your owner's: a clan one of their verified players is in now."
            : null,
          directory.truncated
            ? `The directory holds more clans than one read returns; these are the first ${directory.clans.length} by name.`
            : null,
        ),
        docs: docsRef("clan-directory", "agents-and-apps"),
        meta: responseMeta({ as_of: directory.read_at }),
      };
    },
  },
  clans_my_view: {
    description:
      "Your own view of your clan in Clan, your primary player's clan by default: the policy summary, your own standing line, and the Actions waiting for you as summary lines, each with a url to open it in Clan. For your own connection and a player you have verified. From Clan's last evaluation; never another member's line or clock, never a removal Action, never an Action's evidence or log. Read-only: deciding happens in Clan.",
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
            ? "Some Actions are shown only in Clan: open the clan's Actions list there for every Action waiting for you."
            : null,
        ),
        docs: docsRef("clan-your-own-view", "your-own-view"),
        meta: responseMeta({ as_of: view.read_at }),
      };
    },
  },
};
