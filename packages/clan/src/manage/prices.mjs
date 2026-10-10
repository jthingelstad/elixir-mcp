/**
 * What a use of the clan's model costs, approximately (2026-10-10). Elixir
 * Clan never sees the clan's Anthropic bill; it knows the tokens each use
 * reported and Anthropic's list prices, so it can say about what the uses
 * cost and stop drafting at the clan's own monthly cap (`model.mjs`).
 *
 * Standard first-party prices per million tokens, input and output, from
 * https://platform.claude.com/docs/en/about-claude/pricing as of
 * `PRICES_AS_OF`. A draft sends no cache control, batch, fast mode or
 * inference_geo, so only the base rates apply. Claude Haiku 5.5 is priced
 * by prompt length: a prompt over 100,000 tokens pays its higher rates.
 *
 * A model missing here (one Anthropic released after this table) is
 * priced at the highest rate of its family, and any other Claude model at
 * the highest rate of all: an estimate that errs high, so a cap is never
 * passed for want of a price. Such a use is marked `estimated`.
 */

export const PRICES_AS_OF = "2026-10-10";

/** [input, output] dollars per million tokens, by model id without a date. */
const PER_MTOK = {
  "claude-fable-5-1": [10, 50],
  "claude-mythos-5-1": [10, 50],
  "claude-fable-5": [10, 50],
  "claude-mythos-5": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-opus-4-7": [5, 25],
  "claude-opus-4-6": [5, 25],
  "claude-opus-4-5": [5, 25],
  "claude-opus-4-1": [15, 75],
  "claude-opus-4": [15, 75],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-4-6": [3, 15],
  "claude-sonnet-4-5": [3, 15],
  "claude-sonnet-4": [3, 15],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
  "claude-3-5-haiku": [0.8, 4],
};
/** Claude Haiku 5.5 over `LONG_PROMPT` input tokens. */
const LONG = { "claude-haiku-5-5": [0.5, 2.5] };
const LONG_PROMPT = 100_000;

const highest = (ids) =>
  ids
    .map((id) => PER_MTOK[id])
    .reduce((a, b) => (a[0] + a[1] >= b[0] + b[1] ? a : b));
const FAMILIES = ["fable", "mythos", "opus", "sonnet", "haiku"].map(
  (family) => [
    family,
    highest(Object.keys(PER_MTOK).filter((id) => id.includes(family))),
  ],
);
const ANY = highest(Object.keys(PER_MTOK));

/** A model's id without its date (`claude-haiku-4-5-20251001`). */
const base = (model) => String(model ?? "").replace(/-\d{8}$/, "");

/**
 * About what one use cost: `{ usd, estimated }`, or null when the use
 * reported no tokens (a pending or unknown outcome).
 */
export function costOfUse(model, inputTokens, outputTokens) {
  if (inputTokens == null && outputTokens == null) return null;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  const id = base(model);
  let rate = (input > LONG_PROMPT && LONG[id]) || PER_MTOK[id];
  const estimated = !rate;
  if (!rate) rate = FAMILIES.find(([f]) => id.includes(f))?.[1] ?? ANY;
  return {
    usd: (input * rate[0] + output * rate[1]) / 1e6,
    estimated,
  };
}

/** Dollars kept to a millionth, so sums read back as they were added. */
export const roundUsd = (usd) => Math.round(usd * 1e6) / 1e6;
