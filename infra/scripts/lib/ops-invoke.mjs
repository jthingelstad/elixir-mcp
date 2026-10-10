/**
 * `npm run op` (infra/scripts/op.mjs): one synchronous invoke of an ops
 * Lambda, the way the ops skill's `aws lambda invoke` does it (profile
 * cloud-engineer, us-east-1, no retries, a read timeout past the
 * function's own), with the production lock around every write.
 *
 * Fail safe: an op is a READ only when every key of the payload is on
 * the allowlist below and its value has the read shape. Anything else,
 * an unknown key, a misspelling, a write op, an extra key beside a read,
 * is a write and takes the lock first. The allowlist is derived from
 * the ops catalogue (.claude/skills/ops/ops.md, the "Does" column) and
 * from the handlers themselves (services/migrate/src/lambda.mjs,
 * services/jobs/src/index.mjs); services/mcp/test/ops-invoke.test.mjs
 * holds every listed key to a key the dispatcher still has. An op that
 * the catalogue calls a read but that may refresh a stamp
 * (reference_seed_preview) or writes a table as it goes (the jobs
 * censuses) is a write here.
 *
 * A read takes no lock, but it does not run while production is locked
 * either: both functions run at reserved concurrency 1, and a read
 * during a deploy's migration step 429s the deploy (twice on
 * 2026-09-22). Held is a wait.
 */

export const FUNCTIONS = {
  migrate: { name: "elixir-mcp-migrate", timeoutS: 300 },
  jobs: { name: "elixir-mcp-jobs", timeoutS: 900 },
};

const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
/** An object with exactly these keys (and these values, where given). */
const exactly = (v, shape) =>
  isObject(v) &&
  Object.keys(v).length === Object.keys(shape).length &&
  Object.entries(shape).every(([k, want]) =>
    typeof want === "function" ? want(v[k]) : v[k] === want,
  );
/** `true`, or an object (the op's arguments). Never a falsy value: the
 *  dispatcher refuses those as unknown_op. */
const anyArgs = (v) => v === true || isObject(v);
const noKeys =
  (...keys) =>
  (v) =>
    v === true || (isObject(v) && keys.every((k) => !Object.hasOwn(v, k)));

const CLAN_MAINTENANCE_READ_LANES = new Set([
  "actions",
  "clans",
  "grants",
  "morning",
  "action_log",
  "policies",
]);

/** Migrate ops that only read, with the value shape that keeps them a
 *  read. */
const MIGRATE_READS = {
  // Census and audits; diagnostics; explains. "Read" in ops.md.
  stats: anyArgs,
  tables: anyArgs,
  statements: anyArgs,
  inspect: anyArgs,
  probe: anyArgs,
  sessions: anyArgs,
  war_drift: anyArgs,
  role_history_census: anyArgs,
  membership_baseline_census: anyArgs,
  live_fetch_strays: anyArgs,
  tag_footprint: anyArgs,
  capture_audit: anyArgs,
  poll_replay: anyArgs,
  enum_census: anyArgs,
  battle_fidelity_census: anyArgs,
  mode_shape_census: anyArgs,
  deck_census: anyArgs,
  audit_census: anyArgs,
  args_census: anyArgs,
  call_sequence_census: anyArgs,
  acceptance_catalogue: anyArgs,
  profile_tool: anyArgs,
  explain_participation: anyArgs,
  explain_standings: anyArgs,
  explain_timeline: anyArgs,
  explain_series: anyArgs,
  activity_preview: anyArgs,
  refusal_census: anyArgs,
  controls_census: anyArgs,
  series_status: anyArgs,
  series_census_self: anyArgs,
  feedback_pending: anyArgs,
  feedback_read: anyArgs,
  poll_state: anyArgs,
  backends: anyArgs,
  // Read in one shape, a write in every other.
  ledger: (v) => v === true || exactly(v, { op: "dead" }),
  account_role: (v) => exactly(v, { list: true }),
  integration: (v) => exactly(v, { action: "list" }),
  family_clients: (v) => exactly(v, { list: true }),
  oauth_grants: (v) =>
    exactly(v, { redirect_host: (h) => typeof h === "string" && h !== "" }),
  rollup_regroup: (v) => exactly(v, { census: true }),
  // A dry run reads; only an explicit one counts (two of the three
  // default to a dry run, account_track does not).
  account_remove: (v) => isObject(v) && v.dry_run === true,
  account_enroll: (v) => isObject(v) && v.dry_run === true,
  account_track: (v) => isObject(v) && v.dry_run === true,
  agent_recordings: (v) => exactly(v, { dry_run: true }),
  // Previews; apply and revoke are the writes.
  clan_context: (v) => isObject(v) && noKeys("apply", "revoke")(v),
  clan_maintenance: (v) =>
    isObject(v) &&
    CLAN_MAINTENANCE_READ_LANES.has(v.lane) &&
    !Object.hasOwn(v, "apply"),
};

/** Jobs ops that only read. The jobs Lambda's other keys send mail,
 *  sweep or write a census table. */
const JOBS_READS = {
  clan_report_preview: isObject,
  series_metrics: anyArgs,
};

const READS = { migrate: MIGRATE_READS, jobs: JOBS_READS };

/** Every key the allowlist names, for the test that holds it to the
 *  dispatchers. */
export const READ_KEYS = {
  migrate: Object.keys(MIGRATE_READS),
  jobs: Object.keys(JOBS_READS),
};

/**
 * @returns {{ kind: "read" | "write", ops: string[], why?: string }}
 */
export function classifyOp(fn, payload) {
  const reads = READS[fn];
  if (!reads) throw new Error(`unknown function ${fn}`);
  const ops = isObject(payload) ? Object.keys(payload) : [];
  if (ops.length === 0) return { kind: "write", ops, why: "an empty payload" };
  const writes = ops.filter(
    (op) => !Object.hasOwn(reads, op) || !reads[op](payload[op]),
  );
  return writes.length === 0
    ? { kind: "read", ops }
    : { kind: "write", ops, why: `not a read: ${writes.join(", ")}` };
}

const OP_USAGE = `usage: npm run op -- '<json payload>' [--function migrate|jobs]

  Invokes the ops Lambda once, synchronously (default: migrate), as
  profile cloud-engineer in us-east-1, with no retries. Prints the
  response JSON and the function error if any; exits 1 on a function
  error. A write op takes the production lock first; a read takes none
  but does not run while production is locked. The payload's keys are
  .claude/skills/ops/ops.md's ops (migrate) or the jobs Lambda's.

  npm run op -- '{"stats": true}'
  npm run op -- '{"ledger": {"op": "dead"}}'
  npm run op -- '{"clan_report_preview": {"clan_tag": "#TAG"}}' --function jobs

  {} is refused: it runs the migrations, and that is deploy.mjs's call.`;

/** @param {string[]} argv process.argv.slice(2) */
export function parseOpArgs(argv) {
  const out = { help: false, fn: "migrate", payload: null, errors: [] };
  const rest = [...argv];
  let raw = null;
  while (rest.length) {
    const arg = rest.shift();
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--function") out.fn = rest.shift() ?? "";
    else if (arg.startsWith("--function=")) out.fn = arg.slice(11);
    else if (raw === null && !arg.startsWith("--")) raw = arg;
    else out.errors.push(`unknown argument ${arg}`);
  }
  if (out.help) return out;
  if (!Object.hasOwn(FUNCTIONS, out.fn))
    out.errors.push(
      `--function ${JSON.stringify(out.fn)}: use ${Object.keys(FUNCTIONS).join(" or ")}`,
    );
  if (raw === null) {
    out.errors.push("a JSON payload is required");
    return out;
  }
  try {
    out.payload = JSON.parse(raw);
  } catch (error) {
    out.errors.push(`the payload is not JSON: ${error.message}`);
    return out;
  }
  if (!isObject(out.payload))
    out.errors.push("the payload must be a JSON object");
  else if (Object.keys(out.payload).length === 0)
    out.errors.push(
      "{} runs the migrations; that is deploy.mjs's call, never a hand-run op",
    );
  return out;
}

/** The function's response body as JSON when it is JSON, else text. */
function decodePayload(bytes) {
  const text = bytes ? Buffer.from(bytes).toString("utf8") : "";
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Invoke once. `lambda` is a client with send(); `InvokeCommand` its
 * command class (both injected, so the tests never reach AWS).
 *
 * @returns {Promise<{ statusCode?: number, functionError: string | null, body: unknown }>}
 */
async function invokeOnce({ lambda, InvokeCommand, fn, payload }) {
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: FUNCTIONS[fn].name,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
  return {
    statusCode: res.StatusCode,
    functionError: res.FunctionError ?? null,
    body: decodePayload(res.Payload),
  };
}

/** The client settings that make one call one call: no SDK retries, and
 *  a socket that waits past the function's own timeout instead of
 *  giving up (on 2026-09-19 a CLI retry ran a jobs op twice). */
export function lambdaClientConfig(fn) {
  return {
    region: "us-east-1",
    profile: "cloud-engineer",
    maxAttempts: 1,
    requestHandler: {
      connectionTimeout: 10_000,
      requestTimeout: (FUNCTIONS[fn].timeoutS + 30) * 1000,
    },
  };
}

const ENGINEER = /:assumed-role\/ProjectsCloudEngineer\//;

/**
 * The whole command, with every outside effect injected: `whoami()`
 * answers the caller's ARN, `lambda`/`InvokeCommand` invoke, and the
 * lock functions are production-lock.mjs's. Returns the exit code.
 */
export async function runOp({
  argv,
  whoami,
  lambda,
  InvokeCommand,
  lockFile,
  acquireLock,
  lockHolder,
  holdUntilExit,
  describe,
  worktree,
  head,
  print = (line) => console.log(line),
  warn = (line) => console.error(line),
}) {
  const args = parseOpArgs(argv);
  if (args.help) {
    print(OP_USAGE);
    return 0;
  }
  if (args.errors.length) {
    warn(`op: ${args.errors.join("; ")}; nothing was invoked.\n\n${OP_USAGE}`);
    return 2;
  }
  const { fn, payload } = args;
  const op = classifyOp(fn, payload);
  const label = `${FUNCTIONS[fn].name} ${op.ops.join("+")}`;
  const arn = await whoami();
  if (!ENGINEER.test(arn ?? "")) {
    warn(
      `op: the caller is ${arn}, not the ProjectsCloudEngineer role; nothing was invoked.`,
    );
    return 2;
  }

  let release = () => {};
  if (op.kind === "write") {
    const got = acquireLock({
      file: lockFile,
      holder: `op:${op.ops
        .join("+")
        .replace(/[^\w+.-]/g, "_")
        .slice(0, 80)}`,
      purpose: `a write through ${label} (${op.why})`,
      worktree,
      head,
      warn,
    });
    if (!got.ok) {
      warn(`op: ${got.reason}\nNothing was invoked.`);
      return 3;
    }
    release = holdUntilExit({ file: lockFile, lock: got.lock, log: warn });
    warn(`op: WRITE (${op.why}); production lock taken.`);
  } else {
    const holder = lockHolder({ file: lockFile, warn });
    if (holder) {
      warn(
        `op: a read, but production is locked and ${FUNCTIONS[fn].name} runs one invocation at a time; ${describe(holder)}\nNothing was invoked.`,
      );
      return 3;
    }
    warn("op: read.");
  }
  try {
    warn(`op: invoking ${label} once, synchronously...`);
    const res = await invokeOnce({ lambda, InvokeCommand, fn, payload });
    print(
      typeof res.body === "string"
        ? res.body
        : JSON.stringify(res.body, null, 2),
    );
    if (res.functionError) {
      warn(
        `op: FunctionError ${res.functionError} (status ${res.statusCode}).`,
      );
      return 1;
    }
    if (isObject(res.body) && res.body.error)
      warn(`op: the op answered error ${JSON.stringify(res.body.error)}.`);
    return 0;
  } finally {
    release();
  }
}
