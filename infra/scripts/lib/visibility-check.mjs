/**
 * The deploy's visibility check (2026-11-13): after smoke, the migrate
 * Lambda's read-only {visibility_check} names every table whose
 * visibility map or statistics would cost its readers
 * (services/migrate/src/vacuum.mjs has the thresholds and the story).
 * It warns and never fails the deploy, and it writes nothing: the fix is
 * the {vacuum} op each line names, run through `npm run op` once the
 * deploy has released the production lock.
 */

import { InvokeCommand } from "@aws-sdk/client-lambda";

const CHECK_PAYLOAD = '{"visibility_check": true}';
const RERUN = `npm run op -- '${CHECK_PAYLOAD}'`;

/** The deploy's lines for a {visibility_check} answer: one WARNING per
 *  flagged table, with the op that fixes it; none when all is well. */
export function visibilityWarnings(result) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return [`WARNING: the visibility check gave no answer; run ${RERUN}`];
  if (result.error || !Array.isArray(result.flagged))
    return [
      `WARNING: the visibility check did not run (${result.error ?? "no flagged list"}${result.message ? `: ${result.message}` : ""}); run ${RERUN} after the deploy`,
    ];
  return result.flagged.map((t) => {
    const what =
      t.reason === "never_analyzed"
        ? `never vacuumed or analyzed (${t.pages} pages, no row estimate); the planner guesses its size`
        : t.reason === "stale_estimate"
          ? `a row estimate of 0 over ${t.pages} pages of live rows; the planner guesses its size`
          : `${t.all_visible_pages} of ${t.pages} pages all-visible (${t.all_visible_pct}%); index-only reads fetch the heap`;
    return `WARNING: ${t.table}: ${what}. After the deploy run: ${t.command}`;
  });
}

/**
 * Invoke the check and print what it says. Never throws: a failed
 * invoke, an older migrate bundle that does not know the op, or a
 * timeout is one WARNING line.
 *
 * @param {{send: (command: unknown) => Promise<any>}} lambda
 * @param {string} functionName
 * @param {{log?: (line: string) => void}} [io]
 * @returns {Promise<string[]>} the lines printed
 */
export async function runVisibilityCheck(
  lambda,
  functionName,
  { log = console.log } = {},
) {
  let lines;
  try {
    const invoked = await lambda.send(
      new InvokeCommand({ FunctionName: functionName, Payload: CHECK_PAYLOAD }),
    );
    const answer = JSON.parse(
      Buffer.from(invoked.Payload ?? []).toString() || "null",
    );
    lines = invoked.FunctionError
      ? visibilityWarnings({
          error: "function_error",
          message: answer?.errorMessage ?? String(invoked.FunctionError),
        })
      : visibilityWarnings(answer);
    if (lines.length === 0)
      lines = [
        `visibility check: ${answer.checked} tables, none behind (floor ${answer.floor_pages} pages, ${answer.min_all_visible_share * 100}% all-visible)`,
      ];
  } catch (err) {
    lines = visibilityWarnings({
      error: "invoke_failed",
      message: err?.message ?? String(err),
    });
  }
  for (const line of lines) log(line);
  return lines;
}
