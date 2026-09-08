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
    };
  });

  const groups = GROUP_ORDER.map((group) => ({
    group,
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
    writeCount: all.filter((t) => !t.readOnly).length,
    scopes: OAUTH_SCOPE_DETAILS,
  };
}
