/**
 * The tool registry (docs/ENGINEERING.md, Tool conventions). Declarations
 * (JSON Schema) and handlers live together in the per-group modules under
 * ./tools/ so a schema and its behavior can't drift; this file only
 * assembles the registry. Handlers throw ToolFailure for structured errors
 * (the closed taxonomy); the invoker renders them as {error, meta} bodies
 * with isError: true.
 */

import { createHash } from "node:crypto";
import {
  assertResponseMeta,
  TOOL_GROUPS,
  GROUP_ORDER,
  requiredOAuthScope,
} from "@elixir-mcp/contracts";
import { elixirTools } from "./tools/elixir.mjs";
import { battlesTools } from "./tools/battles.mjs";
import { opponentsTools } from "./tools/opponents.mjs";
import { cardsTools } from "./tools/cards.mjs";
import { clanContextTools } from "./tools/clan-context.mjs";
import { clansTools } from "./tools/clans.mjs";
import { liveTools } from "./tools/live.mjs";
import { playersTools } from "./tools/players.mjs";
import { warTools } from "./tools/war.mjs";
import { game_events } from "./tools/game-events.mjs";
import { seriesTools } from "./tools/series.mjs";
import { socialTools } from "./tools/social.mjs";
import { validateArgs } from "./validate.mjs";
import { OUTPUT_SCHEMAS } from "./output-schemas.mjs";
import { ToolFailure } from "./tools/shared.mjs";

export { ToolFailure, ensureClanRecording } from "./tools/shared.mjs";

const EVENT_POOL_NOTE =
  "mode 'event' pools every event in the window: one event is not another (a tournament, a seasonal Trophy Road and a 2v2 weekend are different games), so a rate here mixes them. For one event's record, battles_performance group_by game_mode gives one row per event (event_tag, event_title); battles_query lists context.event_tag per battle. Clanmate battles are casual even when tagged, so they are not here.";

const TOOLS = {
  ...elixirTools,
  ...battlesTools,
  ...opponentsTools,
  ...cardsTools,
  ...clansTools,
  ...clanContextTools,
  ...seriesTools,
  ...liveTools,
  ...playersTools,
  ...socialTools,
  ...warTools,
  game_events,
};

/** The size control a one-size tool publishes (6.2.0, feedback #74).
 *  6.0.0 made the server accept verbosity on every tool, but the
 *  published schemas still said additionalProperties: false without
 *  it, so a client that validates arguments before dispatch refused the
 *  call locally and never saw the note. The declaration is the promise
 *  clients read; it now matches the runtime. Handlers keep their own
 *  schemas: invoke() still recognises a one-size tool by the property's
 *  absence there and strips the argument before validation. */
const ONE_SIZE_VERBOSITY = {
  type: "string",
  enum: ["full", "compact"],
  default: "full",
  description:
    "This tool has one size: compact is accepted and changes nothing (the response says so in a note).",
};

function publishedInputSchema(schema) {
  if (Object.hasOwn(schema.properties ?? {}, "verbosity")) return schema;
  return {
    ...schema,
    properties: { ...(schema.properties ?? {}), verbosity: ONE_SIZE_VERBOSITY },
  };
}

export function makeRegistry() {
  return {
    has: (name) => Object.hasOwn(TOOLS, name),
    /** Whether a tool declares an argument (a refusal's hint names only
     *  arguments the tool takes: Gym #104). */
    accepts: (name, arg) =>
      Object.hasOwn(TOOLS[name]?.inputSchema?.properties ?? {}, arg),
    requiredScope: (name) => requiredOAuthScope(name),
    // One catalogue for every connection: the site's tool reference,
    // tools.json, tools/list and the tests all read this.
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
            inputSchema: publishedInputSchema(t.inputSchema),
            // The response contract (output-schemas.mjs; every tool has
            // one since 6.14.0): rendered on the docs, validated below.
            ...(OUTPUT_SCHEMAS[name]
              ? { outputSchema: OUTPUT_SCHEMAS[name] }
              : {}),
            annotations: {
              // Group rides the title: clients that sort tools by title
              // cluster the groups; clients that ignore titles lose nothing.
              title: `${cls.group} · ${cls.title}`,
              readOnlyHint: cls.readOnly,
              // True when any action removes or replaces something the
              // caller owns: a client may confirm those.
              destructiveHint: cls.destructive ?? false,
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
    invoke: async (name, ctx, rawArgs) => {
      // verbosity is the one size control and the instructions say so
      // without listing tools, so agents pass it everywhere (four
      // refusals in four days, 2026-09-19). A tool with one size accepts
      // it, drops it before validation, echoes applied.verbosity as full
      // and says in a note that compact had nothing to drop. Additive:
      // the eleven tools that declare it are unchanged.
      let args = rawArgs ?? {};
      let oneSize = null;
      if (
        Object.hasOwn(args, "verbosity") &&
        !Object.hasOwn(TOOLS[name].inputSchema.properties ?? {}, "verbosity")
      ) {
        const { verbosity, ...rest } = args;
        if (verbosity !== "full" && verbosity !== "compact")
          throw new ToolFailure(
            "bad_request",
            "arguments.verbosity must be one of full, compact.",
            `${name} has one size; verbosity is accepted and has no effect.`,
          );
        oneSize = verbosity;
        args = rest;
      }
      // The declared schema is the contract clients see; enforce it before
      // a handler can see anything the schema did not promise.
      // Validated against the published schema, so an unknown-argument
      // refusal's "Known:" list names verbosity on a one-size tool too
      // (Gym #151); verbosity itself was taken off args above.
      const problem = validateArgs(
        publishedInputSchema(TOOLS[name].inputSchema),
        args,
      );
      if (problem) {
        // A missing required argument's hint is that argument's own
        // description (4.0.0), not an instruction to read tools/list.
        const missing = /^arguments\.([a-z_]+) is required\.$/.exec(problem);
        const own =
          missing &&
          TOOLS[name].inputSchema.properties?.[missing[1]]?.description;
        // An argument the server does not know is most often a client
        // holding an older tools/list: say which tools this server has
        // and that a reconnect re-reads them, as the unknown-tool hint does.
        const unknown = / has no property '/.test(problem);
        throw new ToolFailure(
          "bad_request",
          problem,
          own ??
            (unknown
              ? `This server's tools are ${TOOLS_VERSION}; the arguments it takes are this tool's inputSchema in tools/list. If your client cached that list earlier (serverInfo.version differs), reconnect.`
              : "Valid values and shapes are the tool's declared inputSchema (tools/list)."),
        );
      }
      const body = await TOOLS[name].handler(ctx, args);
      // A tool builds its envelope without the fingerprint; it is stamped
      // here, the one place every tool body passes through.
      if (body?.meta && typeof body.meta === "object")
        body.meta.contract_version = TOOLS_VERSION;
      assertResponseMeta(body?.meta);
      // Every response carries notes and docs, which the instructions
      // promise (journey r3: two help-tool branches served neither): a
      // tool with nothing to say serves [] and its own reference page.
      if (body && typeof body === "object") {
        if (!Array.isArray(body.notes)) body.notes = [];
        if (typeof body.docs !== "string") body.docs = "choosing-a-tool";
        // `event` is a coarse filter, never a population (DECISIONS:
        // never pool across events): every aggregate read with it says so.
        // battles_query lists battles, each with its own event_tag, and
        // battles_performance group_by game_mode serves a row per event
        // (#109), so neither pools.
        if (
          args?.mode === "event" &&
          name !== "battles_query" &&
          !(name === "battles_performance" && args.group_by === "game_mode")
        )
          body.notes.push(EVENT_POOL_NOTE);
      }
      if (oneSize !== null && body && typeof body === "object") {
        body.applied = { ...(body.applied ?? {}), verbosity: "full" };
        if (oneSize === "compact" && Array.isArray(body.notes))
          body.notes.push(
            `${name} has one size: verbosity 'compact' was accepted and had nothing to drop.`,
          );
      }
      // A declared output schema the body does not satisfy is a build bug:
      // loud under the test runner, a log line in production (a schema
      // mistake must never take a working tool down).
      const outputSchema = OUTPUT_SCHEMAS[name];
      if (outputSchema) {
        const mismatch = validateArgs(outputSchema, body, `${name} result`);
        if (mismatch) {
          if (process.env.NODE_TEST_CONTEXT)
            throw new Error(`output schema mismatch: ${mismatch}`);
          console.error("output_schema_mismatch", name, mismatch);
        }
      }
      return body;
    },
  };
}

/**
 * The tool fingerprint: `tools.<12 hex>`, the first 12 hex of a sha256 of
 * the catalogue's declarations. It is serverInfo.version and every
 * response's meta.contract_version (docs/ENGINEERING.md, "The tool
 * contract"): a client that cached tools/list compares it and re-reads the
 * list when it differs. Any change to a name, a description, a schema or an
 * annotation changes it; nothing else does.
 */
export function toolsVersion(registry) {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(registry.declarations()))
    .digest("hex")
    .slice(0, 12);
  return `tools.${fingerprint}`;
}

/** This server's fingerprint: one string for every response. */
export const TOOLS_VERSION = toolsVersion(makeRegistry());
