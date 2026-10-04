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
  CONTRACT_VERSION,
  TOOL_GROUPS,
  GROUP_ORDER,
  requiredOAuthScope,
  toolsHiddenFrom,
} from "@elixir-mcp/contracts";
import { elixirTools } from "./tools/elixir.mjs";
import { battlesTools } from "./tools/battles.mjs";
import { opponentsTools } from "./tools/opponents.mjs";
import { badgesTools } from "./tools/badges.mjs";
import { cardsTools } from "./tools/cards.mjs";
import { clanContextTools } from "./tools/clan-context.mjs";
import { clansTools } from "./tools/clans.mjs";
import { liveTools } from "./tools/live.mjs";
import { playersTools } from "./tools/players.mjs";
import { warTools } from "./tools/war.mjs";
import { rankingsTools } from "./tools/rankings.mjs";
import { seriesTools } from "./tools/series.mjs";
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
  ...badgesTools,
  ...cardsTools,
  ...clansTools,
  ...clanContextTools,
  ...seriesTools,
  ...liveTools,
  ...playersTools,
  ...warTools,
  ...rankingsTools,
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

/** The arguments only an agent connection uses: a personal connection
 *  ignores them (DECISIONS, "The identity map is an agent's"), so its
 *  published schemas leave them out (review 2026-09-27 §6.1: about 6 KB
 *  of every person's tools/list said nothing to them). */
const AGENT_ARGS = ["on_behalf_of", "display_name"];

/** A connection that is a person's: no kind, "person", or anything the
 *  principals module does not know (toolsHiddenFrom's rule). */
const isPerson = (kind) => kind !== "agent" && kind !== "integration";

function withoutAgentArgs(schema) {
  const props = schema.properties ?? {};
  if (!AGENT_ARGS.some((a) => Object.hasOwn(props, a)) && !props.segment?.anyOf)
    return schema;
  const properties = Object.fromEntries(
    Object.entries(props)
      .filter(([k]) => !AGENT_ARGS.includes(k))
      .map(([k, v]) =>
        // segment's object branch carries on_behalf_of too.
        k === "segment" && Array.isArray(v.anyOf)
          ? [k, { ...v, anyOf: v.anyOf.map((b) => withoutAgentArgs(b)) }]
          : [k, v],
      ),
  );
  return { ...schema, properties };
}

/** What a connection of this kind is shown and validated against. */
function schemaFor(schema, kind) {
  const published = publishedInputSchema(schema);
  return isPerson(kind) ? withoutAgentArgs(published) : published;
}

/** A cached client (or a habit) may still send an agent argument on a
 *  personal connection: it is dropped, silently, before validation, as
 *  the one-size verbosity is, so nothing that used to be accepted is
 *  refused. It never reached a person's answer anyway. */
function dropAgentArgs(args) {
  const out = Object.fromEntries(
    Object.entries(args).filter(([k]) => !AGENT_ARGS.includes(k)),
  );
  const seg = out.segment;
  if (
    seg &&
    typeof seg === "object" &&
    !Array.isArray(seg) &&
    Object.hasOwn(seg, "on_behalf_of")
  )
    out.segment = Object.fromEntries(
      Object.entries(seg).filter(([k]) => k !== "on_behalf_of"),
    );
  return out;
}

/**
 * `kind` shapes what a connection can see and call. It is threaded in rather
 * than read from a module global because one Lambda serves every principal,
 * and a cached registry that remembered the last caller's kind would be the
 * worst possible bug in this file.
 */
export function makeRegistry() {
  return {
    has: (name) => Object.hasOwn(TOOLS, name),
    /** Whether a tool declares an argument (a refusal's hint names only
     *  arguments the tool takes: Gym #104). */
    accepts: (name, arg) =>
      Object.hasOwn(TOOLS[name]?.inputSchema?.properties ?? {}, arg),
    requiredScope: (name) => requiredOAuthScope(name),
    /** Omitted from the list AND refused on call: clients cache tools/list
     *  forever, so a tool that merely disappears is still callable. */
    availableTo: (name, kind) => !toolsHiddenFrom(kind).has(name),
    // No argument is the whole catalogue (the site's tool reference,
    // tools.json, tests); a caller's kind - null or undefined meaning a
    // person - filters to what that principal may see and call.
    declarations: (...kindArg) =>
      Object.entries(TOOLS)
        .filter(
          ([name]) =>
            kindArg.length === 0 || !toolsHiddenFrom(kindArg[0]).has(name),
        )
        .map(([name, t]) => {
          // Classification is mandatory: an unclassified tool is a build
          // error, not a silent "Other tools" entry (Jamie, 2026-09-04).
          const cls = TOOL_GROUPS[name];
          if (!cls) throw new Error(`tool ${name} missing from TOOL_GROUPS`);
          return {
            name,
            description: t.description,
            // The whole catalogue (no kind) keeps every argument: it is
            // the reference for every kind of connection.
            inputSchema:
              kindArg.length === 0
                ? publishedInputSchema(t.inputSchema)
                : schemaFor(t.inputSchema, kindArg[0]),
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
              // caller owns (review 2.2.6): a client may confirm those.
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
      const kind = ctx?.account?.kind ?? null;
      let args = rawArgs ?? {};
      if (isPerson(kind)) args = dropAgentArgs(args);
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
        schemaFor(TOOLS[name].inputSchema, kind),
        args,
      );
      if (problem) {
        // A missing required argument's hint is that argument's own
        // description (4.0.0): a segment tool called without segment is
        // told 'mine', 'corpus' or the object, not to read tools/list.
        const missing = /^arguments\.([a-z_]+) is required\.$/.exec(problem);
        const own =
          missing &&
          TOOLS[name].inputSchema.properties?.[missing[1]]?.description;
        // An argument the server does not know is most often a client
        // holding an older tools/list: say which contract this is and
        // that a reconnect re-reads it, as the unknown-tool hint does.
        const unknown = / has no property '/.test(problem);
        throw new ToolFailure(
          "bad_request",
          problem,
          own ??
            (unknown
              ? `This server is contract ${CONTRACT_VERSION}; the arguments it takes are this tool's inputSchema in tools/list. If your client cached that list earlier, reconnect; elixir_changelog(since) says what moved.`
              : "Valid values and shapes are the tool's declared inputSchema (tools/list)."),
        );
      }
      const body = await TOOLS[name].handler(ctx, args);
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
