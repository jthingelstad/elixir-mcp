/**
 * The service documents itself: three read-only tools over the same
 * sources the public site renders from. No database; the corpus is
 * built at packages/docs and read as data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { elixirTools } from "../src/tools/elixir.mjs";

const ctx = { account: {}, db: null };

test("elixir_docs: the index, one page, and a search that says where", async () => {
  const index = await elixirTools.elixir_docs.handler(ctx, {});
  assert.ok(index.pages.length >= 16);
  assert.ok(index.pages.some((p) => p.slug === "quickstart"));
  assert.ok(index.pages.every((p) => p.section && p.lede && p.url));

  const page = await elixirTools.elixir_docs.handler(ctx, {
    page: "recording",
  });
  assert.equal(page.slug, "recording");
  assert.match(page.markdown, /comprehensive/i);
  assert.equal(page.meta.disclaimer.length > 0, true);

  const found = await elixirTools.elixir_docs.handler(ctx, {
    query: "live_fetch",
  });
  assert.ok(found.matches.length > 0);
  assert.ok(found.matches[0].excerpt.includes("live_fetch"));

  await assert.rejects(
    elixirTools.elixir_docs.handler(ctx, { page: "nope" }),
    (e) => e.code === "not_found" && /quickstart/.test(e.hint),
  );
});

test("elixir_examples: eleven, each with a real transcript and real tools", async () => {
  const index = await elixirTools.elixir_examples.handler(ctx, {});
  assert.equal(index.examples.length, 11);
  const one = await elixirTools.elixir_examples.handler(ctx, {
    example: "clan",
  });
  assert.equal(one.group, "For clan leaders");
  assert.ok(one.transcript.length >= 2);
  assert.ok(one.tools.includes("war_current"));
  assert.ok(one.setup.length >= 2);
  await assert.rejects(
    elixirTools.elixir_examples.handler(ctx, { example: "zzz" }),
    (e) => e.code === "not_found",
  );
});

test("elixir_updates: newest first, since a date, bounded", async () => {
  const recent = await elixirTools.elixir_updates.handler(ctx, { limit: 3 });
  assert.equal(recent.entries.length, 3);
  assert.ok(recent.entries[0].date >= recent.entries[2].date);
  const since = await elixirTools.elixir_updates.handler(ctx, {
    since: "2026-09-09",
    limit: 50,
  });
  assert.ok(since.entries.every((u) => u.date >= "2026-09-09"));
  assert.equal(since.total, since.entries.length);
  await assert.rejects(
    elixirTools.elixir_updates.handler(ctx, { since: "yesterday" }),
    (e) => e.code === "bad_request",
  );
});
