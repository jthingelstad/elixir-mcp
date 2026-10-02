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
    await ctx.db.query("insert into player(player_tag) values('#P8LQ0')");
    await ctx.db.query(
      "insert into battle(battle_id,battle_time,type,type_class,created_at) values('retained-game','2026-01-01','riverRaceDuel','pvp','2026-01-01'),('future-game','2026-10-03','PvP','pvp','2026-10-03')",
    );
    await ctx.db.query(
      "insert into battle_participant(battle_id,player_tag,side,battle_time,type_class,type) values('retained-game','#P0LYQ',0,'2026-01-01','pvp','riverRaceDuel'),('retained-game','#P8LQ0',1,'2026-01-01','pvp','riverRaceDuel')",
    );
    await ctx.db.query(
      "insert into card(card_id,name,kind,rarity,max_level) values(26000000,'Knight','card','common',14)",
    );
    await ctx.db.query(
      "insert into battle_participant_card(battle_id,player_tag,round,card_id,slot) values('retained-game','#P0LYQ',1,26000000,0),('retained-game','#P8LQ0',1,26000000,0)",
    );
    await ctx.db.query(
      "insert into battle_participant_round(battle_id,player_tag,round) values('retained-game','#P0LYQ',1),('retained-game','#P8LQ0',1),('retained-game','#P8LQ0',2)",
    );
    await ctx.db.query(
      "insert into battle_participant(battle_id,player_tag,side,battle_time,type_class,type) values('future-game','#P8LQ0',0,'2026-10-03','pvp','PvP')",
    );
    const participants = await rightSizingCensus(
      ctx.url,
      spec("battle_participant", { limit: 100 }),
      settings,
    );
    assert.equal(participants.rows, 2);
    assert.equal(participants.cutoff_policy, "parent_created_at:battle");
    const group = (
      await ctx.db.query(
        "insert into collection(slug,title,kind,owner_account,created_at) values('private-group','Private','player',$1,'2026-01-01') returning collection_id",
        [a.account_id],
      )
    ).rows[0];
    await ctx.db.query(
      "insert into collection_member(collection_id,subject_tag,added_at) values($1,'#P0LYQ','2026-01-01'),($1,'#P8LQ0','2026-10-03')",
      [group.collection_id],
    );
    const members = await rightSizingCensus(
      ctx.url,
      spec("collection_member", { limit: 100 }),
      settings,
    );
    assert.equal(members.rows, 1);
    assert.equal(members.cutoff_policy, "timestamptz:added_at");
    await ctx.db.query(
      "insert into account_event(account_id,kind,detail,created_at) values($1,'tracked_by_ops',$2,'2026-01-01'),($1,'enrolled',$2,'2026-01-01')",
      [
        a.account_id,
        {
          player_tag: "#P0LYQ",
          source: "deliberate approved request",
          relationship: "friend",
          email: "never-export",
        },
      ],
    );
    const dependencies = await rightSizingCensus(
      ctx.url,
      spec("battle_dependency_counts"),
      settings,
    );
    assert.equal(dependencies.rows, 1);
    assert.deepEqual(JSON.parse(objects.get(dependencies.key)).rows, [
      {
        battle_id: "retained-game",
        participants: "2",
        cards: "2",
        rounds: "3",
      },
    ]);
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
      spec("account_event", { limit: 100 }),
      settings,
    );
    assert.equal(events.rows, 3);
    const eventBody = objects.get(events.key).toString();
    assert.ok(eventBody.includes("recording_started"));
    assert.ok(!eventBody.includes("never-export"));
    const intent = await rightSizingCensus(
      ctx.url,
      spec("account_event", { limit: 100 }),
      settings,
    );
    const intentRows = JSON.parse(objects.get(intent.key)).rows;
    assert.equal(intentRows.length, 3);
    assert.equal(
      intentRows.find((r) => r.kind === "enrolled").detail.source,
      "deliberate approved request",
    );
    assert.equal(
      intentRows.find((r) => r.kind === "tracked_by_ops").detail.relationship,
      "friend",
    );
    assert.ok(!objects.get(intent.key).toString().includes("never-export"));
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
    const catalog = await rightSizingCensus(ctx.url, { catalog: true });
    assert.equal(catalog.readonly, true);
    assert.ok(
      catalog.foreign_keys.some(
        (k) => k.child_table === "player_event" && k.parent_table === "battle",
      ),
    );
    assert.deepEqual(
      catalog.primary_keys.find(
        (k) => k.table_name === "battle_participant_card",
      ).columns,
      ["battle_id", "player_tag", "round", "card_id", "form"],
    );
    const pinned = await rightSizingCensus(
      ctx.url,
      spec("claim", { schema_sha256: catalog.schema_sha256 }),
      settings,
    );
    assert.equal(pinned.schema_sha256, catalog.schema_sha256);
    await ctx.db.query(
      "alter table claim add column census_test_column integer",
    );
    await assert.rejects(
      rightSizingCensus(
        ctx.url,
        spec("claim", { schema_sha256: catalog.schema_sha256 }),
        settings,
      ),
      /schema changed/,
    );
    await ctx.db.query("alter table claim drop column census_test_column");
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
    { catalog: false },
    { ...spec("recording"), catalog: true },
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

test("admission census uses a fixed receipt ceiling and includes late admissions with older or newer fetch stamps", async () => {
  const ctx = await scratchDb("rightadmission"),
    { objects, s3 } = storage();
  try {
    const { seedReceipt } =
      await import("../../../packages/ingest/test/helpers.mjs");
    const id = await seedReceipt(ctx.db, { entityKey: "#P0LYQ" });
    await ctx.db.query(
      "update api_receipt set fetched_at='2026-10-03' where receipt_id=$1",
      [id],
    );
    const id2 = (
      await ctx.db.query(
        "insert into api_receipt(endpoint,entity_key,payload_hash,gateway_id,admission,fetched_at) select endpoint,entity_key,payload_hash,gateway_id,admission,'2026-01-01' from api_receipt where receipt_id=$1 returning receipt_id",
        [id],
      )
    ).rows[0].receipt_id;
    const s = {
      group: "admissions",
      export: {
        lane: "api_receipt",
        snapshot_id,
        cutoff,
        limit: 1,
        receipt_high_water: String(id2),
      },
    };
    const one = await rightSizingCensus(ctx.url, s, { bucket: "private", s3 });
    assert.equal(one.rows, 1);
    assert.equal(one.cutoff_policy, "admission_receipt_ceiling");
    assert.equal(
      JSON.parse(objects.get(one.key)).rows[0].receipt_id,
      String(id),
    );
    await assert.rejects(
      rightSizingCensus(
        ctx.url,
        {
          ...s,
          export: {
            ...s.export,
            receipt_high_water: String(id),
            after: one.next_after,
          },
        },
        { bucket: "private", s3 },
      ),
      /another snapshot/,
    );
    const two = await rightSizingCensus(
      ctx.url,
      { ...s, export: { ...s.export, after: one.next_after } },
      { bucket: "private", s3 },
    );
    assert.equal(two.rows, 1);
    assert.equal(two.done, true);
    assert.equal(
      JSON.parse(objects.get(two.key)).rows[0].receipt_id,
      String(id2),
    );
    await assert.rejects(
      rightSizingCensus(
        "must-not-connect",
        { ...s, export: { ...s.export, receipt_high_water: undefined } },
        { bucket: "private", s3 },
      ),
      /receipt ceiling/,
    );
  } finally {
    await ctx.drop();
  }
});
