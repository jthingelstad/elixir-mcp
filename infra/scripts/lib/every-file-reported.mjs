/**
 * A `node --test` reporter that fails the run when a test file's report
 * did not arrive whole (#1052, docs/notes/2026-11-14-test-count-integrity.md).
 *
 * `node --test` runs each file in a child process that streams its
 * results to the parent over stdout. The parent counts what it reads and
 * decides pass or fail from those results and the child's exit code. A
 * child that exits 0 before its last results were read (a
 * `process.exit()` in a test, or `--test-force-exit` on macOS, where a
 * pipe is written asynchronously and exit drops what is still queued)
 * leaves a short report that node counts as a pass: 259 tests instead of
 * 267, all green.
 *
 * The last thing a child writes is its own summary (`test:summary` with
 * `file` set), carrying the number of tests it ran. So every file must
 * deliver that summary, and the tests the parent saw from it must number
 * what the summary says. A file that fails either check sets the exit
 * code and is named. No count is kept by hand: each file states its own.
 *
 * The runner (infra/scripts/test.mjs) adds this reporter beside `spec` to
 * every `node --test` unit and fails a unit that never printed MARK, so a
 * unit that lost the reporter cannot pass either.
 */
export const MARK = "every-file-reported:";

/** The files whose reports were cut short, from node's reporter events.
 *  Exported for the tests. */
export function shortFiles(events) {
  const files = new Map();
  const entry = (file) => {
    if (!files.has(file)) files.set(file, { seen: 0, summary: null });
    return files.get(file);
  };
  for (const { type, data } of events) {
    if (!data?.file) continue;
    if (
      (type === "test:pass" || type === "test:fail") &&
      data.details?.type !== "suite"
    )
      entry(data.file).seen += 1;
    else if (type === "test:summary") entry(data.file).summary = data.counts;
  }
  const short = [];
  let tests = 0;
  for (const [file, f] of files) {
    if (!f.summary) short.push({ file, seen: f.seen, ran: null });
    else if (f.summary.tests !== f.seen)
      short.push({ file, seen: f.seen, ran: f.summary.tests });
    else tests += f.seen;
  }
  return { files: files.size, tests, short };
}

export default async function* everyFileReported(source) {
  const events = [];
  for await (const event of source)
    if (
      event.type === "test:pass" ||
      event.type === "test:fail" ||
      event.type === "test:summary"
    )
      events.push({ type: event.type, data: event.data });
  const { files, tests, short } = shortFiles(events);
  if (short.length) {
    process.exitCode = 1;
    for (const s of short)
      yield s.ran === null
        ? `${MARK} FAIL ${s.file}: its report ended before its summary (${s.seen} test results read). The file's process exited before it finished reporting, or it defines no tests.\n`
        : `${MARK} FAIL ${s.file}: it ran ${s.ran} tests but ${s.seen} results were read.\n`;
    yield `${MARK} ${short.length} of ${files} files did not report every test\n`;
  } else
    yield `${MARK} ${files} files, each reported all of its tests (${tests})\n`;
}
