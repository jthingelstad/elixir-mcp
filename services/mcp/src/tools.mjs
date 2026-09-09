/**
 * The V1 tool registry — docs/ENGINEERING.md Declarations (JSON Schema) and
 * handlers live together in the per-group modules under ./tools/ so a
 * schema and its behavior can't drift; this file only assembles the
 * registry (split from one 3,800-line file, review item 8). Handlers
 * throw ToolFailure for structured errors (the closed taxonomy); the
 * invoker renders them as {error, meta} bodies with isError: true.
 */

import {
  assertResponseMeta,
  TOOL_GROUPS,
  GROUP_ORDER,
  requiredOAuthScope,
  toolsHiddenFrom,
} from "@elixir-mcp/contracts";
import { elixirTools } from "./tools/elixir.mjs";
import { collectionsTools } from "./tools/collections.mjs";
import { battlesTools } from "./tools/battles.mjs";
import { opponentsTools } from "./tools/opponents.mjs";
import { badgesTools } from "./tools/badges.mjs";
import { cardsTools } from "./tools/cards.mjs";
import { clansTools } from "./tools/clans.mjs";
import { liveTools } from "./tools/live.mjs";
import { playersTools } from "./tools/players.mjs";
import { warTools } from "./tools/war.mjs";

export {
  ToolFailure,
  ensureClanRecording,
  settleClanRecording,
} from "./tools/shared.mjs";

const TOOLS = {
  ...elixirTools,
  ...collectionsTools,
  ...battlesTools,
  ...opponentsTools,
  ...badgesTools,
  ...cardsTools,
  ...clansTools,
  ...liveTools,
  ...playersTools,
  ...warTools,
};

/**
 * `kind` shapes what a connection can see and call. It is threaded in rather
 * than read from a module global because one Lambda serves every principal,
 * and a cached registry that remembered the last caller's kind would be the
 * worst possible bug in this file.
 */
export function makeRegistry() {
  return {
    has: (name) => Object.hasOwn(TOOLS, name),
    requiredScope: (name) => requiredOAuthScope(name),
    /** Omitted from the list AND refused on call: clients cache tools/list
     *  forever, so a tool that merely disappears is still callable. */
    availableTo: (name, kind) => !toolsHiddenFrom(kind).has(name),
    declarations: (kind = null) =>
      Object.entries(TOOLS)
        .filter(([name]) => !toolsHiddenFrom(kind).has(name))
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
    invoke: async (name, ctx, args) => {
      const body = await TOOLS[name].handler(ctx, args);
      assertResponseMeta(body?.meta);
      return body;
    },
  };
}
