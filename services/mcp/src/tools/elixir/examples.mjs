import { responseMeta } from "@elixir-mcp/contracts";
import { CORPUS_BUILT_AT, EXAMPLES } from "@elixir-mcp/docs";
import { ToolFailure, appliedBlock, docsRef, notes } from "../shared.mjs";

export const elixir_examples = {
  description:
    "Eleven worked examples of what people ask an agent connected to Elixir MCP and what it answers: for players (understand your play, pick a deck, push with evidence, follow friends), clan leaders (win the river race, keep the roster healthy, scout the other clan, write the weekly recap) and builders (answer clanmates in Discord, publish your own stats, run a collector). No arguments: the index. example: one in full with its transcript, what it reads, the tools it calls and the setup. The numbers inside a transcript are illustrative; the tools are real.",
  inputSchema: {
    type: "object",
    properties: {
      example: {
        type: "string",
        description:
          "An example slug from the index (e.g. play, clan, discord).",
      },
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const meta = responseMeta({ as_of: new Date().toISOString() });
    if (args.example) {
      const slug = String(args.example).toLowerCase().trim();
      const ex = EXAMPLES.find((e) => e.slug === slug);
      if (!ex)
        throw new ToolFailure(
          "not_found",
          `No example "${slug}".`,
          `Slugs are: ${EXAMPLES.map((e) => e.slug).join(", ")}.`,
        );
      return {
        ...ex,
        applied: appliedBlock({ example: slug }),
        docs: docsRef("choosing-a-tool"),
        corpus_built_at: CORPUS_BUILT_AT,
        meta,
      };
    }
    return {
      examples: EXAMPLES.map((e) => ({
        slug: e.slug,
        group: e.group,
        title: e.title,
        lede: e.lede,
        tools: e.tools,
        url: e.url,
      })),
      notes: notes("Read one with example: <slug>."),
      docs: docsRef("choosing-a-tool"),
      corpus_built_at: CORPUS_BUILT_AT,
      meta,
    };
  },
};
