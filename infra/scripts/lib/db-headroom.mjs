/**
 * The database's burst headroom, read before the acceptance gate
 * (2026-11-13). The instance is a db.t4g.micro: its EBS bandwidth bursts
 * from a bucket (`EBSByteBalance%`, `EBSIOBalance%`) that refills only
 * slowly at idle, about 4 to 6 points an hour on 2026-11-12/13. About ten
 * deploys with acceptance in one evening took the byte balance from 89%
 * to 0, and at 0 the database dropped connections, the doors answered
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

/** Idle refill, points an hour: the low end of what 2026-11-12/13
 *  showed, so the wait it suggests is not optimistic. */
const REFILL_PER_HOUR = 4;

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
 * @returns {{ ok: boolean, skipped: boolean, summary: string, lines: string[] }}
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
      lines: [`acceptance preflight: ${summary}. OK.`],
    };
  if (override)
    return {
      ok: true,
      skipped: false,
      summary: `${summary}; overridden`,
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
  return { ok: false, skipped: false, summary, lines };
}

function pct(v) {
  return typeof v === "number" ? `${Math.round(v)}%` : "unknown";
}
