import { test } from "node:test";
import assert from "node:assert/strict";
import { DOCS, EXAMPLES, UPDATES, searchDocs } from "./src/index.mjs";

test("the corpus carries every docs page, all eleven examples and the updates", () => {
  assert.ok(DOCS.length >= 16, `only ${DOCS.length} docs pages`);
  assert.ok(DOCS.every((d) => d.slug && d.title && d.markdown.length > 100));
  assert.equal(EXAMPLES.length, 11);
  assert.ok(
    EXAMPLES.every((e) => e.transcript.length >= 2 && e.tools.length >= 1),
  );
  assert.ok(UPDATES.length > 10);
  assert.ok(UPDATES.every((u) => /^\d{4}-\d{2}-\d{2}$/.test(u.date)));
});

test("search finds a page by a word in its body and says where", () => {
  const hits = searchDocs("comprehensive");
  assert.ok(hits.length > 0);
  assert.ok(hits[0].excerpt.toLowerCase().includes("comprehensive"));
  assert.deepEqual(searchDocs(""), []);
});
