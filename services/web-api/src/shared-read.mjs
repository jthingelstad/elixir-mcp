/**
 * One computation for identical reads that are in flight together.
 *
 * A Clan page asks for several of its panels at once, and each panel's
 * request reads the same eight weeks of `clans_participation` for the
 * same person and clan: three or four identical computations racing on
 * one small database, each slower for the others (live, 2026-11-09:
 * about 1.2 s alone, 2 to 6 s side by side). A request that arrives
 * while an identical read is running waits for that read instead of
 * starting its own.
 *
 * Nothing is kept: the entry is dropped the moment the read settles, so
 * a request that starts after it computes afresh, and no answer is older
 * than the computation it joined. Every caller gets its own copy, so one
 * caller's handling never touches another's. A read that failed or threw
 * is not shared: each waiting caller then makes its own, and gets the
 * answer it would have had alone.
 */

const inFlight = new Map();

const copy = (result) => structuredClone(result);

/**
 * `run()` resolves to the invoker's `{ isError, body }`. Callers with the
 * same `key` while one is running share it; `key` must name everything
 * the answer depends on (the person, the tool, its arguments).
 */
export async function sharedRead(key, run) {
  const running = inFlight.get(key);
  if (running) {
    const result = await running.then(
      (r) => r,
      () => null,
    );
    return result && !result.isError ? copy(result) : run();
  }
  const read = run();
  inFlight.set(key, read);
  const clear = () => {
    if (inFlight.get(key) === read) inFlight.delete(key);
  };
  read.then(clear, clear);
  return copy(await read);
}

/** How many reads are being shared now: for tests. */
export const sharedReadsInFlight = () => inFlight.size;
