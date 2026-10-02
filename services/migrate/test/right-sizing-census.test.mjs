import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { rightSizingCensus } from "../src/ops-right-sizing.mjs";
const snapshot_id = "00000000-0000-0000-0000-000000000001";
const cutoff = "2026-10-02T00:00:00.000Z";
const spec = (lane, rest = {}) => ({
  export: { lane, snapshot_id, cutoff, limit: 1, ...rest },
});
function storage() {
  const objects = new Map();
  return {
    objects,
    s3: {
      async send(command) {
        const x = command.input;
        if (command.constructor.name === "GetObjectCommand")
          return {
            ContentLength: objects.get(x.Key).length,
            Body: { transformToByteArray: async () => objects.get(x.Key) },
          };
        assert.equal(x.ServerSideEncryption, "AES256");
        assert.equal(x.IfNoneMatch, "*");
        if (objects.has(x.Key))
          throw Object.assign(new Error("exists"), {
            $metadata: { httpStatusCode: 412 },
          });
        objects.set(x.Key, Buffer.from(x.Body));
        return {};
      },
    },
  };
}
test("private census pages preserve composite timestamp keys, historical requests, privacy and retry integrity", async () => {
  const ctx = await scratchDb("rightsizing");
  const { s3, objects } = storage();
  const settings = { bucket: "private", s3 };
  try {
    const a = (
      await ctx.db.query(
        "insert into account(email_hash,status,created_at) values('private-email-hash','approved','2026-01-01') returning account_id",
      )
    ).rows[0];
    await ctx.db.query("insert into player(player_tag) values('#P0LYQ')");
    await ctx.db.query("insert into clan(clan_tag) values('#P2LQ0')");
    await ctx.db.query(
      "insert into clan_membership(clan_tag,player_tag,joined_observed_at,left_observed_at) values('#P2LQ0','#P0LYQ','2026-01-01 00:00:00.000001Z','2026-01-02'),('#P2LQ0','#P0LYQ','2026-01-01 00:00:00.000002Z','2026-01-03')",
    );
    const first = await rightSizingCensus(
      ctx.url,
      spec("clan_membership"),
      settings,
    );
    const second = await rightSizingCensus(
      ctx.url,
      spec("clan_membership", { after: first.next_after }),
      settings,
    );
    assert.equal(first.rows, 1);
    assert.equal(second.rows, 1);
    assert.equal(second.done, true);
    const body1 = JSON.parse(objects.get(first.key)),
      body2 = JSON.parse(objects.get(second.key));
    assert.match(body1.rows[0].joined_observed_at, /000001/);
    assert.match(body2.rows[0].joined_observed_at, /000002/);
    assert.equal(JSON.stringify(first).includes("#P0LYQ"), false);
    assert.deepEqual(
      await rightSizingCensus(ctx.url, spec("clan_membership"), settings),
      first,
    );
    objects.set(first.key, Buffer.from("wrong"));
    await assert.rejects(
      rightSizingCensus(ctx.url, spec("clan_membership"), settings),
      /differs from its digest/,
    );
    await ctx.db.query(
      "insert into account_event(account_id,kind,detail,created_at) values($1,'recording_started',$2,'2026-01-01'),($1,'signed_in',$2,'2026-01-01'),($1,'claim_added',$2,'2026-10-03')",
      [
        a.account_id,
        {
          player_tag: "#P0LYQ",
          email: "never-export",
          token_hash: "never-export",
        },
      ],
    );
    const events = await rightSizingCensus(
      ctx.url,
      spec("account_event"),
      settings,
    );
    assert.equal(events.rows, 1);
    const eventBody = objects.get(events.key).toString();
    assert.ok(eventBody.includes("recording_started"));
    assert.ok(!eventBody.includes("never-export"));
    const accounts = await rightSizingCensus(
      ctx.url,
      spec("account"),
      settings,
    );
    assert.ok(
      !objects.get(accounts.key).toString().includes("private-email-hash"),
    );
    await assert.rejects(
      rightSizingCensus(
        ctx.url,
        spec("clan_membership", {
          after: first.next_after,
          snapshot_id: "00000000-0000-0000-0000-000000000002",
        }),
        settings,
      ),
      /another snapshot/,
    );
    const lanes = (await rightSizingCensus(null)).lanes;
    for (const lane of lanes) {
      const page = await rightSizingCensus(
        ctx.url,
        spec(lane, { limit: 2 }),
        settings,
      );
      assert.ok(page.readonly);
      assert.match(page.sha256, /^[a-f0-9]{64}$/);
      assert.equal(
        createHash("sha256").update(objects.get(page.key)).digest("hex"),
        page.sha256,
      );
    }
    assert.equal(
      (await ctx.db.query("select count(*)::int as n from clan_membership"))
        .rows[0].n,
      2,
    );
  } finally {
    await ctx.drop();
  }
});
test("census refuses arbitrary tables, credentials, unsafe bounds and deletion before database access", async () => {
  for (const value of [
    { apply: true },
    { delete: false },
    spec("service_token"),
    spec("clan_state"),
    spec("recording", { limit: 0 }),
    spec("recording", { limit: 10001 }),
    spec("recording", { cutoff: "invalid" }),
    spec("recording", { cutoff: "2999-01-01T00:00:00.000Z" }),
    spec("recording", { after: "{}" }),
  ])
    await assert.rejects(rightSizingCensus("invalid://never-connect", value));
  assert.equal(
    (await rightSizingCensus("invalid://never-connect", {})).readonly,
    true,
  );
});
