/** Two model passes over one brief: the writer, with the one tool that
 *  makes its numbers auditable, then the editor, with the lint's
 *  findings. The Anthropic API directly (Bedrock in this account does
 *  not serve the current generation; checked 2026-09-18). */
import Anthropic from "@anthropic-ai/sdk";
import { writerPrompt, EDITOR_PROMPT, ISSUE_SCHEMA } from "./prompt.mjs";

const MODEL = process.env.EDITOR_MODEL || "claude-opus-5";

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
 *  and logging every path the model read. */
async function converse(client, { system, user, brief, log }) {
  const messages = [{ role: "user", content: user }];
  const fetched = [];
  for (let turn = 0; turn < 12; turn++) {
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
    log?.({ turn, stop: response.stop_reason, usage: response.usage });
    if (response.stop_reason === "refusal")
      throw new Error(
        `model refused: ${response.stop_details?.category ?? "unknown"}`,
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
      throw new Error("model hit max_tokens");
    const text = textOf(response);
    const parsed = response.parsed_output ?? JSON.parse(text);
    return { issue: parsed, fetched };
  }
  throw new Error("writer did not finish in 12 turns");
}

export async function generateIssue({
  brief,
  lint,
  log = null,
  client = new Anthropic(),
}) {
  const system = writerPrompt();
  const draft = await converse(client, {
    system,
    user: `Here is this week's brief as JSON. Write the issue.\n\n<brief>\n${JSON.stringify(brief)}\n</brief>`,
    brief,
    log,
  });
  const findings = lint(draft.issue, brief);
  const edited = await converse(client, {
    system: `${system}\n\n${EDITOR_PROMPT}`,
    user: `<brief>\n${JSON.stringify(brief)}\n</brief>\n\n<draft>\n${JSON.stringify(draft.issue)}\n</draft>\n\n<lint>\n${findings.length ? findings.map((f) => `- ${f}`).join("\n") : "- no findings"}\n</lint>\n\nReturn the corrected issue.`,
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
