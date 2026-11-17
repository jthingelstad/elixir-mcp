import test from "node:test";
import assert from "node:assert/strict";
import { ensureShare, mintShareId, readShare } from "../src/index.mjs";
import { SHARE_ID } from "../src/paths.mjs";

const ID = "tl_0123456789abcdef0123";
const TOKEN = "abcdefghijklmnopqrstuvwx";
const target = {
  itemId: ID,
  kind: "badge_earned",
  source: "game",
  subjectKind: "player",
  subjectTag: "#0QU8VGV",
  anchorAt: "2026-11-17T12:00:00.000Z",
};

test("share capabilities are 24 base32 characters, including the random default and deterministic byte edges", () => {
  assert.match(mintShareId(), SHARE_ID);
  assert.equal(mintShareId(new Uint8Array(24)), "a".repeat(24));
  assert.equal(mintShareId(new Uint8Array(24).fill(255)), "7".repeat(24));
  assert.equal(
    new Set(Array.from({ length: 64 }, () => mintShareId())).size,
    64,
  );
});

test("invalid item ids fail before storage", async () => {
  const db = {
    query: () => assert.fail("invalid capability target queried storage"),
  };
  for (const itemId of [null, "", "tl_short", `${ID}/more`, ID.toUpperCase()])
    await assert.rejects(
      ensureShare(db, { ...target, itemId }),
      /invalid shared item/,
    );
});

test("concurrent sharers get the storage's one stable item capability, without storing a sender or snapshot", async () => {
  const stored = new Map();
  const calls = [];
  const db = {
    async query(sql, params) {
      assert.match(sql, /on conflict\s*\(item_id\)\s*do update/i);
      assert.match(sql, /returning share_id/i);
      calls.push(params);
      const [minted, itemId] = params;
      assert.match(minted, SHARE_ID);
      if (!stored.has(itemId)) stored.set(itemId, minted);
      return { rows: [{ share_id: stored.get(itemId) }] };
    },
  };
  const results = await Promise.all(
    Array.from({ length: 24 }, () =>
      ensureShare(db, {
        ...target,
        accountId: "private-account",
        rendered: { text: "private-snapshot" },
      }),
    ),
  );
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
  assert.equal(new Set(results.map((r) => r.url)).size, 1);
  assert.equal(calls.length, 24);
  assert.ok(!JSON.stringify(calls).includes("private-"));
  assert.deepEqual(calls[0].slice(1), [
    ID,
    "badge_earned",
    "game",
    "player",
    "#0QU8VGV",
    null,
    null,
    null,
    target.anchorAt,
  ]);
});

test("random-id collisions retry but storage failures and exhausted retries surface", async () => {
  let calls = 0;
  const collision = Object.assign(new Error("collision"), { code: "23505" });
  const db = {
    async query() {
      if (++calls === 1) throw collision;
      return { rows: [{ share_id: TOKEN }] };
    },
  };
  assert.deepEqual(await ensureShare(db, target), {
    id: TOKEN,
    url: `https://elixir.poapkings.com/share/${TOKEN}`,
  });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    ensureShare(
      {
        query: async () => {
          calls++;
          throw collision;
        },
      },
      target,
    ),
    (e) => e === collision,
  );
  assert.equal(calls, 3);
  const unavailable = Object.assign(new Error("unavailable"), {
    code: "08006",
  });
  calls = 0;
  await assert.rejects(
    ensureShare(
      {
        query: async () => {
          calls++;
          throw unavailable;
        },
      },
      target,
    ),
    (e) => e === unavailable,
  );
  assert.equal(calls, 1);
});

test("a capability read rejects malformed ids without querying and bounds retained links in storage", async () => {
  let calls = 0;
  const row = {
    share_id: TOKEN,
    item_id: ID,
    source: "game",
    anchor_at: new Date(target.anchorAt),
  };
  const db = {
    async query(sql, params) {
      calls++;
      assert.deepEqual(params, [TOKEN]);
      assert.match(sql, /created_at\s*>=\s*now\(\)\s*-\s*interval '1 year'/);
      return { rows: [row] };
    },
  };
  for (const id of [
    null,
    "",
    TOKEN.toUpperCase(),
    "a".repeat(23),
    "a".repeat(25),
    TOKEN.replace("a", "0"),
    `${TOKEN}/more`,
  ])
    assert.equal(await readShare(db, id), null, String(id));
  assert.equal(calls, 0);
  assert.equal(await readShare(db, TOKEN), row);
  assert.equal(calls, 1);
  assert.equal(
    await readShare({ query: async () => ({ rows: [] }) }, TOKEN),
    null,
  );
});
