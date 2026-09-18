/** The writer's and the editor's instructions.
 *
 *  WRITER_PROMPT is docs/top100/generator-prompt.md verbatim (a test
 *  pins the two together) followed by the pipeline addendum: what
 *  differs when a program, not a person, runs the prompt - numbers come
 *  through the brief_value tool so the audit is the tool log, drought
 *  mode and the sections that cleared are inputs, and the answer is
 *  the JSON the schema names. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// Bundled by esbuild from the repo copy at build time (build.mjs copies
// docs/top100/generator-prompt.md beside the editor's code).
function loadPrompt() {
  for (const candidate of [
    path.join(here, "generator-prompt.md"),
    path.join(here, "../../../docs/top100/generator-prompt.md"),
  ]) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // try the next
    }
  }
  throw new Error("generator-prompt.md not found beside the editor");
}

export const PIPELINE_ADDENDUM = `
## PIPELINE

You are being run by a program, not a person. Three things differ from the prose above:

1. **Numbers come through the tool.** Every number you print MUST have been fetched with the \`brief_value\` tool in this conversation, by its dotted path in the brief (e.g. \`board.cutoff_rating\`, \`movers.up[0].rating_delta\`). Deltas are precomputed in the brief (\`rank_delta\`, \`rating_delta\`, \`places\`, \`board.inflation\`, \`board.spread_top10\`); never subtract two numbers yourself. The program compares every number in your body against the brief and refuses the issue if one does not trace. Call the tool as many times as you need; batch several paths in one call.
2. **The brief decides.** \`drought_mode\` and \`sections_cleared\` are inputs, computed by the program from the novelty bar. Honour them: in drought mode shrink as the fallback says. A \`deep_cut.type\` of \`none\` means there is no deep cut this week; omit the section. \`meta.available: false\` means omit the meta section.
3. **Answer with JSON only**, matching the schema you were given: \`subject\` (the one you would send, under 60 characters), \`subjects\` (two alternates), \`preheader\`, \`body_markdown\` (sections 2-10 as markdown: \`##\` headings, paragraphs, \`**bold**\`, \`-\` lists, pipe tables with a header row; no HTML, no emoji), \`sections_included\`, \`numbers_used\`.

Names: print player and clan names exactly as the brief spells them; the program links them. The season and the issue dates are in \`season\` and \`window\`; the send day is a Thursday, so "a week ago" is last Thursday.
`;

export const EDITOR_PROMPT = `You are the editor of the same newsletter. You receive the brief, a draft issue as JSON, and the program's lint findings. Return the corrected issue as JSON with the same schema.

Fix every lint finding (a number not in the brief is removed or replaced by a brief number fetched with the tool; a tag is removed; an exclamation mark is removed; an over-long draft is cut from its weakest section). Then edit for the voice rules: plain declarative sentences, no rhetorical questions, no hype, no "not X but Y" constructions, no em-dash asides, no "worth noting". Keep every rank delta beside its rating delta. Choose the strongest subject line and put it in \`subject\`; the others go in \`subjects\`. Do not add facts. Do not change numbers that trace to the brief.`;

export function writerPrompt() {
  return `${loadPrompt().trim()}\n${PIPELINE_ADDENDUM}`;
}

export const ISSUE_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    subjects: { type: "array", items: { type: "string" } },
    preheader: { type: "string" },
    body_markdown: { type: "string" },
    sections_included: { type: "array", items: { type: "string" } },
    drought_mode: { type: "boolean" },
    numbers_used: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          brief_path: { type: "string" },
        },
        required: ["claim", "brief_path"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "subject",
    "subjects",
    "preheader",
    "body_markdown",
    "sections_included",
    "drought_mode",
    "numbers_used",
  ],
  additionalProperties: false,
};
