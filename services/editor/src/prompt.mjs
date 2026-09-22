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
const PROMPT_FILE = {
  top_100: "generator-prompt.md",
  card_of_week: "card-of-week-prompt.md",
};
const PROMPT_DOC = {
  top_100: "docs/top100/generator-prompt.md",
  card_of_week: "docs/card-of-week/generator-prompt.md",
};

function loadPrompt(kind = "top_100") {
  for (const candidate of [
    path.join(here, PROMPT_FILE[kind] ?? PROMPT_FILE.top_100),
    path.join(here, "../../..", PROMPT_DOC[kind] ?? PROMPT_DOC.top_100),
  ]) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // try the next
    }
  }
  throw new Error(`prompt for ${kind} not found beside the editor`);
}

/** What differs when a PROGRAM runs the prompt, not a person. The first
 *  and third points are every written kind's; the second is the kind's
 *  own, because the brief's controls differ. */
const SHARED_ADDENDUM = (paths) => `
## PIPELINE

You are being run by a program, not a person. Three things differ from the prose above:

1. **Numbers come through the tool.** Every number you print MUST have been fetched with the \`brief_value\` tool in this conversation, by its dotted path in the brief (${paths}). Every figure the issue could need is already computed in the brief; never do arithmetic on two of them yourself. The program compares every number in your body against the brief and refuses the issue if one does not trace. Call the tool as many times as you need; batch several paths in one call.
`;

const KIND_ADDENDUM = {
  top_100: `2. **The brief decides.** \`drought_mode\` and \`sections_cleared\` are inputs, computed by the program from the novelty bar. Honour them: in drought mode shrink as the fallback says. A \`deep_cut.type\` of \`none\` means there is no deep cut this week; omit the section. \`meta.available: false\` means omit the meta section.`,
  card_of_week: `2. **The brief decides.** A \`deep_cut.type\` of \`none\` means there is nothing counterintuitive this week; omit that section rather than inventing one. A row marked \`thin: true\` is below the sample floor and must be called thin wherever you interpret it. \`elite\` or \`best_of_five\` may be null; omit what is not there. Rates are already percentages in the \`_pct\` fields (\`usage_share_pct: 29.4\` means "29.4 percent") - print those, never the raw rate, and never convert one yourself.`,
};

const ANSWER = {
  top_100: `3. **Answer with JSON only**, matching the schema you were given: \`subject\` (the one you would send, under 60 characters), \`subjects\` (two alternates), \`preheader\`, \`body_markdown\` (sections 2-10 as markdown: \`##\` headings, paragraphs, \`**bold**\`, \`-\` lists, pipe tables with a header row; no HTML, no emoji), \`sections_included\`, \`numbers_used\`.

Names: print player and clan names exactly as the brief spells them, with their emoji and non-Latin characters as the characters themselves (never as \\u escapes, which have arrived broken); the program links them. The season and the issue dates are in \`season\` and \`window\`; the send day is a Thursday, so "a week ago" is last Thursday.`,
  card_of_week: `3. **Answer with JSON only**, matching the schema you were given: \`subject\` (the one you would send, under 60 characters), \`subjects\` (two alternates), \`preheader\`, \`body_markdown\` (the issue as markdown: \`##\`/\`###\` headings, paragraphs, \`**bold**\`, \`-\` lists, pipe tables with a header row; no HTML, no emoji), \`sections_included\`, \`numbers_used\`.

Card names: print them exactly as the brief spells them. Place a deck with \`{{deck:0}}\`, \`{{deck:1}}\`, \`{{deck:2}}\` on their own lines and never type its cards - the mail prints them from the record. Do not write the closing "Ask your agent" lines; the mail appends them.`,
};

export function pipelineAddendum(kind = "top_100") {
  const paths =
    kind === "card_of_week"
      ? "e.g. `headline.usage_share_pct`, `by_mode[0].win_rate_pct`, `elite.baseline_win_rate_pct`"
      : "e.g. `board.cutoff_rating`, `movers.up[0].rating_delta`";
  return [
    SHARED_ADDENDUM(paths).trimEnd(),
    KIND_ADDENDUM[kind] ?? KIND_ADDENDUM.top_100,
    ANSWER[kind] ?? ANSWER.top_100,
  ].join("\n");
}

export const EDITOR_PROMPT = `You are the editor of the same newsletter. You receive the brief, a draft issue as JSON, and the program's lint findings. Return the corrected issue as JSON with the same schema.

Fix every lint finding (a number not in the brief is removed or replaced by a brief number fetched with the tool; a tag is removed; an exclamation mark is removed; an over-long draft is cut from its weakest section). Then edit for the voice rules: plain declarative sentences, no rhetorical questions, no hype, no "not X but Y" constructions, no em-dash asides, no "worth noting". Keep every rank delta beside its rating delta. Choose the strongest subject line and put it in \`subject\`; the others go in \`subjects\`. Do not add facts. Do not change numbers that trace to the brief.`;

export function writerPrompt(kind = "top_100") {
  return `${loadPrompt(kind).trim()}\n${pipelineAddendum(kind)}`;
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
    "numbers_used",
  ],
  additionalProperties: false,
};
