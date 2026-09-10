/**
 * The published tool reference, GENERATED from the MCP registry.
 *
 * This page used to be hand-written markdown, and it drifted: it
 * documented 31 tools while the server declared 36. The registry in
 * services/mcp/src/tools.mjs and the taxonomy in packages/contracts are
 * the source of truth for what an agent actually sees, so the docs are
 * built from exactly the declarations tools/list returns - same
 * descriptions, same group order, same titles.
 *
 * The registry imports cleanly with no database or environment: the
 * per-group modules keep declarations next to handlers, and only the
 * handlers touch a connection.
 */
import { makeRegistry } from "../../../../services/mcp/src/tools.mjs";
import {
  CONTRACT_VERSION,
  TOOL_GROUPS,
  GROUP_ORDER,
  OAUTH_SCOPE,
  OAUTH_SCOPE_DETAILS,
  requiredOAuthScope,
  toolsHiddenFrom,
  MODE_GROUPS,
  typesForModeGroup,
} from "@elixir-mcp/contracts";

/** Argument summary for a tool, from its JSON Schema: enough for a
 *  reader to know what the call takes without reproducing the schema. */
function args(schema) {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(props).map(([name, spec]) => ({
    name,
    type: Array.isArray(spec.type) ? spec.type.join(" | ") : (spec.type ?? ""),
    required: required.has(name),
    description: spec.description ?? "",
    enum: spec.enum ?? null,
    default: spec.default ?? null,
  }));
}

/** The top-level response fields of a declared outputSchema, flattened
 *  the way args() flattens the inputSchema: enough for "what comes back"
 *  without reproducing the schema (the raw schema rides beside it). */
function returns(schema) {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(props).map(([name, spec]) => ({
    name,
    type: Array.isArray(spec.type) ? spec.type.join(" | ") : (spec.type ?? ""),
    required: required.has(name),
    description: spec.description ?? "",
    enum: spec.enum ?? null,
  }));
}

export default function tools() {
  const declarations = makeRegistry().declarations();

  const all = declarations.map((d) => {
    const cls = TOOL_GROUPS[d.name];
    const scope = requiredOAuthScope(d.name);
    return {
      name: d.name,
      group: cls.group,
      title: cls.title,
      description: d.description,
      readOnly: cls.readOnly,
      openWorld: cls.openWorld ?? false,
      scope: scope ?? OAUTH_SCOPE.READ,
      args: args(d.inputSchema),
      // 1.0.0: the most-called tools declare what comes back. Null on
      // the rest, so a template can tell "undeclared" from "nothing".
      outputSchema: d.outputSchema ?? null,
      returns: d.outputSchema ? returns(d.outputSchema) : null,
    };
  });

  // A slug per group, so the reference can be a family of small pages
  // rather than one wall of tools. Derived from the group's
  // own name: the registry is the source of truth for the taxonomy, and
  // a hand-kept list of families beside it would be a second one.
  const slugOf = (group) =>
    group
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const groups = GROUP_ORDER.map((group) => ({
    group,
    slug: slugOf(group),
    tools: all.filter((t) => t.group === group),
  })).filter((g) => g.tools.length > 0);

  // A group missing from GROUP_ORDER would silently drop tools from the
  // docs while the server still serves them - the exact drift this file
  // exists to end. Fail the build instead.
  const published = new Set(groups.flatMap((g) => g.tools.map((t) => t.name)));
  const missing = all.filter((t) => !published.has(t.name));
  if (missing.length > 0) {
    throw new Error(
      `tool groups missing from GROUP_ORDER: ${missing
        .map((t) => `${t.name} (${t.group})`)
        .join(", ")}`,
    );
  }

  return {
    all,
    groups,
    contractVersion: CONTRACT_VERSION,
    count: all.length,
    // What an AGENT's tools/list holds: the person-only tools are hidden
    // from it. Generated, because a hand-typed count was 41 while the
    // door served 44.
    agentCount: all.length - toolsHiddenFrom("agent").size,
    integrationCount: all.length - toolsHiddenFrom("integration").size,
    writeCount: all.filter((t) => !t.readOnly).length,
    outputSchemaCount: all.filter((t) => t.outputSchema).length,
    scopes: OAUTH_SCOPE_DETAILS,
    // The six mode groups and the API battle types each folds, from the
    // contract, so the battle-model page's table cannot drift from what
    // `mode` accepts. Rides here rather than its own data file because
    // the corpus renderer (apps/site/src/_lib/doc-render.mjs) loads
    // exactly this file, and the page must read the same over MCP.
    modes: MODE_GROUPS.map((group) => ({
      group,
      types: typesForModeGroup(group),
    })),
  };
}
