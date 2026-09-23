import { responseMeta } from "@elixir-mcp/contracts";
import { CORPUS_BUILT_AT, DOCS, searchDocs } from "@elixir-mcp/docs";
import { ToolFailure, appliedBlock, notes, docsRef } from "../shared.mjs";

export const elixir_docs = {
  description:
    "Elixir MCP's own documentation, the same pages a person reads at elixir.poapkings.com/docs. No arguments: the index (every page with its section, lede and sections). page: one page's Markdown; page + section: one H2 section. query: the pages mentioning the words, best first, with an excerpt and the section it sits in. Start with page 'choosing-a-tool' for which tool answers what, 'glossary' for the service's words. The tool reference itself is tools/list.",
  inputSchema: {
    type: "object",
    properties: {
      page: {
        type: "string",
        description:
          "A page slug from the index (e.g. choosing-a-tool, glossary, battles, clocks, recording, agents, limits).",
      },
      section: {
        type: "string",
        description:
          "With page: one H2 section, by its slug or title as the index lists them.",
      },
      query: {
        type: "string",
        minLength: 2,
        maxLength: 80,
        description:
          "Words to search for across every page; ignored when page is given.",
      },
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    // The envelope is closed (assertResponseMeta), so when the corpus
    // was built rides in the body, not in meta.
    const meta = responseMeta({ as_of: new Date().toISOString() });
    if (args.page) {
      const slug = String(args.page).toLowerCase().trim();
      const doc = DOCS.find((d) => d.slug === slug);
      if (!doc)
        throw new ToolFailure(
          "not_found",
          `No documentation page "${slug}".`,
          `Call elixir_docs with no arguments for the index; slugs are: ${DOCS.map((d) => d.slug).join(", ")}.`,
        );
      if (args.section) {
        const want = String(args.section).toLowerCase().trim();
        const sec = doc.sections.find(
          (x) => x.slug === want || x.title.toLowerCase() === want,
        );
        if (!sec)
          throw new ToolFailure(
            "not_found",
            `No section "${want}" on ${doc.slug}.`,
            `Its sections are: ${doc.sections.map((x) => x.slug).join(", ")}.`,
          );
        return {
          slug: doc.slug,
          title: doc.title,
          section: sec.title,
          section_slug: sec.slug,
          url: `${doc.url}#${sec.slug}`,
          applied: appliedBlock({ page: slug, section: sec.slug }),
          markdown: sec.markdown,
          corpus_built_at: CORPUS_BUILT_AT,
          notes: notes(
            "One section of the page; page alone reads all of it, and url is the same section on the site.",
          ),
          docs: docsRef(doc.slug, sec.slug),
          meta,
        };
      }
      return {
        slug: doc.slug,
        title: doc.title,
        section: doc.section,
        url: doc.url,
        applied: appliedBlock({ page: slug }),
        sections: doc.sections.map((x) => ({ slug: x.slug, title: x.title })),
        markdown: doc.markdown,
        corpus_built_at: CORPUS_BUILT_AT,
        notes: notes(
          "The whole page; page + section reads one of the sections listed, and url is the same page on the site.",
        ),
        docs: docsRef(doc.slug),
        meta,
      };
    }
    if (args.query) {
      const { matches, fallback } = searchDocs(args.query, 8);
      return {
        query: String(args.query),
        applied: appliedBlock({ query: String(args.query) }),
        matches,
        fallback,
        notes: notes(
          matches.length === 0
            ? "No page mentions any of those words; the index (no arguments) lists what is documented, and elixir_examples has the worked examples."
            : fallback
              ? "No page holds every word, so these hold some of them; read one with page, or just the section with page + section."
              : "Read a match with page, or just its section with page + section: in_section.",
        ),
        corpus_built_at: CORPUS_BUILT_AT,
        meta,
      };
    }
    return {
      pages: DOCS.map((d) => ({
        slug: d.slug,
        group: d.section,
        title: d.title,
        lede: d.lede,
        url: d.url,
        sections: d.sections.map((x) => x.slug),
      })),
      notes: notes(
        "Read one with page, one section with page + section, or search with query. The tool reference is tools/list itself (also at https://elixir.poapkings.com/docs/tools); elixir_changelog says what changed in it.",
      ),
      docs: docsRef("about"),
      corpus_built_at: CORPUS_BUILT_AT,
      meta,
    };
  },
};
