/** A model use that outlasts its request (2026-10-11): the API answers
 *  `{ pending }` and the page asks again with it until the words land.
 *  The bridge records a use whose answer never lands as unknown after
 *  110 s, so the page stops asking a little before that. */

export const PENDING_EVERY_MS = 2500;
export const PENDING_FOR_MS = 100_000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `ask(pending)` makes the request (`pending` null the first time) and
 * resolves to the client's `{ ok, data }`. Resolves to the last answer:
 * the words, a refusal, or `{ ok: false, data: { error: "still_pending" } }`
 * when the model has not answered in time.
 */
export async function untilWritten(
  ask,
  { everyMs = PENDING_EVERY_MS, forMs = PENDING_FOR_MS, pause = wait } = {},
) {
  const end = Date.now() + forMs;
  let r = await ask(null);
  while (r?.ok && r.data?.pending) {
    if (Date.now() >= end)
      return { ok: false, data: { error: "still_pending" } };
    await pause(everyMs);
    r = await ask(r.data.pending);
  }
  return r;
}
