/**
 * A clan model's editor run, replayed (2026-10-11): the raw record the
 * quality ledger keeps 30 days (`discord-runs/`, written by the sync's
 * `recordEditorRun`) run again through today's editor, so a maintainer
 * can see what a change to the instructions or the checks would have
 * made of a run that went wrong, without a clan, a channel or the
 * database.
 *
 * - `checksOnly`: the run's own answer through today's checks
 *   (`editorAnswer`). No model call.
 * - `replayRun`: today's request from the run's own stories and context,
 *   sent through `turn` (the maintainer's own key; the CLI,
 *   `infra/scripts/editor-replay.mjs`, holds it), the lookups answered
 *   from what the run looked up then (the same lookup, by name and
 *   input; any other is answered as not available), and the answer
 *   through today's checks.
 *
 * Pure but for `turn`: nothing is posted, written or recorded, and the
 * clan's key is never in reach.
 */

import {
  EDITOR_ROUNDS,
  editorAnswer,
  editorNext,
  editorRequest,
} from "@elixir-mcp/clan-engine";

/** A lookup that the run never made, answered in a replay. */
export const NOT_IN_RUN =
  "Not available in this replay: the original run did not look this up.";

const stable = (v) =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(stable).join(",")}]`
      : `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
          .join(",")}}`;
const lookupKey = (name, input) => `${name} ${stable(input ?? {})}`;

/** A raw run, or why it is not one. */
export function readRawRun(raw) {
  if (!raw || typeof raw !== "object" || raw.v !== 1)
    return { error: "not_a_run" };
  if (!Array.isArray(raw.stories) || !raw.stories.length)
    return { error: "no_stories" };
  return { run: raw };
}

/** What the run looked up then, by lookup and input. */
export function recordedLookups(raw) {
  const out = new Map();
  for (const round of raw?.rounds ?? []) {
    const results = new Map(
      (round.results ?? []).map((r) => [r.id, String(r.text ?? "")]),
    );
    for (const c of round.calls ?? [])
      if (results.has(c.id))
        out.set(lookupKey(c.name, c.input), results.get(c.id));
  }
  return out;
}

/** What the run read: the clan and every lookup's answer, as the checks
 *  count it. */
const readOf = (context, lookups) =>
  [String(context ?? ""), ...lookups].join("\n");

const summary = (edited) => ({
  posts: edited.posts.map((p) => ({ keys: p.keys, text: p.text })),
  skips: edited.skips.map((s) => ({ key: s.key, reason: s.reason })),
  rejected: (edited.rejected ?? []).map((x) => ({
    keys: x.keys,
    why: x.why,
    ...(x.text !== undefined ? { text: x.text } : {}),
  })),
});

/** What the run itself posted, skipped and had refused. */
export function originalOf(raw) {
  return {
    model: raw.model ?? null,
    outcome: raw.outcome ?? null,
    posts: (raw.checked?.posts ?? []).map((p) => ({
      keys: p.keys,
      text: p.text,
    })),
    skips: (raw.checked?.skips ?? []).map((s) => ({
      key: s.key,
      reason: s.reason,
    })),
    rejected: raw.checked?.rejected ?? [],
  };
}

/** The run's own answer through today's checks. */
export function checksOnly(raw) {
  if (raw.answer === null || raw.answer === undefined)
    return { error: "no_answer", outcome: raw.outcome ?? null };
  const lookups = (raw.rounds ?? []).flatMap((r) =>
    (r.results ?? []).map((x) => String(x.text ?? "")),
  );
  return summary(
    editorAnswer(raw.answer, raw.stories, readOf(raw.context, lookups)),
  );
}

/**
 * The run again through today's editor: `turn(request, round)` answers
 * like the model client's `turn` (`{ ok, answer }` or `{ ok, calls,
 * content }`, or a refusal with `code`). Each round's lookups are
 * answered from the run's own; `rounds` says what happened in each.
 */
export async function replayRun(raw, { turn }) {
  const recorded = recordedLookups(raw);
  let request = editorRequest({ context: raw.context, stories: raw.stories });
  const read = [];
  const rounds = [];
  for (let round = 1; round <= EDITOR_ROUNDS; round += 1) {
    const r = await turn(request, round);
    const step = { round, ok: r?.ok === true };
    if (r?.usage) step.usage = r.usage;
    rounds.push(step);
    if (!r?.ok) {
      step.code = r?.code ?? "error";
      return { ok: false, code: step.code, rounds };
    }
    if (r.answer !== undefined) {
      const edited = editorAnswer(
        r.answer,
        raw.stories,
        readOf(raw.context, read),
      );
      return { ok: true, rounds, answer: r.answer, ...summary(edited) };
    }
    const calls = r.calls ?? [];
    if (round === EDITOR_ROUNDS || !calls.length)
      return { ok: false, code: "no_answer", rounds };
    const results = calls.map((c) => {
      const text = recorded.get(lookupKey(c.name, c.input));
      return {
        id: c.id,
        text: text ?? NOT_IN_RUN,
        recorded: text !== undefined,
      };
    });
    step.lookups = calls.map((c, i) => ({
      name: c.name,
      input: c.input,
      recorded: results[i].recorded,
    }));
    for (const x of results) if (x.recorded) read.push(x.text);
    request = editorNext(request, r, results, round + 1);
  }
  return { ok: false, code: "no_answer", rounds };
}
