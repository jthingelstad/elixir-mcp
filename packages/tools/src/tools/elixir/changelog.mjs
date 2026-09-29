import {
  CHANGELOG,
  CONTRACT_VERSION,
  responseMeta,
} from "@elixir-mcp/contracts";
import { appliedBlock, docsRef, notes } from "../shared.mjs";

export const elixir_changelog = {
  description:
    "What changed in the tool CONTRACT since a version (client tool schemas cache aggressively). Entries after since, newest first, with tools_added and breaking notes; omitted since starts at the newest release. Pages default to 20 entries: pass next_offset as offset until it is null to read the complete history. elixir_updates is the product-level list written for people.",
  inputSchema: {
    type: "object",
    properties: {
      since: {
        type: "string",
        description:
          "Contract version you last saw (any response's meta.contract_version). Omit to page through the full changelog.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 20,
        default: 20,
        description: "Release entries per page.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        default: 0,
        description:
          "Pass the previous page's next_offset; keep since unchanged.",
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
    const all = args.since
      ? CHANGELOG.filter((e) => after(e.version, args.since))
      : CHANGELOG;
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;
    const entries = all.slice(offset, offset + limit);
    const nextOffset = offset + entries.length;
    return {
      current: CONTRACT_VERSION,
      applied: appliedBlock({
        since: args.since ? String(args.since) : undefined,
        limit,
        offset,
      }),
      entries,
      total: all.length,
      next_offset: nextOffset < all.length ? nextOffset : null,
      notes: notes(
        "Tool schemas cache client-side: if tools_added lists something you cannot see, the client needs to reconnect (re-read tools/list).",
      ),
      docs: docsRef("protocol", "versioning-and-the-cache-buster"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
