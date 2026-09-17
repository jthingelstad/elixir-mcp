/**
 * The elixir-mcp dashboard (infra/template.yaml, AWS::CloudWatch::Dashboard)
 * is generated JSON under !Sub. This pins that it parses, that every name
 * it substitutes is a resource or parameter of the stack (a renamed Lambda
 * would otherwise leave a dead widget), and that the grid is sane. It lives
 * with the jobs tests because the jobs Lambda emits half of what it draws.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const template = readFileSync(
  path.join(here, "../../../infra/template.yaml"),
  "utf8",
);

function dashboardBody() {
  const start = template.indexOf("DashboardBody: !Sub |\n");
  assert.ok(start > 0, "the dashboard body is in the template");
  const lines = [];
  for (const line of template.slice(start).split("\n").slice(1)) {
    if (line === "") {
      lines.push("");
      continue;
    }
    if (!line.startsWith("        ")) break;
    lines.push(line.slice(8));
  }
  return lines.join("\n");
}

const declared = new Set(
  [...template.matchAll(/^  ([A-Za-z][A-Za-z0-9]*):$/gm)].map((m) => m[1]),
);

test("the dashboard body parses once its substitutions are filled, and names only this stack's resources", () => {
  const raw = dashboardBody();
  const refs = [...raw.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);
  assert.ok(refs.length > 20);
  for (const ref of new Set(refs)) {
    if (ref.startsWith("AWS::")) continue;
    const logical = ref.split(".")[0];
    assert.ok(
      declared.has(logical),
      `${ref} names ${logical}, not in the template`,
    );
  }
  const filled = raw
    .replace(/\$\{MonthlyCostAlarmUsd\}/g, "40")
    .replace(/\$\{[^}]+\}/g, "x");
  const body = JSON.parse(filled);
  assert.equal(body.start, "-PT24H");
  assert.ok(body.widgets.length >= 16);
  for (const w of body.widgets) {
    assert.ok(["metric", "alarm", "log"].includes(w.type), w.type);
    assert.ok(
      w.x >= 0 && w.x + w.width <= 24,
      `${w.properties.title} fits the grid`,
    );
    assert.ok(w.height > 0 && w.y >= 0);
    if (w.type === "metric") {
      assert.ok(w.properties.metrics.length > 0);
      assert.equal(w.properties.region, "x", "the region is the stack's");
    }
  }
  const alarmWidget = body.widgets.find((w) => w.type === "alarm");
  assert.equal(
    alarmWidget.properties.alarms.length,
    (template.match(/Type: AWS::CloudWatch::Alarm$/gm) ?? []).length,
    "the alarm strip names every alarm in the stack",
  );
});
