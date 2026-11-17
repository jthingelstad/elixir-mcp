import { test } from "node:test";
import assert from "node:assert/strict";
import { memberPostPath, memberPostUrl } from "../src/index.mjs";
import { memberPostUrl as browserPostUrl } from "../src/paths.mjs";

test("a post's member destination names its id and never a share token", () => {
  assert.equal(memberPostPath("42"), "/home/post/42");
  assert.equal(
    browserPostUrl("42"),
    "https://elixir.poapkings.com/home/post/42",
  );
  assert.equal(memberPostUrl(42), "https://elixir.poapkings.com/home/post/42");
  assert.equal(
    memberPostPath("9223372036854775807"),
    "/home/post/9223372036854775807",
  );
  for (const value of [
    null,
    "",
    "0",
    "01",
    "-1",
    "1.1",
    "abc",
    "42?share=1",
    "9223372036854775808",
    "1e3",
  ])
    assert.equal(memberPostUrl(value), null, String(value));
});
