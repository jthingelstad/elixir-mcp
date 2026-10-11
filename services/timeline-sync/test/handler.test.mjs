/** The timeline sync's queue: one sync per wake object, the object
 *  deleted once run, a failed run retried, anything else refused. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "../src/handler.mjs";

const ACCOUNT = "0b6b5a59-0e4f-4f39-9d55-58e41b6a3e7a";

function setup({ objects, sync }) {
  const deleted = [];
  let connects = 0;
  let ended = 0;
  const handler = makeHandler({
    connect: async () => {
      connects += 1;
      return { end: async () => (ended += 1) };
    },
    sync,
    readObject: async (obj) => objects.get(obj.key) ?? null,
    deleteObject: async (obj) => {
      deleted.push(obj.key);
      objects.delete(obj.key);
    },
  });
  return { handler, deleted, counts: () => ({ connects, ended }) };
}

const record = (messageId, key) => ({
  messageId,
  body: JSON.stringify({
    Records: [
      { eventSource: "aws:s3", s3: { bucket: { name: "b" }, object: { key } } },
    ],
  }),
});

test("a wake runs the account's sync and deletes its object; a gone object is done", async () => {
  const synced = [];
  const key = `timeline-sync/${ACCOUNT}.29340000.json`;
  const s = setup({
    objects: new Map([[key, JSON.stringify({ v: 1, account_id: ACCOUNT })]]),
    sync: async (_db, id) => {
      synced.push(id);
      return { posted: 2 };
    },
  });
  const log = console.log;
  console.log = () => {};
  try {
    const out = await s.handler({
      Records: [record("a", key), record("b", key)],
    });
    assert.deepEqual(out, { batchItemFailures: [] });
  } finally {
    console.log = log;
  }
  assert.deepEqual(synced, [ACCOUNT]);
  assert.deepEqual(s.deleted, [key]);
  assert.deepEqual(s.counts(), { connects: 1, ended: 1 });
});

test("a failed sync keeps its object and retries; a malformed wake is refused", async () => {
  const key = `timeline-sync/${ACCOUNT}.1.json`;
  const bad = "timeline-sync/bad.json";
  const s = setup({
    objects: new Map([
      [key, JSON.stringify({ v: 1, account_id: ACCOUNT })],
      [bad, JSON.stringify({ v: 1, account_id: "x" })],
    ]),
    sync: async () => {
      throw Object.assign(new Error("db"), { code: "57014" });
    },
  });
  const error = console.error;
  console.error = () => {};
  try {
    const out = await s.handler({
      Records: [
        record("a", key),
        record("b", bad),
        record("c", "discord/x.json"),
        { messageId: "d", body: "nope" },
      ],
    });
    assert.deepEqual(
      out.batchItemFailures.map((f) => f.itemIdentifier),
      ["a", "b", "c", "d"],
    );
  } finally {
    console.error = error;
  }
  assert.deepEqual(s.deleted, []);
});

test("a clan's wake runs its activity sync; one without the time for the model waits for a later delivery", async () => {
  const key = "timeline-sync/clan-J2RGCRVG.29340000.json";
  const synced = [];
  const objects = () =>
    new Map([[key, JSON.stringify({ v: 1, clan_tag: "#J2RGCRVG" })]]);
  const deleted = [];
  const make = (map) =>
    makeHandler({
      connect: async () => ({ end: async () => {} }),
      sync: async () => assert.fail("not an account's wake"),
      syncClan: async (_db, tag, { remainingMs }) => {
        synced.push([tag, remainingMs()]);
        return { posted: 1 };
      },
      readObject: async (obj) => map.get(obj.key) ?? null,
      deleteObject: async (obj) => deleted.push(obj.key),
    });
  const log = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a[0]);
  try {
    const short = await make(objects())(
      { Records: [record("a", key)] },
      { getRemainingTimeInMillis: () => 30_000 },
    );
    assert.deepEqual(short.batchItemFailures, [{ itemIdentifier: "a" }]);
    assert.deepEqual(synced, []);
    assert.deepEqual(deleted, [], "its wake stays for the next delivery");
    assert.ok(lines.includes("clan_activity_later"));

    const out = await make(objects())(
      { Records: [record("b", key)] },
      { getRemainingTimeInMillis: () => 55_000 },
    );
    assert.deepEqual(out.batchItemFailures, []);
    assert.deepEqual(synced, [["#J2RGCRVG", 55_000]]);
    assert.deepEqual(deleted, [key]);
  } finally {
    console.log = log;
  }
});

test("a clan's wake with a tag that is not one, or with no clan sync, is refused", async () => {
  const key = "timeline-sync/clan-x.1.json";
  const error = console.error;
  console.error = () => {};
  try {
    for (const [tag, syncClan] of [
      ["J2RGCRVG", async () => ({})],
      ["#J2RGCRVG", null],
    ]) {
      const handler = makeHandler({
        connect: async () => ({ end: async () => {} }),
        sync: async () => ({}),
        syncClan,
        readObject: async () => JSON.stringify({ v: 1, clan_tag: tag }),
        deleteObject: async () => assert.fail("never deleted"),
      });
      const out = await handler({ Records: [record("a", key)] });
      assert.deepEqual(out.batchItemFailures, [{ itemIdentifier: "a" }]);
    }
  } finally {
    console.error = error;
  }
});

test("a clan's Discord wake shares its Actions and deletes its object; a bad tag or no sharer is refused", async () => {
  const key = "timeline-sync/clan-discord-J2RGCRVG.29340000.json";
  const shared = [];
  const deleted = [];
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    const make = (tag, shareClanDiscord) =>
      makeHandler({
        connect: async () => ({ end: async () => {} }),
        sync: async () => assert.fail("not an account's wake"),
        syncClan: async () => assert.fail("not the activity channel"),
        shareClanDiscord,
        readObject: async () => JSON.stringify({ v: 1, clan_discord: tag }),
        deleteObject: async (obj) => deleted.push(obj.key),
      });
    const share = async (_db, tag) => {
      shared.push(tag);
      return { shared: 2 };
    };
    const out = await make(
      "#J2RGCRVG",
      share,
    )({
      Records: [record("a", key)],
    });
    assert.deepEqual(out.batchItemFailures, []);
    assert.deepEqual(shared, ["#J2RGCRVG"]);
    assert.deepEqual(deleted, [key]);
    for (const [tag, fn] of [
      ["J2RGCRVG", share],
      ["#J2RGCRVG", null],
    ]) {
      const bad = await make(tag, fn)({ Records: [record("b", key)] });
      assert.deepEqual(bad.batchItemFailures, [{ itemIdentifier: "b" }]);
    }
    assert.equal(shared.length, 1);
  } finally {
    console.log = log;
    console.error = error;
  }
});

test("a clan's held stories come back on the hold queue to the same run; only a clan's wake is read there", async () => {
  const key = "timeline-hold/clan-J2RGCRVG.29340005.json";
  const account = `timeline-hold/${ACCOUNT}.29340005.json`;
  const synced = [];
  const deleted = [];
  const objects = new Map([
    [key, JSON.stringify({ v: 1, clan_tag: "#J2RGCRVG" })],
    [account, JSON.stringify({ v: 1, account_id: ACCOUNT })],
  ]);
  const handler = makeHandler({
    connect: async () => ({ end: async () => {} }),
    sync: async () => assert.fail("an account is never held"),
    syncClan: async (_db, tag) => {
      synced.push(tag);
      return { posted: 1 };
    },
    readObject: async (obj) => objects.get(obj.key) ?? null,
    deleteObject: async (obj) => deleted.push(obj.key),
  });
  const log = console.log;
  console.log = () => {};
  try {
    const out = await handler(
      { Records: [record("a", key), record("b", account)] },
      { getRemainingTimeInMillis: () => 55_000 },
    );
    assert.deepEqual(out.batchItemFailures, [{ itemIdentifier: "b" }]);
  } finally {
    console.log = log;
  }
  assert.deepEqual(synced, ["#J2RGCRVG"]);
  assert.deepEqual(deleted, [key]);
});

test("a clan whose model edits runs on the editor's queue, told so, and only with a round's room left", async () => {
  const key = "timeline-editor/clan-J2RGCRVG.29340005.json";
  const sync = "timeline-sync/clan-J2RGCRVG.29340006.json";
  const account = `timeline-editor/${ACCOUNT}.29340005.json`;
  const runs = [];
  const objects = new Map([
    [key, JSON.stringify({ v: 1, clan_tag: "#J2RGCRVG" })],
    [sync, JSON.stringify({ v: 1, clan_tag: "#J2RGCRVG" })],
    [account, JSON.stringify({ v: 1, account_id: ACCOUNT })],
  ]);
  const handler = makeHandler({
    connect: async () => ({ end: async () => {} }),
    sync: async () => assert.fail("an account never runs as an editor"),
    syncClan: async (_db, tag, opts) => {
      runs.push([tag, opts.editor]);
      return { posted: 1 };
    },
    readObject: async (obj) => objects.get(obj.key) ?? null,
    deleteObject: async (obj) => objects.delete(obj.key),
  });
  const log = console.log;
  console.log = () => {};
  try {
    // 50 s left: enough for a sync's clan run, not for an editor's.
    const short = await handler(
      { Records: [record("a", key), record("b", sync)] },
      { getRemainingTimeInMillis: () => 50_000 },
    );
    assert.deepEqual(short.batchItemFailures, [{ itemIdentifier: "a" }]);
    const out = await handler(
      { Records: [record("a", key), record("c", account)] },
      { getRemainingTimeInMillis: () => 170_000 },
    );
    assert.deepEqual(out.batchItemFailures, [{ itemIdentifier: "c" }]);
  } finally {
    console.log = log;
  }
  assert.deepEqual(runs, [
    ["#J2RGCRVG", false],
    ["#J2RGCRVG", true],
  ]);
});
