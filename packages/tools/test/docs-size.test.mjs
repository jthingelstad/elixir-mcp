/**
 * Every docs page fits one elixir_docs result. The timeline page grew
 * past the 48,000-character cap on 2026-10-11 (two changes, each under
 * it alone), and the deploy's acceptance was the first to see it: four
 * cases read `result_too_large`. The served result adds the response
 * meta (about 250 characters) to the handler's body, so a page must leave
 * MARGIN: a page near it is trimmed, or split, in the change that grows
 * it, never at deploy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { elixirTools } from "../src/tools/elixir.mjs";
import { MCP_RESULT_MAX_CHARS } from "../src/result-text.mjs";

const MARGIN = 500;
const ctx = { account: {}, db: null };

test("every docs page fits one elixir_docs result, with room for the meta", async () => {
  const index = await elixirTools.elixir_docs.handler(ctx, {});
  assert.ok(index.pages.length > 10, "the corpus lists its pages");
  const over = [];
  let largest = 0;
  for (const { slug } of index.pages) {
    const body = await elixirTools.elixir_docs.handler(ctx, { page: slug });
    assert.equal(typeof body.markdown, "string", `${slug} reads whole`);
    const size = JSON.stringify(body).length;
    largest = Math.max(largest, size);
    if (size > MCP_RESULT_MAX_CHARS - MARGIN) over.push(`${slug}: ${size}`);
  }
  assert.ok(largest > 40_000, "the long pages were measured");
  assert.deepEqual(
    over,
    [],
    `over ${MCP_RESULT_MAX_CHARS - MARGIN} characters`,
  );
});
