/**
 * MCP resources and prompts (1.0.0, review Part 3.1).
 *
 * A stateless server cannot push notifications/tools/list_changed, and
 * clients cache tools/list for a session or longer - this session's own
 * connection could not call elixir_docs six hours after it shipped. The
 * spec has a primitive for reference material that clients list LAZILY at
 * read time: resources. And one for canned questions that clients surface
 * as quick actions: prompts. Both are served from the same corpus the
 * documentation tools read, so nothing here is a second copy.
 *
 *   elixir://docs                      the documentation index
 *   elixir://docs/<slug>               one page as Markdown
 *   elixir://docs/<slug>#<section>     one H2 section
 *   elixir://examples                  the worked examples index
 *   elixir://examples/<slug>           one example with its transcript
 *   elixir://changelog                 the contract changelog
 *   elixir://updates                   what's new, newest first
 *   elixir://cards                     the card catalog (35 KB, static: a
 *                                      resource is what it should have been)
 *
 * Reading a resource spends no daily quota: it is documentation, and the
 * hourly rate limit still bounds it at the handler.
 */

import { CHANGELOG, CONTRACT_VERSION, DISCLAIMER } from "@elixir-mcp/contracts";
import { DOCS, EXAMPLES, UPDATES, CORPUS_BUILT_AT } from "@elixir-mcp/docs";
import { readCatalog } from "./tools/cards.mjs";

const SCHEME = "elixir://";
const MD = "text/markdown";
const JSON_T = "application/json";

export function listResources() {
  const docs = DOCS.map((d) => ({
    uri: `${SCHEME}docs/${d.slug}`,
    name: d.title,
    title: d.title,
    description: d.lede || d.description,
    mimeType: MD,
  }));
  const examples = EXAMPLES.map((e) => ({
    uri: `${SCHEME}examples/${e.slug}`,
    name: e.title,
    title: e.title,
    description: e.lede,
    mimeType: MD,
  }));
  return [
    {
      uri: `${SCHEME}docs`,
      name: "Documentation index",
      title: "Elixir MCP documentation",
      description:
        "Every documentation page with its section, lede and sections. Start with choosing-a-tool and glossary.",
      mimeType: JSON_T,
    },
    ...docs,
    {
      uri: `${SCHEME}examples`,
      name: "Examples index",
      title: "Worked examples",
      description: "Eleven exchanges with the tools each one calls.",
      mimeType: JSON_T,
    },
    ...examples,
    {
      uri: `${SCHEME}changelog`,
      name: "Contract changelog",
      title: "Tool contract changelog",
      description: `Every contract version and what shipped in it, newest first (current: ${CONTRACT_VERSION}).`,
      mimeType: JSON_T,
    },
    {
      uri: `${SCHEME}updates`,
      name: "What's new",
      title: "What's new on Elixir MCP",
      description: "Every user-visible change, newest first.",
      mimeType: JSON_T,
    },
    {
      uri: `${SCHEME}cards`,
      name: "Card catalog",
      title: "Clash Royale card catalog",
      description:
        "Every card and tower troop with ids, rarities, costs, forms and max levels on the in-game 1-16 scale.",
      mimeType: JSON_T,
    },
  ];
}

/** Templates let a client construct a page or section URI without
 *  listing everything first. */
export function listResourceTemplates() {
  return [
    {
      uriTemplate: `${SCHEME}docs/{slug}`,
      name: "Documentation page",
      description: "One documentation page as Markdown, by slug.",
      mimeType: MD,
    },
    {
      uriTemplate: `${SCHEME}docs/{slug}#{section}`,
      name: "Documentation section",
      description: "One H2 section of a page, by page slug and section slug.",
      mimeType: MD,
    },
    {
      uriTemplate: `${SCHEME}examples/{slug}`,
      name: "Worked example",
      description: "One example with its transcript, reads, tools and setup.",
      mimeType: MD,
    },
  ];
}

const text = (uri, body, mimeType = MD) => ({
  contents: [{ uri, mimeType, text: body }],
});
const json = (uri, value) => text(uri, JSON.stringify(value, null, 1), JSON_T);

function exampleMarkdown(e) {
  const lines = [
    `# ${e.title}`,
    "",
    e.lede,
    "",
    `Tools: ${e.tools.join(", ")}`,
    "",
    "## Exchange",
    "",
    ...e.transcript.map((l) => `**${l.role}:** ${l.text}\n`),
    "## What it reads",
    "",
    ...e.reads.map((r) => `- ${r}`),
    "",
    "## To set this up",
    "",
    ...e.setup.map((s) => `- ${s}`),
    "",
    `Source: ${e.url}`,
  ];
  return lines.join("\n");
}

/** Resolve one URI. Returns null for an unknown URI (the protocol layer
 *  answers -32002 Resource not found). `db` is needed only for the card
 *  catalog. */
export async function readResource(uri, { db } = {}) {
  const raw = String(uri ?? "");
  if (!raw.startsWith(SCHEME)) return null;
  const path = raw.slice(SCHEME.length);
  const [pathNoHash, fragment] = path.split("#");
  const parts = pathNoHash.split("/").filter(Boolean);

  if (parts[0] === "docs" && parts.length === 1)
    return json(raw, {
      pages: DOCS.map((d) => ({
        slug: d.slug,
        uri: `${SCHEME}docs/${d.slug}`,
        group: d.section,
        title: d.title,
        lede: d.lede,
        sections: d.sections.map((x) => x.slug),
        url: d.url,
      })),
      corpus_built_at: CORPUS_BUILT_AT,
      disclaimer: DISCLAIMER,
    });
  if (parts[0] === "docs" && parts.length === 2) {
    const doc = DOCS.find((d) => d.slug === parts[1].toLowerCase());
    if (!doc) return null;
    if (fragment) {
      const want = fragment.toLowerCase();
      const sec = doc.sections.find(
        (x) => x.slug === want || x.title.toLowerCase() === want,
      );
      if (!sec) return null;
      return text(
        raw,
        `# ${doc.title}\n\n## ${sec.title}\n\n${sec.markdown}\n\nSource: ${doc.url}#${sec.slug}`,
      );
    }
    return text(raw, `# ${doc.title}\n\n${doc.markdown}\n\nSource: ${doc.url}`);
  }
  if (parts[0] === "examples" && parts.length === 1)
    return json(raw, {
      examples: EXAMPLES.map((e) => ({
        slug: e.slug,
        uri: `${SCHEME}examples/${e.slug}`,
        group: e.group,
        title: e.title,
        lede: e.lede,
        tools: e.tools,
        url: e.url,
      })),
      corpus_built_at: CORPUS_BUILT_AT,
    });
  if (parts[0] === "examples" && parts.length === 2) {
    const ex = EXAMPLES.find((e) => e.slug === parts[1].toLowerCase());
    if (!ex) return null;
    return text(raw, exampleMarkdown(ex));
  }
  if (parts[0] === "changelog" && parts.length === 1)
    return json(raw, { current: CONTRACT_VERSION, entries: CHANGELOG });
  if (parts[0] === "updates" && parts.length === 1)
    return json(raw, { entries: UPDATES, corpus_built_at: CORPUS_BUILT_AT });
  if (parts[0] === "cards" && parts.length === 1) {
    if (!db) return null;
    const catalog = await readCatalog(db);
    if (!catalog) return null;
    return json(raw, {
      ...catalog,
      notes: [
        "maxLevel is the in-game 1-16 scale; maxLevelRarityScale is the API's per-rarity cap.",
        "forms_available decodes maxEvolutionLevel, a bit field (1 = Evolution, 2 = Hero).",
      ],
    });
  }
  return null;
}

/** The eleven examples as prompts: a client that surfaces prompts as
 *  quick actions shows "Win your river race" to somebody who just
 *  connected and has read nothing. */
export function listPrompts() {
  return EXAMPLES.map((e) => ({
    name: e.slug,
    title: e.title,
    description: `${e.lede} Uses ${e.tools.join(", ")}.`,
    arguments: [],
  }));
}

export function getPrompt(name) {
  const ex = EXAMPLES.find((e) => e.slug === String(name ?? "").toLowerCase());
  if (!ex) return null;
  const question =
    ex.transcript.find((l) => l.role === "user")?.text ?? ex.title;
  return {
    description: ex.lede,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `${question}\n\n(Answer from Elixir MCP's recorded data; the tools this example uses are ${ex.tools.join(", ")}. Cite meta.freshness_seconds and any notes before quoting a number.)`,
        },
      },
    ],
  };
}
