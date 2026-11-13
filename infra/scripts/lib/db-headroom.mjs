/**
 * The database's burst headroom, read before the acceptance gate
 * (2026-11-13). The instance is a db.t4g.micro: its EBS bandwidth bursts
 * from a bucket (`EBSByteBalance%`, `EBSIOBalance%`) that refills only
 * slowly at quiet times, 1 to 6 points an hour on 2026-11-12/13
 * depending on the traffic behind it. About ten deploys with acceptance
 * in one evening took the byte balance from 89% to 0, and at 0 the database dropped connections, the doors answered
 * 5xx and ingest hit statement timeouts. A whole-suite run cost about 10
 * to 15 points of balance (29 at worst), a one-family run about 4 to 7.
 *
 * So the deploy reads the balances from CloudWatch first and refuses to
 * start acceptance below a floor that leaves room for the run and for
 * the traffic behind it. The CPU credit balance is printed, never a
 * refusal: RDS runs T4g in unlimited mode, so an empty CPU bucket costs
 * cents of surplus credit, not availability, and a restart starts it
 * at 0 (it read 0 for ten hours after the 2026-11-12 restart).
 *
 * What the floors rest on is thin (2026-11-13 review): the costs above
 * came from reading the balance graph by hand on the micro, and no deploy
 * log recorded a balance after its run. Every logged run that day was on
 * a db.t4g.small with the balances at 99-100% before and nothing after.
 * So the deploy now also records the lowest balance during its run
 * (`readHeadroomLow`) and prints and stores the cost (`acceptanceCost`);
 * the floors stay until runs on the micro have recorded what they cost.
 *
 * The CloudWatch call is injected, so the tests run offline. A read that
 * fails (no permission, no datapoints) is a logged skip, never a
 * refusal and never silent.
 */

/** infra/template.yaml's DBInstanceIdentifier; a test pins the match. */
export const DB_INSTANCE = "elixir-mcp-enc";

/** The lower of the byte and I/O balances, in percent, below which a
 *  run refuses. The whole suite needs room for its worst observed cost
 *  (29 points) with a margin; one family's run costs a fraction. */
export const HEADROOM_FLOOR = { whole: 50, family: 25 };

/** Quiet-time refill, points an hour: below the middle of what
 *  2026-11-12/13 showed (1 to 6), so the wait it suggests is not
 *  optimistic. */
const REFILL_PER_HOUR = 3;

const METRICS = [
  ["byteBalance", "EBSByteBalance%"],
  ["ioBalance", "EBSIOBalance%"],
  ["cpuCredits", "CPUCreditBalance"],
];

/**
 * The latest five-minute value of each balance.
 *
 * @param {{ getMetricData: (input: any) => Promise<any>, now?: () => number, instance?: string }} io
 * @returns {Promise<{ byteBalance: number|null, ioBalance: number|null, cpuCredits: number|null, at: string|null }>}
 */
export async function readDbHeadroom({
  getMetricData,
  now = Date.now,
  instance = DB_INSTANCE,
}) {
  const end = new Date(now());
  const out = await getMetricData({
    StartTime: new Date(end.getTime() - 30 * 60_000),
    EndTime: end,
    ScanBy: "TimestampDescending",
    MetricDataQueries: METRICS.map(([id, name]) => ({
      Id: id.toLowerCase(),
      MetricStat: {
        Metric: {
          Namespace: "AWS/RDS",
          MetricName: name,
          Dimensions: [{ Name: "DBInstanceIdentifier", Value: instance }],
        },
        Period: 300,
        Stat: "Minimum",
      },
    })),
  });
  const headroom = {
    byteBalance: null,
    ioBalance: null,
    cpuCredits: null,
    at: null,
  };
  for (const [key] of METRICS) {
    const result = out?.MetricDataResults?.find(
      (r) => r.Id === key.toLowerCase(),
    );
    // Descending scan: the first value is the newest.
    const value = result?.Values?.[0];
    if (typeof value === "number") {
      headroom[key] = value;
      const at = result.Timestamps?.[0];
      if (at && (!headroom.at || new Date(at) > new Date(headroom.at)))
        headroom.at = new Date(at).toISOString();
    }
  }
  return headroom;
}

/**
 * Whether acceptance may start, and the lines that say why.
 *
 * @param {{ byteBalance: number|null, ioBalance: number|null, cpuCredits: number|null } | { error: string }} headroom
 * @param {{ family?: string|null, override?: boolean }} [options]
 * @returns {{ ok: boolean, skipped: boolean, summary: string, lines: string[], headroom: any }}
 */
export function headroomVerdict(
  headroom,
  { family = null, override = false } = {},
) {
  const floor = family ? HEADROOM_FLOOR.family : HEADROOM_FLOOR.whole;
  const suite = family ? `--acceptance=${family}` : "the whole suite";
  if ("error" in headroom || headroom.byteBalance === null) {
    const why =
      "error" in headroom ? headroom.error : "no EBSByteBalance% datapoint";
    return {
      ok: true,
      skipped: true,
      summary: "headroom not read",
      headroom: null,
      lines: [
        `acceptance preflight: SKIPPED - could not read ${DB_INSTANCE}'s burst balances (${why}); running without the check.`,
      ],
    };
  }
  const balances = [headroom.byteBalance, headroom.ioBalance].filter(
    (v) => typeof v === "number",
  );
  const lowest = Math.min(...balances);
  const shown = `EBS byte balance ${pct(headroom.byteBalance)}, I/O balance ${pct(headroom.ioBalance)}, CPU credits ${headroom.cpuCredits === null ? "unknown" : headroom.cpuCredits.toFixed(1)}`;
  const summary = `${shown}; floor ${floor}% for ${suite}`;
  if (lowest >= floor)
    return {
      ok: true,
      skipped: false,
      summary,
      headroom,
      lines: [`acceptance preflight: ${summary}. OK.`],
    };
  if (override)
    return {
      ok: true,
      skipped: false,
      summary: `${summary}; overridden`,
      headroom,
      lines: [
        `acceptance preflight: ${summary}. BELOW the floor; running anyway (--skip-headroom-check).`,
      ],
    };
  const hours = Math.max(1, Math.ceil((floor - lowest) / REFILL_PER_HOUR));
  const lines = [
    `acceptance preflight: REFUSED - ${summary}.`,
    `  A run now would drain the database toward 0, where it drops connections (2026-11-13).`,
    `  Wait: idle refill is about ${REFILL_PER_HOUR} points an hour, so about ${hours} h; then \`npm run acceptance${family ? ` -- --family ${family}` : ""}\`.`,
  ];
  if (!family)
    lines.push(
      `  Or run one family now: --acceptance=<family> needs ${HEADROOM_FLOOR.family}%${lowest >= HEADROOM_FLOOR.family ? " (there is room for that)" : " (not enough for that either)"}.`,
    );
  lines.push(
    "  In an outage, when the gate matters more than the database: --skip-headroom-check.",
  );
  return { ok: false, skipped: false, summary, lines, headroom };
}

/**
 * The lowest of each burst balance from `from` to `to`, at RDS's
 * one-minute resolution: what a run drew the bucket down to. CloudWatch
 * lags a minute or two, so a read right after the run can miss its last
 * minutes; the record says when it was read.
 *
 * @param {{ getMetricData: (input: any) => Promise<any>, from: Date|string|number, to?: Date|string|number, instance?: string }} io
 * @returns {Promise<{ byteBalance: number|null, ioBalance: number|null, cpuCredits: number|null, points: number }>}
 */
export async function readHeadroomLow({
  getMetricData,
  from,
  to = Date.now(),
  instance = DB_INSTANCE,
}) {
  const start = new Date(from);
  const end = new Date(to);
  const out = await getMetricData({
    // A whole minute either side, so a short run still has a datapoint.
    StartTime: new Date(start.getTime() - 60_000),
    EndTime: new Date(end.getTime() + 60_000),
    MetricDataQueries: METRICS.map(([id, name]) => ({
      Id: id.toLowerCase(),
      MetricStat: {
        Metric: {
          Namespace: "AWS/RDS",
          MetricName: name,
          Dimensions: [{ Name: "DBInstanceIdentifier", Value: instance }],
        },
        Period: 60,
        Stat: "Minimum",
      },
    })),
  });
  const low = {
    byteBalance: null,
    ioBalance: null,
    cpuCredits: null,
    points: 0,
  };
  for (const [key] of METRICS) {
    const values = (
      out?.MetricDataResults?.find((r) => r.Id === key.toLowerCase())?.Values ??
      []
    ).filter((v) => typeof v === "number");
    if (values.length) low[key] = Math.min(...values);
    if (key === "byteBalance") low.points = values.length;
  }
  return low;
}

/**
 * What one acceptance run cost the database, for the deploy log and its
 * record: the balances before, the lowest during, and the drop. Either
 * side may be missing (a read that failed); the line says so rather than
 * inventing a number.
 *
 * @param {{ byteBalance?: number|null, ioBalance?: number|null } | null | undefined} before
 * @param {{ byteBalance?: number|null, ioBalance?: number|null, points?: number } | { error: string } | null | undefined} low
 * @param {{ startedAt: string, endedAt: string, readAt?: string, family?: string|null, instanceClass?: string|null }} run
 */
export function acceptanceCost(before, low, run) {
  const minutes =
    Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 6000) /
    10;
  const lowError = low && "error" in low ? low.error : null;
  const side = (key) => {
    const b = before?.[key];
    const l = lowError ? null : low?.[key];
    return {
      before: typeof b === "number" ? round1(b) : null,
      lowest: typeof l === "number" ? round1(l) : null,
      drop:
        typeof b === "number" && typeof l === "number"
          ? round1(Math.max(0, b - l))
          : null,
    };
  };
  const record = {
    instance: DB_INSTANCE,
    instance_class: run.instanceClass ?? null,
    suite: run.family ? `family ${run.family}` : "whole",
    started_at: run.startedAt,
    ended_at: run.endedAt,
    read_at: run.readAt ?? run.endedAt,
    minutes,
    byte_balance: side("byteBalance"),
    io_balance: side("ioBalance"),
    points: lowError ? 0 : (low?.points ?? 0),
    ...(lowError ? { error: lowError } : {}),
  };
  const show = ({ before: b, lowest: l, drop }) =>
    `${b === null ? "?" : `${b}%`} -> ${l === null ? "?" : `${l}%`}${drop === null ? "" : ` (-${drop})`}`;
  const line = `acceptance cost: ${record.suite} on ${record.instance_class ?? DB_INSTANCE}, ${minutes} min; EBS byte balance ${show(record.byte_balance)}, I/O balance ${show(record.io_balance)}${lowError ? `; lowest not read (${lowError})` : `; ${record.points} one-minute points`}.`;
  return { record, line };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function pct(v) {
  return typeof v === "number" ? `${Math.round(v)}%` : "unknown";
}
