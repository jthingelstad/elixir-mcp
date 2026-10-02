import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import {
  scratchDb,
  seedReceipt,
} from "../../../packages/ingest/test/helpers.mjs";
import {
  ingestBattlelog,
  canonicalBattleIdentity,
} from "../../../packages/ingest/src/battles.mjs";
import { refreshDailyRollups } from "../../../packages/ingest/src/rollups.mjs";
import { payloadHash } from "../../../packages/ingest/src/hash.mjs";
import { schemaFingerprint } from "../src/fingerprint.mjs";
import { rightSizingPurge } from "../src/ops-right-sizing-purge.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex");

test("purge batches refuse changed reasons and approval/hash/scope errors; atomic retries keep shared battles and recompute rollups", async () => {
  const ctx = await scratchDb("rightpurge"),
    objects = new Map();
  const deps = {
    bucket: "private",
    s3: {
      async send(command) {
        if (command.constructor.name === "ListObjectsV2Command")
          return {
            IsTruncated: false,
            Contents: [...objects.keys()]
              .filter((k) => k.startsWith(command.input.Prefix))
              .map((Key) => ({ Key })),
          };
        const bytes = objects.get(command.input.Key);
        if (!bytes) throw Error("not staged");
        return {
          ContentLength: bytes.length,
          Body: { transformToByteArray: async () => bytes },
        };
      },
    },
  };
  const cutoff = "2026-10-02T20:19:00.000Z";
  const make = async (batch, extra = {}) => {
    const bytes = Buffer.from(JSON.stringify(batch)),
      batch_sha256 = sha(bytes);
    objects.set(`right-sizing/v1/purge/batches/${batch_sha256}.json`, bytes);
    const g = await rightSizingPurge(
      ctx.url,
      { guard: true, guard_clans: [] },
      deps,
    );
    const root = {
      version: 1,
      guard_clans: [],
      battle_guard_clans: [],
      receipt_high_water: g.receipt_high_water,
      guard_sha256: g.sha256,
      schema_sha256: g.schema_sha256,
      cutoff,
      batches: [batch_sha256],
      ...extra,
    };
    const rb = Buffer.from(JSON.stringify(root)),
      manifest_sha256 = sha(rb);
    objects.set(`right-sizing/v1/purge/${manifest_sha256}.json`, rb);
    return { manifest_sha256, batch_sha256 };
  };
  try {
    // A real migrated scratch schema pins the additive ladder.
    if (process.env.UPDATE_PURGE_FINGERPRINT === "1")
      await writeFile(
        new URL("../../../db/schema.fingerprint", import.meta.url),
        (await schemaFingerprint(ctx.url)) + "\n",
      );
    const entry = (t) => ({
      battleTime: `20261001T${t}.000Z`,
      type: "PvP",
      team: [{ tag: "#P0LYQ", cards: [] }],
      opponent: [{ tag: "#P2LQ0", cards: [] }],
    });
    const removed = entry("120000"),
      kept = entry("130000");
    await ctx.db.query("begin");
    await ingestBattlelog(ctx.db, {
      observerTag: "#P0LYQ",
      payload: [removed, kept],
    });
    await ctx.db.query("commit");
    const id = canonicalBattleIdentity(removed).battle_id,
      keepId = canonicalBattleIdentity(kept).battle_id;
    await ctx.db.query("update battle set created_at='2026-10-01'");
    await refreshDailyRollups(ctx.db, [
      { playerTag: "#P0LYQ", day: "2026-10-01" },
      { playerTag: "#P2LQ0", day: "2026-10-01" },
    ]);
    const batch = {
      version: 1,
      kind: "battle",
      keys: [{ battle_id: id }],
      events: [],
      dependencies: [
        { battle_id: id, participants: "2", cards: "0", rounds: "0" },
      ],
    };
    let spec = await make(batch);
    await assert.rejects(
      rightSizingPurge(ctx.url, { ...spec, apply: true }, deps),
      /approval required/,
    );
    assert.equal((await rightSizingPurge(ctx.url, spec, deps)).preview, true);
    assert.equal(
      (await ctx.db.query("select count(*)::int as n from battle")).rows[0].n,
      2,
    );
    const bad = await make({
      ...batch,
      dependencies: [
        { battle_id: id, participants: "9", cards: "0", rounds: "0" },
      ],
    });
    await assert.rejects(
      rightSizingPurge(
        ctx.url,
        { ...bad, apply: true, approved_manifest_sha256: bad.manifest_sha256 },
        deps,
      ),
      /dependencies changed/,
    );
    await ctx.db.query(
      "insert into account(kind,role,status,email_hash) values('person','member','approved','purge-test-account')",
    );
    await assert.rejects(
      rightSizingPurge(
        ctx.url,
        {
          ...spec,
          apply: true,
          approved_manifest_sha256: spec.manifest_sha256,
        },
        deps,
      ),
      /reasons changed/,
    );
    spec = await make(batch);
    await ctx.db.query(
      "create function stop_purge_test() returns trigger language plpgsql as $$begin raise exception 'interrupted scratch batch'; end$$;create trigger stop_purge before delete on battle for each row execute function stop_purge_test()",
    );
    await assert.rejects(
      rightSizingPurge(
        ctx.url,
        {
          ...spec,
          apply: true,
          approved_manifest_sha256: spec.manifest_sha256,
        },
        deps,
      ),
      /interrupted scratch batch/,
    );
    assert.equal(
      (await ctx.db.query("select count(*)::int as n from battle_participant"))
        .rows[0].n,
      4,
    );
    await ctx.db.query(
      "drop trigger stop_purge on battle;drop function stop_purge_test()",
    );
    const applied = await rightSizingPurge(
      ctx.url,
      { ...spec, apply: true, approved_manifest_sha256: spec.manifest_sha256 },
      deps,
    );
    assert.equal(applied.affected, 3);
    assert.equal(
      (await ctx.db.query("select battle_id from battle")).rows[0].battle_id,
      keepId,
    );
    assert.equal(
      (
        await ctx.db.query(
          "select sum(battles_captured)::int as n from player_daily_battle_rollup",
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      (
        await rightSizingPurge(
          ctx.url,
          {
            ...spec,
            apply: true,
            approved_manifest_sha256: spec.manifest_sha256,
          },
          deps,
        )
      ).affected,
      0,
    );
    const keptBatch = {
      ...batch,
      keys: [{ battle_id: keepId }],
      dependencies: [
        { battle_id: keepId, participants: "2", cards: "0", rounds: "0" },
      ],
    };
    const firstReceipt = await seedReceipt(ctx.db, { entityKey: "#P9LQ0" });
    const lateSpec = await make(keptBatch);
    const lateReceipt = (
      await ctx.db.query(
        "insert into api_receipt(endpoint,entity_key,fetched_at,payload_hash,gateway_id,admission) select endpoint,entity_key,'2026-10-01',payload_hash,gateway_id,admission from api_receipt where receipt_id=$1 returning receipt_id",
        [firstReceipt],
      )
    ).rows[0].receipt_id;
    await ctx.db.query(
      "update api_receipt set fetched_at='2026-10-02T20:18:00Z',payload_hash=$2 where receipt_id=$1",
      [lateReceipt, payloadHash([kept])],
    );
    await ctx.db.query(
      "insert into api_payload(endpoint,entity_key,payload_hash,payload_json,first_fetched_at) values('player_battlelog','#P9LQ0',$1,$2,'2026-10-02T20:20:00Z')",
      [payloadHash([kept]), JSON.stringify([kept])],
    );
    await assert.rejects(
      rightSizingPurge(
        ctx.url,
        {
          ...lateSpec,
          apply: true,
          approved_manifest_sha256: lateSpec.manifest_sha256,
        },
        deps,
      ),
      /newly admitted observer/,
    );
    await ctx.db.query(
      "update api_receipt set replay_retired_at=now() where receipt_id=$1",
      [lateReceipt],
    );
    const bulkEntry = entry("140000"),
      bulkId = canonicalBattleIdentity(bulkEntry).battle_id;
    await ctx.db.query("begin");
    await ingestBattlelog(ctx.db, {
      observerTag: "#P9LQ0",
      payload: [bulkEntry],
    });
    await ctx.db.query("commit");
    await ctx.db.query(
      "update battle set created_at='2026-10-01' where battle_id=$1",
      [bulkId],
    );
    const bulkBatch = {
        ...batch,
        keys: [{ battle_id: bulkId }],
        dependencies: [
          { battle_id: bulkId, participants: "2", cards: "0", rounds: "0" },
        ],
      },
      bulkSpec = await make(bulkBatch),
      bulkHash = payloadHash([bulkEntry]);
    await ctx.db.query(
      "insert into api_receipt(endpoint,entity_key,fetched_at,payload_hash,gateway_id,admission) select endpoint,entity_key,'2026-10-01', $2,gateway_id,admission from api_receipt where receipt_id=$1",
      [firstReceipt, bulkHash],
    );
    objects.set(
      `payloads/endpoint=player_battlelog/entity=P9LQ0/dt=2026-10-01/raw-${bulkHash.slice(0, 16)}.json.gz`,
      gzipSync(JSON.stringify([bulkEntry])),
    );
    await assert.rejects(
      rightSizingPurge(
        ctx.url,
        {
          ...bulkSpec,
          apply: true,
          approved_manifest_sha256: bulkSpec.manifest_sha256,
        },
        deps,
      ),
      /newly admitted observer/,
    );
    await ctx.db.query(
      "update api_receipt set replay_retired_at=now() where payload_hash=$1",
      [bulkHash],
    );
    await ctx.db.query("delete from battle_participant where battle_id=$1;", [
      bulkId,
    ]);
    await ctx.db.query("delete from battle where battle_id=$1", [bulkId]);
    await ctx.db.query(
      "insert into claim(account_id,player_tag) select account_id,'#P0LYQ' from account where email_hash='purge-test-account'",
    );
    const protectedSpec = await make(keptBatch);
    await assert.rejects(
      rightSizingPurge(
        ctx.url,
        {
          ...protectedSpec,
          apply: true,
          approved_manifest_sha256: protectedSpec.manifest_sha256,
        },
        deps,
      ),
      /overlaps retained/,
    );
    assert.equal(
      (await ctx.db.query("select count(*)::int as n from battle")).rows[0].n,
      1,
    );
    const forbidden = await make({
      version: 1,
      kind: "table",
      table: "account",
      keys: [{ account_id: "x" }],
    });
    await assert.rejects(
      rightSizingPurge(ctx.url, forbidden, deps),
      /not allowed/,
    );
    objects.set(
      `right-sizing/v1/purge/batches/${spec.batch_sha256}.json`,
      Buffer.from("tampered"),
    );
    await assert.rejects(
      rightSizingPurge(ctx.url, spec, deps),
      /digest differs/,
    );
  } finally {
    await ctx.drop();
  }
});

test("retired receipts cannot replay; mixed redirects need verified bodies and preserve original admission", async () => {
  const ctx = await scratchDb("rightreceipt"),
    objects = new Map();
  const deps = {
    bucket: "private",
    s3: {
      async send(c) {
        const bytes = objects.get(c.input.Key);
        if (!bytes) throw Error("not staged");
        return {
          ContentLength: bytes.length,
          Body: { transformToByteArray: async () => bytes },
        };
      },
    },
  };
  try {
    const original = "a".repeat(64),
      payload = [
        {
          battleTime: "20261001T120000.000Z",
          type: "PvP",
          team: [{ tag: "#P0LYQ", cards: [] }],
          opponent: [{ tag: "#P2LQ0", cards: [] }],
        },
      ];
    const receiptId = await seedReceipt(ctx.db, { entityKey: "#P0LYQ" });
    await ctx.db.query(
      "update api_receipt set payload_hash=$2,fetched_at='2026-10-01' where receipt_id=$1",
      [receiptId, original],
    );
    const r = { receipt_id: String(receiptId) };
    const replacement_hash = payloadHash(payload),
      bytes = gzipSync(JSON.stringify(payload)),
      key = `payloads/endpoint=player_battlelog/entity=P0LYQ/dt=2026-10-01/replay-${replacement_hash.slice(0, 16)}.json.gz`;
    const batch = {
        version: 1,
        kind: "receipt",
        keys: [
          {
            receipt_id: r.receipt_id,
            endpoint: "player_battlelog",
            entity_key: "#P0LYQ",
            payload_hash: original,
            replacement_hash,
          },
        ],
      },
      bb = Buffer.from(JSON.stringify(batch)),
      batch_sha256 = sha(bb);
    const g = await rightSizingPurge(
        ctx.url,
        { guard: true, guard_clans: [] },
        deps,
      ),
      root = {
        version: 1,
        guard_clans: [],
        battle_guard_clans: [],
        receipt_high_water: g.receipt_high_water,
        guard_sha256: g.sha256,
        schema_sha256: g.schema_sha256,
        cutoff: "2026-10-02T20:19:00.000Z",
        batches: [batch_sha256],
        replacements: {
          [`${replacement_hash}/#P0LYQ`]: {
            key,
            compressed_sha256: sha(bytes),
          },
        },
      },
      rb = Buffer.from(JSON.stringify(root)),
      manifest_sha256 = sha(rb),
      spec = {
        manifest_sha256,
        batch_sha256,
        apply: true,
        approved_manifest_sha256: manifest_sha256,
      };
    objects.set(`right-sizing/v1/purge/${manifest_sha256}.json`, rb);
    objects.set(`right-sizing/v1/purge/batches/${batch_sha256}.json`, bb);
    await assert.rejects(rightSizingPurge(ctx.url, spec, deps), /not staged/);
    objects.set(key, gzipSync('["different"]'));
    await assert.rejects(
      rightSizingPurge(ctx.url, spec, deps),
      /replacement differs/,
    );
    const conflict = Buffer.from(
        JSON.stringify({
          ...batch,
          keys: [{ ...batch.keys[0], replacement_hash: null }, batch.keys[0]],
        }),
      ),
      conflictSha = sha(conflict),
      conflictRoot = Buffer.from(
        JSON.stringify({ ...root, batches: [conflictSha] }),
      ),
      conflictRootSha = sha(conflictRoot);
    objects.set(`right-sizing/v1/purge/batches/${conflictSha}.json`, conflict);
    objects.set(`right-sizing/v1/purge/${conflictRootSha}.json`, conflictRoot);
    await assert.rejects(
      rightSizingPurge(
        ctx.url,
        {
          manifest_sha256: conflictRootSha,
          batch_sha256: conflictSha,
          apply: true,
          approved_manifest_sha256: conflictRootSha,
        },
        deps,
      ),
      /duplicate physical/,
    );
    assert.equal(
      (
        await ctx.db.query(
          "select replay_retired_at,replay_payload_hash from api_receipt where receipt_id=$1",
          [receiptId],
        )
      ).rows[0].replay_retired_at,
      null,
    );
    objects.set(key, bytes);
    assert.equal((await rightSizingPurge(ctx.url, spec, deps)).affected, 1);
    const row = (
      await ctx.db.query(
        "select payload_hash,replay_payload_hash,admission from api_receipt",
      )
    ).rows[0];
    assert.deepEqual(row, {
      payload_hash: original,
      replay_payload_hash: replacement_hash,
      admission: "admitted",
    });
    assert.equal((await rightSizingPurge(ctx.url, spec, deps)).affected, 0);
  } finally {
    await ctx.drop();
  }
});

test("generic event ownership, fresh previews, parent cascades, cache identity and capture/editorial guards refuse unsafe batches", async () => {
  const ctx = await scratchDb("rightgeneric"),
    objects = new Map();
  const deps = {
    bucket: "private",
    s3: {
      async send(c) {
        const b = objects.get(c.input.Key);
        if (!b) throw Error("not staged");
        return {
          ContentLength: b.length,
          Body: { transformToByteArray: async () => b },
        };
      },
    },
  };
  const make = async (batch, extra = {}) => {
    const b = Buffer.from(JSON.stringify(batch)),
      batch_sha256 = sha(b);
    objects.set(`right-sizing/v1/purge/batches/${batch_sha256}.json`, b);
    const g = await rightSizingPurge(
      ctx.url,
      { guard: true, guard_clans: [] },
      deps,
    );
    const r = Buffer.from(
        JSON.stringify({
          version: 1,
          guard_clans: [],
          battle_guard_clans: [],
          receipt_high_water: g.receipt_high_water,
          guard_sha256: g.sha256,
          schema_sha256: g.schema_sha256,
          cutoff: "2026-10-02T20:19:00.000Z",
          batches: [batch_sha256],
          ...extra,
        }),
      ),
      manifest_sha256 = sha(r);
    objects.set(`right-sizing/v1/purge/${manifest_sha256}.json`, r);
    return { manifest_sha256, batch_sha256 };
  };
  const applied = (s) => ({
    ...s,
    apply: true,
    approved_manifest_sha256: s.manifest_sha256,
  });
  try {
    const a = (
      await ctx.db.query(
        "insert into account(kind,email_hash,status) values('person','kept-generic','approved') returning account_id",
      )
    ).rows[0];
    await ctx.db.query(
      "insert into player(player_tag) values('#P0LYQ'),('#P2LQ0')",
    );
    await ctx.db.query("insert into clan(clan_tag) values('#P9LQ0')");
    await ctx.db.query(
      "insert into claim(account_id,player_tag) values($1,'#P0LYQ')",
      [a.account_id],
    );
    const pe = (
      await ctx.db.query(
        "insert into player_event(player_tag,event_type,timing,window_start,window_end) values('#P0LYQ','arena_changed','estimated','2026-01-01','2026-01-01') returning event_id::text",
      )
    ).rows[0];
    const ce = (
      await ctx.db.query(
        "insert into clan_event(clan_tag,player_tag,event_type,timing,window_start,window_end) values('#P9LQ0','#P0LYQ','member_joined','estimated','2026-01-01','2026-01-01') returning event_id::text",
      )
    ).rows[0];
    for (const [table, event] of [
      ["player_event", pe],
      ["clan_event", ce],
    ]) {
      const s = await make({ version: 1, kind: "table", table, keys: [event] });
      await assert.rejects(
        rightSizingPurge(ctx.url, s, deps),
        /overlaps retained/,
      );
      await assert.rejects(
        rightSizingPurge(ctx.url, applied(s), deps),
        /overlaps retained/,
      );
    }
    await ctx.db.query(
      "update player_event set player_tag='#P2LQ0',window_end='2026-10-03' where event_id=$1",
      [pe.event_id],
    );
    let s = await make({
      version: 1,
      kind: "table",
      table: "player_event",
      keys: [pe],
    });
    await assert.rejects(
      rightSizingPurge(ctx.url, s, deps),
      /changed after cutoff/,
    );
    await ctx.db.query(
      "update player_event set window_end='2026-01-01' where event_id=$1",
      [pe.event_id],
    );
    s = await make({
      version: 1,
      kind: "table",
      table: "player_event",
      keys: [pe],
    });
    assert.equal((await rightSizingPurge(ctx.url, s, deps)).affected, 1);
    assert.equal(
      (await rightSizingPurge(ctx.url, applied(s), deps)).affected,
      1,
    );
    const group = (
      await ctx.db.query(
        "insert into collection(slug,title,kind,owner_account,created_at) values('retired-test','Retired','player',$1,'2026-01-01') returning collection_id::text",
        [a.account_id],
      )
    ).rows[0];
    await ctx.db.query(
      "insert into collection_member(collection_id,subject_tag,added_at) values($1,'#P2LQ0','2026-01-01')",
      [group.collection_id],
    );
    s = await make({
      version: 1,
      kind: "table",
      table: "collection",
      keys: [group],
    });
    await assert.rejects(
      rightSizingPurge(ctx.url, s, deps),
      /undeclared children/,
    );
    await assert.rejects(
      rightSizingPurge(ctx.url, applied(s), deps),
      /undeclared children/,
    );
    const cache = (
      await ctx.db.query(
        "insert into api_payload(endpoint,entity_key,payload_hash,payload_json,first_fetched_at,last_fetched_at) values('player','#P0LYQ',$1,'{}','2026-01-01','2026-01-01') returning payload_id::text,endpoint,entity_key,payload_hash",
        ["b".repeat(64)],
      )
    ).rows[0];
    s = await make({ version: 1, kind: "cache", keys: [cache] });
    await assert.rejects(
      rightSizingPurge(ctx.url, s, deps),
      /cache overlaps retained/,
    );
    s = await make({
      version: 1,
      kind: "cache",
      keys: [{ ...cache, payload_hash: "c".repeat(64) }],
    });
    await assert.rejects(rightSizingPurge(ctx.url, s, deps), /cache identity/);
    const refreshed = (
      await ctx.db.query(
        "insert into api_payload(endpoint,entity_key,payload_hash,payload_json,first_fetched_at,last_fetched_at) values('rankings_pol','global',$1,'{}','2026-01-01','2026-10-03') returning payload_id::text,endpoint,entity_key,payload_hash",
        ["d".repeat(64)],
      )
    ).rows[0];
    s = await make({ version: 1, kind: "cache", keys: [refreshed] });
    assert.equal((await rightSizingPurge(ctx.url, s, deps)).affected, 1);
    await ctx.db.query(
      "update api_payload set first_fetched_at='2026-10-03' where payload_id=$1",
      [refreshed.payload_id],
    );
    await assert.rejects(rightSizingPurge(ctx.url, s, deps), /cache identity/);
    await ctx.db.query(
      "update api_payload set first_fetched_at='2026-01-01',payload_hash=$2 where payload_id=$1",
      [refreshed.payload_id, "e".repeat(64)],
    );
    await assert.rejects(rightSizingPurge(ctx.url, s, deps), /cache identity/);
    await ctx.db.query(
      "update api_payload set payload_hash=$2 where payload_id=$1",
      [refreshed.payload_id, refreshed.payload_hash],
    );
    assert.equal(
      (await rightSizingPurge(ctx.url, applied(s), deps)).affected,
      1,
    );
    const call = (
      await ctx.db.query(
        "insert into mcp_call_audit(tool,args,request_id,created_at,captured) values('rankings_players','{}','00000000-0000-0000-0000-000000000002','2026-01-01',true) returning audit_id::text,request_id::text",
      )
    ).rows[0];
    s = await make({
      version: 1,
      kind: "capture",
      keys: [{ ...call, request_id: "00000000-0000-0000-0000-000000000003" }],
    });
    await assert.rejects(
      rightSizingPurge(ctx.url, s, deps),
      /capture identity/,
    );
    s = await make({ version: 1, kind: "capture", keys: [call] });
    assert.equal((await rightSizingPurge(ctx.url, s, deps)).affected, 1);
    assert.equal(
      (await rightSizingPurge(ctx.url, applied(s), deps)).affected,
      1,
    );
    assert.equal(
      (await rightSizingPurge(ctx.url, applied(s), deps)).affected,
      0,
    );
    const facts = { retired: true },
      note = "old editorial";
    const issue = (
      await ctx.db.query(
        "insert into email_issue(kind,period_key,facts,note,composed_at) values('ultimate_champions','old',$1,$2,'2026-01-01') returning issue_id::text",
        [facts, note],
      )
    ).rows[0];
    const eb = {
      version: 1,
      kind: "editorial",
      keys: [
        {
          ...issue,
          facts_sha256: sha(Buffer.from(JSON.stringify(facts))),
          note_sha256: sha(Buffer.from(JSON.stringify(note))),
        },
      ],
    };
    s = await make(eb);
    assert.equal((await rightSizingPurge(ctx.url, s, deps)).affected, 1);
    await ctx.db.query(
      "update email_issue set kind='clan_weekly' where issue_id=$1",
      [issue.issue_id],
    );
    await assert.rejects(rightSizingPurge(ctx.url, s, deps), /editorial kind/);
    await ctx.db.query(
      "update email_issue set kind='ultimate_champions',composed_at='2026-10-03' where issue_id=$1",
      [issue.issue_id],
    );
    await assert.rejects(rightSizingPurge(ctx.url, s, deps), /cutoff differs/);
    await ctx.db.query(
      "update email_issue set composed_at='2026-01-01' where issue_id=$1",
      [issue.issue_id],
    );
    assert.equal(
      (await rightSizingPurge(ctx.url, applied(s), deps)).affected,
      1,
    );
  } finally {
    await ctx.drop();
  }
});
