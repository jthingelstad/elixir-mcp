# 2026-11-14 — A test unit no longer dies silently under npm

**What happened.** In one full `npm run verify` the `timeline-sync` unit
failed in 0.1 s and printed nothing: not a test line, not even npm's
`> @elixir-mcp/timeline-sync@0.1.0 test` header. Alone it passed 11 of
11, and it passed in the rerun. Other sessions were running verify and
the journeys on the same machine.

**The cause.** macOS wrote a crash report for that second
(`~/Library/Logs/DiagnosticReports/node-2026-11-14-203410.ips`): a `node`
child of a `node` parent, alive 0.13 s, killed by SIGABRT. Its faulting
thread, from the top:

```
abort
_LSApplicationCheckIn            (LaunchServices)
uv__set_process_title            (libuv)
node::ProcessTitleSetter         (process.title = ...)
...
node::fs::AfterMkdirp
```

That is npm: it creates its log directory, then sets `process.title`
before it prints anything. On macOS libuv's `uv_set_process_title` checks
the process in with LaunchServices, and LaunchServices now and then calls
`abort()`. The same stack is in four more reports on this machine since
2026-11-11, all young `node` processes. Nothing in the unit or its test
file was involved; any unit could have drawn it. It could not be made to
happen on demand: 30,000 child processes setting `process.title`, 200 at
a time and beside a full verify, all lived.

The runner made it worse. It printed a failed unit's output and nothing
else, so a unit with no output was a bare `FAIL`. The exit code reached
the log only in GitHub Actions, and the signal never did.

**What changed** (`infra/scripts/test.mjs`):

- **No npm per unit.** A unit runs its workspace's `test` script itself
  (`unitCommand`): `sh -c "<script>"` in the workspace's directory with
  its own and the root's `node_modules/.bin` first on PATH, as npm runs a
  script, still skipping `pretest`. Nothing on that path sets
  `process.title` (node's test runner, vitest and tinypool do not), so 30
  npm starts a run, each a chance at the abort, are gone. The build steps
  around the units (`npm run build`, `npm run verify` itself) still use
  npm once each.
- **A failure always says how it ended.** The unit's heading, the closing
  summary and a line after its output name the exit code or the signal
  (`FAIL timeline-sync (0.1 s, killed by SIGABRT)`), say "and it printed
  nothing" when it did not, and on macOS point at the crash report a
  signal leaves.
- **A unit that cannot start** (a process limit, a missing shell) is that
  unit's failure, said in its output, where before the spawn error would
  have crashed the whole run.

`services/mcp/test/ci-tooling.test.mjs` pins all three: every workspace
unit's command is its own script under `sh`, never npm; a unit killed by
a signal before printing a byte, one that exits 3 and one that cannot
start each report how they ended. Both tests fail on the old runner.

**If it comes back:** the heading now names the signal. For SIGABRT on
macOS, read the newest `node-*.ips` crash report's faulting thread: the
title stack above means something else still sets `process.title`.
