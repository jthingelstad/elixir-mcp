import test from "node:test";
import assert from "node:assert/strict";
import { sharePath, shareUrl } from "../src/paths.mjs";

test("a shared item has one opaque destination, with no direct record or account address", () => {
  const id = "abcdefghijklmnopqrstuvwx";
  assert.equal(sharePath(id), `/share/${id}`);
  assert.equal(shareUrl(id), `https://elixir.poapkings.com/share/${id}`);
  for (const value of [
    null,
    "",
    id.toUpperCase(),
    "a".repeat(23),
    "a".repeat(25),
    `${id}?x=1`,
    `${id}/more`,
    "tl_0123456789abcdef0123",
    "0".repeat(24),
  ])
    assert.equal(shareUrl(value), null, String(value));
});
