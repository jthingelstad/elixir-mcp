/**
 * The acceptance preflight (infra/scripts/lib/db-headroom.mjs) offline:
 * what it asks CloudWatch, how it reads the answer, when it refuses, and
 * that the deploy's acceptance phase records a refusal and runs nothing.
 * 2026-11-12/13: about ten acceptance runs in one evening drained the
 * database's EBS byte balance to 0 and it dropped connections.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DB_INSTANCE,
  HEADROOM_FLOOR,
  headroomVerdict,
  readDbHeadroom,
} from "../../../infra/scripts/lib/db-headroom.mjs";
import {
  DEPLOY_PHASES,
  acceptanceHeadroom,
} from "../../../infra/scripts/deploy.mjs";
import {
  argumentRefusal,
  parseDeployArgs,
} from "../../../infra/scripts/lib/deploy-args.mjs";

const repo = path.resolve(import.meta.dirname, "../../..");

test("the preflight reads the instance the template names", async () => {
  const template = await readFile(
    path.join(repo, "infra/template.yaml"),
    "utf8",
  );
  assert.match(template, new RegExp(`DBInstanceIdentifier: ${DB_INSTANCE}\\b`));
});

test("the preflight asks for the newest five-minute minimum of each balance", async () => {
  let asked;
  const now = Date.parse("2026-11-13T06:05:00Z");
  const headroom = await readDbHeadroom({
    now: () => now,
    getMetricData: async (input) => {
      asked = input;
      return {
        MetricDataResults: [
          {
            Id: "bytebalance",
            Timestamps: [
              new Date("2026-11-13T06:00:00Z"),
              new Date("2026-11-13T05:55:00Z"),
            ],
            Values: [1, 0],
          },
          {
            Id: "iobalance",
            Timestamps: [new Date("2026-11-13T06:00:00Z")],
            Values: [68.5],
          },
          { Id: "cpucredits", Timestamps: [], Values: [] },
        ],
      };
    },
  });
  assert.deepEqual(headroom, {
    byteBalance: 1,
    ioBalance: 68.5,
    cpuCredits: null,
    at: "2026-11-13T06:00:00.000Z",
  });
  assert.equal(asked.ScanBy, "TimestampDescending");
  assert.equal(asked.EndTime.getTime(), now);
  assert.equal(asked.StartTime.getTime(), now - 30 * 60_000);
  assert.deepEqual(
    asked.MetricDataQueries.map((q) => [
      q.MetricStat.Metric.MetricName,
      q.MetricStat.Period,
      q.MetricStat.Stat,
      q.MetricStat.Metric.Dimensions[0].Value,
    ]),
    [
      ["EBSByteBalance%", 300, "Minimum", DB_INSTANCE],
      ["EBSIOBalance%", 300, "Minimum", DB_INSTANCE],
      ["CPUCreditBalance", 300, "Minimum", DB_INSTANCE],
    ],
  );
});

test("the whole suite needs 50%, a family 25%, judged on the lower balance", () => {
  assert.deepEqual(HEADROOM_FLOOR, { whole: 50, family: 25 });
  const at = (byteBalance, ioBalance = 99) => ({
    byteBalance,
    ioBalance,
    cpuCredits: 0,
  });
  assert.equal(headroomVerdict(at(50)).ok, true);
  assert.equal(headroomVerdict(at(49)).ok, false);
  assert.equal(headroomVerdict(at(99, 40)).ok, false, "I/O balance counts too");
  assert.equal(headroomVerdict(at(25), { family: "elixir" }).ok, true);
  assert.equal(headroomVerdict(at(24), { family: "elixir" }).ok, false);
  // CPU credits are printed, never a refusal (unlimited mode).
  const ok = headroomVerdict({ byteBalance: 90, ioBalance: 95, cpuCredits: 0 });
  assert.equal(ok.ok, true);
  assert.match(ok.lines[0], /CPU credits 0\.0/);
});

test("a refusal says how to proceed: wait, one family, or the override", () => {
  const whole = headroomVerdict({
    byteBalance: 30,
    ioBalance: 70,
    cpuCredits: 1,
  });
  assert.equal(whole.ok, false);
  const text = whole.lines.join("\n");
  assert.match(text, /REFUSED/);
  assert.match(text, /about 7 h/, "(50 - 30) / 3 points an hour, rounded up");
  assert.match(
    text,
    /--acceptance=<family> needs 25% \(there is room for that\)/,
  );
  assert.match(text, /--skip-headroom-check/);
  const family = headroomVerdict(
    { byteBalance: 1, ioBalance: 68, cpuCredits: 4 },
    { family: "elixir" },
  );
  assert.equal(family.ok, false);
  assert.match(
    family.lines.join("\n"),
    /npm run acceptance -- --family elixir/,
  );
  const forced = headroomVerdict(
    { byteBalance: 1, ioBalance: 68, cpuCredits: 4 },
    { override: true },
  );
  assert.equal(forced.ok, true);
  assert.match(forced.lines[0], /BELOW the floor; running anyway/);
});

test("an unreadable balance is a logged skip, never a refusal", async () => {
  const denied = await acceptanceHeadroom({
    args: { acceptanceFamily: null, skipHeadroomCheck: false },
    readDbHeadroom: async () => {
      const error = new Error(
        "not authorized to perform cloudwatch:GetMetricData",
      );
      error.name = "AccessDenied";
      throw error;
    },
  });
  assert.equal(denied.ok, true);
  assert.equal(denied.skipped, true);
  assert.match(denied.lines[0], /SKIPPED.*AccessDenied/);
  const empty = headroomVerdict({
    byteBalance: null,
    ioBalance: null,
    cpuCredits: null,
  });
  assert.equal(empty.ok, true);
  assert.match(empty.lines[0], /no EBSByteBalance% datapoint/);
});

test("the override flag parses and refuses nothing", () => {
  const args = parseDeployArgs([
    "--acceptance=elixir",
    "--skip-headroom-check",
  ]);
  assert.equal(args.skipHeadroomCheck, true);
  assert.equal(args.acceptanceFamily, "elixir");
  assert.equal(argumentRefusal(args), null);
  assert.equal(parseDeployArgs([]).skipHeadroomCheck, false);
});

test("the acceptance phase records a refusal, runs nothing and makes the deploy exit 1", async (t) => {
  t.mock.method(console, "log", () => {});
  const dir = await mkdtemp(path.join(tmpdir(), "headroom-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = path.join(dir, ".env");
  await writeFile(env, "ELIXIR_MCP_URL=x\n");
  const phase = DEPLOY_PHASES.find((p) => p.name === "acceptance");
  const d = {
    args: parseDeployArgs(["--acceptance"]),
    acceptanceEnvPath: env,
    readDbHeadroom: async () => ({
      byteBalance: 12,
      ioBalance: 80,
      cpuCredits: 0,
    }),
  };
  await phase.run(d);
  assert.match(d.acceptanceResult, /^refused \(EBS byte balance 12%/);
  assert.equal(d.exitCode, 1);
});
