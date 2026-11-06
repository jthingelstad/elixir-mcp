import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RenderPlugin } from "@11ty/eleventy";
import { JSDOM } from "jsdom";
import configure from "../eleventy.config.mjs";
import stats from "../src/_data/stats.js";

test("the published chart excludes removed counts and distinguishes the window from the whole record", async () => {
  const render = await RenderPlugin.File(
    fileURLToPath(new URL("../src/data/index.njk", import.meta.url)),
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
  assert.match(text, /full record holds 12 battles/);
  assert.match(text, /Last counted/);
  assert.match(text, /Removed records are left out/);
  assert.doesNotMatch(
    text,
    /Full history is deliberate|retention policy comes/,
  );
  // The page draws a wide and a narrow window; the wide one is the 120 days.
  const shown = [
    ...document.querySelectorAll('[data-chart="wide"] rect title'),
  ].map((title) => title.textContent);
  assert.equal(shown.length, 120, "gaps remain real zero days");
  assert.ok(shown.includes("Sep 13: 3 battles"), shown.at(-1));
  assert.ok(shown.includes("Sep 14: 0 battles"));
  assert.ok(!shown.some((title) => title.includes("Jan 3")));

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
    [...remaining.querySelectorAll('[data-chart="wide"] rect title')].find(
      (title) => title.textContent.startsWith("Sep 13"),
    ).textContent,
    "Sep 13: 0 battles",
    "a removed daily population does not survive in the chart",
  );
});

test("the chart's two windows draw from the series and the chips switch between them", async () => {
  const render = await RenderPlugin.File(
    fileURLToPath(new URL("../src/data/index.njk", import.meta.url)),
    { config: configure },
  );
  const html = await render({
    stats: {
      ok: true,
      totals: { battles: 12 },
      series: {
        battles_daily: [
          { day: "2026-01-03", battles: 1 },
          { day: "2026-07-01", battles: 4 },
          { day: "2026-10-06", battles: 8 },
        ],
      },
      fetched_at: "2026-10-06T07:34:00.000Z",
    },
  });
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const { document } = dom.window;
  const chart = (key) => document.querySelector(`[data-chart="${key}"]`);
  const bars = (key) =>
    [...chart(key).querySelectorAll("rect title")].map((t) => t.textContent);
  const chips = document.querySelector("[data-chart-range]");

  // Before the script runs the wide window stands alone, and no chip shows.
  assert.equal(chips.hidden, true);
  assert.equal(chart("wide").hidden, false);
  assert.equal(chart("narrow").hidden, true);
  assert.equal(bars("wide").length, 120);
  assert.equal(bars("narrow").length, 56);
  assert.ok(bars("wide").includes("Jul 1: 4 battles"));
  assert.ok(
    !bars("narrow").some((title) => title.startsWith("Jul 1")),
    "the narrow window stops at eight weeks",
  );
  assert.ok(bars("narrow").includes("Oct 6: 8 battles"));
  assert.match(chart("narrow").textContent, /8 retained battles/);

  // The page's own script, with the status read refused: the chart does not
  // depend on it.
  dom.window.fetch = async () => ({ ok: false });
  dom.window.eval(
    readFileSync(
      fileURLToPath(new URL("../src/assets/data-live.js", import.meta.url)),
      "utf8",
    ),
  );
  assert.equal(chips.hidden, false);
  const [wideChip, narrowChip] = chips.querySelectorAll("[data-range]");
  narrowChip.click();
  assert.equal(chart("wide").hidden, true);
  assert.equal(chart("narrow").hidden, false);
  assert.equal(narrowChip.getAttribute("aria-pressed"), "true");
  assert.equal(wideChip.getAttribute("aria-pressed"), "false");
  wideChip.click();
  assert.equal(chart("wide").hidden, false);
  assert.equal(chart("narrow").hidden, true);
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
