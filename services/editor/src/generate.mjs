/** Two model passes over one brief: the writer, with the one tool that
 *  makes its numbers auditable, then the editor, with the lint's
 *  findings. The Anthropic API directly (Bedrock in this account does
 *  not serve the current generation; checked 2026-09-18). */
import Anthropic from "@anthropic-ai/sdk";
import { writerPrompt, EDITOR_PROMPT, ISSUE_SCHEMA } from "./prompt.mjs";

const MODEL = process.env.EDITOR_MODEL || "claude-opus-5";
const MAX_TURNS = 12;

/** An answer the model will not give however often it is asked: a
 *  refusal, max_tokens, the context window, the turn limit, or text that
 *  is not the JSON the schema promised. Retrying the same brief buys the
 *  same outcome at the same price, so the editor writes it down and
 *  stops (review 2026-09-27 §6.7). */
export class FinalEditorError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "FinalEditorError";
    this.kind = kind;
  }
}

/** Statuses a later try can clear: rate limits, the API's own trouble,
 *  and the two the SDK itself retries (408, 409). */
const TRANSIENT = new Set([408, 409, 429]);

/** Whether an error from generateIssue is final: the model's own stop
 *  (FinalEditorError), or an API error no retry will change (400, 401,
 *  403, 404, 413, 422 - a bad request or a bad key). A 429, a 5xx, a
 *  connection error or anything unrecognised is not: it goes back to
 *  the queue for another try. */
export function isFinal(err) {
  if (err instanceof FinalEditorError) return true;
  if (!(err instanceof Anthropic.APIError)) return false;
  if (err instanceof Anthropic.APIConnectionError) return false;
  const status = err.status;
  if (typeof status !== "number") return false;
  return !TRANSIENT.has(status) && status < 500;
}

/** The final error as the issue records it: a kind and a message that
 *  carries no request body. */
export function finalError(err) {
  if (err instanceof FinalEditorError)
    return { kind: err.kind, message: err.message };
  return {
    kind: `api_${err.status}`,
    message: String(err.message ?? err).slice(0, 300),
  };
}

function resolvePath(obj, p) {
  return String(p)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const BRIEF_VALUE_TOOL = {
  name: "brief_value",
  description:
    "Read one or more values from the brief by dotted path (e.g. board.cutoff_rating, movers.up[0].rating_delta, podium[2].name). Every number you print must have come through this tool.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" } },
    },
    required: ["paths"],
    additionalProperties: false,
  },
};

function textOf(response) {
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Runs one prompt to a final JSON answer, serving brief_value calls
 *  and logging every path the model read, and every turn's usage.
 *
 *  Two cache breakpoints: the system prompt, and the brief's own content
 *  block (the first of the user's blocks). Every brief_value turn after
 *  the first resends both unchanged, so it reads them from the cache
 *  (`cache_read_input_tokens` in the turn's logged usage) instead of
 *  paying for the whole brief again. `content` is the user's blocks,
 *  brief first. */
async function converse(client, { pass, system, content, brief, log }) {
  const messages = [{ role: "user", content }];
  const fetched = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      tools: [BRIEF_VALUE_TOOL],
      output_config: {
        format: { type: "json_schema", schema: ISSUE_SCHEMA },
        effort: "high",
      },
      messages,
    });
    log?.({ pass, turn, stop: response.stop_reason, usage: response.usage });
    if (response.stop_reason === "refusal")
      throw new FinalEditorError(
        "refusal",
        `${pass}: model refused: ${response.stop_details?.category ?? "unknown"}`,
      );
    if (response.stop_reason === "model_context_window_exceeded")
      throw new FinalEditorError(
        "context_window",
        `${pass}: the conversation outgrew the context window`,
      );
    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const results = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const paths = block.input?.paths ?? [];
        const values = {};
        for (const p of paths) {
          const v = resolvePath(brief, p);
          values[p] = v === undefined ? null : v;
          fetched.push(p);
        }
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(values),
        });
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    if (response.stop_reason === "max_tokens")
      throw new FinalEditorError("max_tokens", `${pass}: model hit max_tokens`);
    let parsed = response.parsed_output;
    if (parsed == null)
      try {
        parsed = JSON.parse(textOf(response));
      } catch (err) {
        throw new FinalEditorError(
          "bad_json",
          `${pass}: the answer is not JSON (${err.message})`,
        );
      }
    return { issue: parsed, fetched };
  }
  throw new FinalEditorError(
    "turn_limit",
    `${pass}: did not finish in ${MAX_TURNS} turns`,
  );
}

/** The brief as a content block, marked as the end of the cached
 *  prefix. */
const briefBlock = (brief) => ({
  type: "text",
  text: `<brief>\n${JSON.stringify(brief)}\n</brief>`,
  cache_control: { type: "ephemeral" },
});

export async function generateIssue({
  brief,
  lint,
  kind = "top_100",
  log = null,
  client = new Anthropic(),
}) {
  const system = writerPrompt(kind);
  const draft = await converse(client, {
    pass: "writer",
    system,
    content: [
      briefBlock(brief),
      {
        type: "text",
        text: "That is this week's brief as JSON. Write the issue.",
      },
    ],
    brief,
    log,
  });
  const findings = lint(draft.issue, brief, { kind });
  const edited = await converse(client, {
    pass: "editor",
    system: `${system}\n\n${EDITOR_PROMPT}`,
    content: [
      briefBlock(brief),
      {
        type: "text",
        text: `<draft>\n${JSON.stringify(draft.issue)}\n</draft>\n\n<lint>\n${findings.length ? findings.map((f) => `- ${f}`).join("\n") : "- no findings"}\n</lint>\n\nReturn the corrected issue.`,
      },
    ],
    brief,
    log,
  });
  return {
    draft: draft.issue,
    issue: edited.issue,
    draft_findings: findings,
    paths_read: [...new Set([...draft.fetched, ...edited.fetched])],
  };
}
