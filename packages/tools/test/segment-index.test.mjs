import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentFilter } from "../src/tools/shared.mjs";

test("corpus, missing and empty selectors refuse before a database read", async () => {
  const ctx = {
    db: {
      query() {
        throw Error("unexpected database read");
      },
    },
  };
  for (const segment of [
    "corpus",
    {},
    undefined,
    { player_tag: "#20JJJ2CCRU", clan_tag: "#J2RGCRVG" },
  ])
    await assert.rejects(
      segmentFilter(ctx, { segment }, []),
      (e) => e.code === "bad_request",
    );
});

test("a retired Collection selector refuses before any population query", async () => {
  await assert.rejects(
    segmentFilter(
      {
        db: {
          query() {
            throw new Error("unexpected database read");
          },
        },
      },
      { segment: { collection: "pros" } },
      [],
    ),
    (error) => error.code === "bad_request",
  );
});
