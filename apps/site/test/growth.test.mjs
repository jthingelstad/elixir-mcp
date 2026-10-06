import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { RenderPlugin } from "@11ty/eleventy";
import { JSDOM } from "jsdom";
import configure from "../eleventy.config.mjs";
import stats from "../src/_data/stats.js";

test("published growth excludes removed counts and distinguishes the window from all retained history", async () => {
  const render = await RenderPlugin.File(
    fileURLToPath(new URL("../src/data/growth.njk", import.meta.url)),
    { config: configure },
  );
  const series = [
    { day: "2026-01-03", battles: 7 },
    { day: "2026-09-13", battles: 3 },
    { day: "2026-10-06", battles: 2 },
  ];
  const html = await render({
    stats: {
      ok: true,
      totals: { battles: 12 },
      series: { battles_daily: series },
      fetched_at: "2026-10-06T07:34:00.000Z",
    },
  });
  const document = new JSDOM(html).window.document;
  const text = document.body.textContent.replace(/\s+/g, " ");
  assert.match(text, /5 retained battles in this 120-day window/);
  assert.match(text, /full retained record contains 12 battles/);
  assert.match(text, /Snapshot fetched 2026-10-06 07:34Z/);
  assert.match(text, /Removed records are excluded/);
  assert.doesNotMatch(
    text,
    /Full history is deliberate|retention policy comes/,
  );
  const titles = [...document.querySelectorAll("rect title")].map(
    (title) => title.textContent,
  );
  assert.equal(titles.length, 120, "gaps remain real zero days");
  assert.ok(titles.includes("2026-09-13 · 3 battles"));
  assert.ok(titles.includes("2026-09-14 · 0 battles"));
  assert.ok(!titles.some((title) => title.includes("2026-01-03")));

  const reduced = await render({
    stats: {
      totals: { battles: 9 },
      series: {
        battles_daily: series.filter((row) => row.day !== "2026-09-13"),
      },
      fetched_at: "2026-10-06T08:00:00.000Z",
    },
  });
  const remaining = new JSDOM(reduced).window.document;
  assert.match(
    remaining.body.textContent,
    /2 retained battles in this 120-day window/,
  );
  assert.equal(
    [...remaining.querySelectorAll("rect title")].find((title) =>
      title.textContent.startsWith("2026-09-13"),
    ).textContent,
    "2026-09-13 · 0 battles",
    "a removed daily population does not survive in the chart",
  );
});

test("stats loader timestamps the fetched snapshot and preserves the current retained series", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({
      totals: { battles: 2 },
      series: { battles_daily: [{ day: "2026-10-06", battles: 2 }] },
    }),
  }));
  const skip = process.env.ELIXIR_SKIP_STATS;
  delete process.env.ELIXIR_SKIP_STATS;
  try {
    const start = Date.now();
    const snapshot = await stats();
    assert.deepEqual(snapshot.series.battles_daily, [
      { day: "2026-10-06", battles: 2 },
    ]);
    assert.equal(snapshot.totals.battles, 2);
    assert.ok(Date.parse(snapshot.fetched_at) >= start);
    assert.ok(Date.parse(snapshot.fetched_at) <= Date.now());
  } finally {
    if (skip === undefined) delete process.env.ELIXIR_SKIP_STATS;
    else process.env.ELIXIR_SKIP_STATS = skip;
  }
});
