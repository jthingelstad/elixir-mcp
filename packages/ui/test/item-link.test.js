import { test, expect } from "vitest";
import {
  memberItemPath,
  readMemberItemPath,
  timelineItemRef,
} from "../src/item-link.mjs";

const ID = "tl_0123456789abcdef0041";
const ref = {
  item_id: ID,
  kind: "badge_earned",
  source: "game",
  subject: { kind: "player", tag: "#0PGQ2UYL" },
  at: "2026-11-18T12:00:00.000Z",
};
test("an exact member path preserves the source and reply without submitted words or facts", () => {
  const path = memberItemPath(
    { ...ref, words: "Private words", facts: { private: true } },
    { commentId: "42", after: "all" },
  );
  const url = new URL(path, "https://elixir.test");
  expect(url.pathname).toBe(`/home/item/${ID}`);
  expect(path).not.toContain("Private");
  const search = Object.fromEntries(url.searchParams);
  expect(readMemberItemPath(ID, search)).toEqual({
    ref,
    entry: { reply: "42", after: "all" },
  });
  expect(
    readMemberItemPath(ID, { ...search, ref: JSON.parse(search.ref) }),
  ).toEqual(readMemberItemPath(ID, search));
  expect(readMemberItemPath("tl_0123456789abcdef0042", search)).toBeNull();
  expect(readMemberItemPath(ID, { ref: "{broken" })).toBeNull();
  expect(memberItemPath({ ...ref, source: "account" })).toBeNull();
});
test("canonical posts and People retain their actual source identity", () => {
  for (const item of [
    { id: ID, kind: "post", at: ref.at, post: { id: "41" } },
    {
      id: ID,
      kind: "stamp_earned",
      section: "people",
      at: ref.at,
      facts: { account_id: "abcd1234efgh" },
    },
  ]) {
    const link = memberItemPath(timelineItemRef(item));
    expect(link).toMatch(/^\/home\/item\/tl_/);
    expect(link).not.toContain("undefined");
  }
  expect(timelineItemRef({ id: ID, section: "account" })).toBeNull();
});
