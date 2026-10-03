import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { makeCollectorDoor } from "@elixir-mcp/collector-door";
import { emailHash } from "@elixir-mcp/auth/crypto";
import {
  runCollectorUpgrades,
  isUpgrade,
} from "../src/email/collector-upgrades.mjs";
import { buildCollector } from "../src/email/build-collector.mjs";
import { makeOutbox } from "@elixir-mcp/outbox";
import { renderMail } from "@elixir-mcp/mail";

test("only ordered released versions represent upgrades", () => {
  for (const [a, b] of [
    [null, "v3.0.4"],
    ["dev", "v3.0.4"],
    ["hash", "v3.0.4"],
    ["v3.0.4", "v3.0.4"],
    ["v3.0.4", "v3.0.3"],
    ["3.0.4", "v3.0.4"],
    ["v3.0.4", "v3.1.0-rc"],
  ])
    assert.equal(isUpgrade(a, b), false);
  assert.equal(isUpgrade("v3.0.9", "v3.0.10"), true);
  assert.equal(isUpgrade("3.9.9", "v4.0.0"), true);
});

test("door to mail: baseline, concurrent duplicate heartbeats, retries, preferences, security and owner-only replay", async () => {
  const s = await scratchDb("collector_upgrades");
  const { db } = s;
  const other = new pg.Client({ connectionString: s.url });
  await other.connect();
  try {
    const owner = (
      await db.query(
        `insert into account(email_hash,email,status,is_owner,role)
      values ($1,'owner@example.com','approved',true,'owner') returning account_id`,
        [emailHash("owner@example.com")],
      )
    ).rows[0].account_id;
    const stranger = (
      await db.query(`insert into account(email_hash,email,status)
      values ('stranger','stranger@example.com','approved') returning account_id`)
    ).rows[0].account_id;
    const gateways = [];
    for (let i = 0; i < 5; i++) {
      const token = `emcg_test_${i}`;
      const id = (
        await db.query(
          `insert into gateway(owner_account_id,name,token_hash,status)
        values ($1,$2,$3,'active') returning gateway_id`,
          [
            owner,
            `Collector ${i}`,
            crypto.createHash("sha256").update(token).digest("hex"),
          ],
        )
      ).rows[0].gateway_id;
      gateways.push({ id, token });
    }
    const door = makeCollectorDoor({
      ingest: async () => ({}),
      notifyOwner: async () => {},
    });
    const heartbeat = (dbc, g, version) =>
      door.config(dbc, {
        headers: {
          authorization: `Bearer ${g.token}`,
          ...(version
            ? {
                "x-collector-version": version,
                "x-collector-binary-sha256": "a".repeat(64),
              }
            : {}),
        },
      });
    for (const g of gateways) await heartbeat(db, g, "v3.0.3");
    assert.equal(
      (await db.query("select count(*)::int n from collector_version_event"))
        .rows[0].n,
      0,
    );
    await db.query(
      `insert into collector_release_history(platform,version,sha256,url) values ('go-linux-arm64','v3.0.4',$1,'u')`,
      ["a".repeat(64)],
    );
    for (const g of gateways)
      await Promise.all([
        heartbeat(db, g, "v3.0.4"),
        heartbeat(other, g, "v3.0.4"),
      ]);
    assert.equal(
      (await db.query("select count(*)::int n from collector_version_event"))
        .rows[0].n,
      5,
    );
    const sent = [];
    const opts = {
      db,
      secret: "test-secret",
      enqueue: async (m) => sent.push(m),
    };
    await assert.rejects(
      runCollectorUpgrades({
        ...opts,
        enqueue: async () => {
          throw new Error("outbox unavailable");
        },
      }),
    );
    const r = await runCollectorUpgrades(opts);
    assert.equal(r.sent, 5);
    assert.equal(new Set(sent.map((m) => m.send_id)).size, 5);
    assert.equal((await runCollectorUpgrades(opts)).sent, 0);
    for (const m of sent) {
      assert.match(m.subject, /v3.0.3 → v3.0.4/);
      assert.match(m.text, /Signed: reported binary/);
      assert.match(m.text, /No upgrade reason/);
      assert.match(m.html, /Collectors · Upgrade/);
      assert.doesNotMatch(m.text, /on Sundays/);
    }
    // Old ingest observation cannot rewrite the door's baseline.
    await db.query(`update gateway set last_seen_sha='v3.0.2'`);
    await heartbeat(db, gateways[0], "v3.0.4");
    await heartbeat(db, gateways[0], null);
    assert.equal(
      (await db.query("select count(*)::int n from collector_version_event"))
        .rows[0].n,
      5,
    );
    // Same-version reinstall sends nothing, downgrade is journaled/skipped.
    await heartbeat(db, gateways[0], "v3.0.3");
    assert.equal((await runCollectorUpgrades(opts)).sent, 0);
    await db.query(
      `insert into account_email_pref(account_id,kind,enabled,via) values ($1,'collector_activity',false,'profile')`,
      [owner],
    );
    await heartbeat(db, gateways[0], "v3.0.5");
    assert.equal((await runCollectorUpgrades(opts)).sent, 0);
    await db.query(`update account_email_pref set enabled=true`);
    assert.equal(
      (await runCollectorUpgrades(opts)).sent,
      0,
      "opting back in does not send old suppressed events",
    );
    await heartbeat(db, gateways[0], "dev");
    await heartbeat(db, gateways[0], "v3.0.6");
    assert.equal((await runCollectorUpgrades(opts)).sent, 0);
    // Ownership changes do not leak a queued security notice.
    await heartbeat(db, gateways[1], "v3.0.5");
    await db.query(
      "update gateway set owner_account_id=$2 where gateway_id=$1",
      [gateways[1].id, stranger],
    );
    assert.equal((await runCollectorUpgrades(opts)).sent, 0);
    const replay = [
      {
        gateway_id: gateways[0].id,
        from_version: "v3.0.3",
        to_version: "v3.0.4",
        observed_at: "2026-09-20T12:00:00Z",
        evidence: "synthetic test log",
        release: {
          release_url:
            "https://github.com/jthingelstad/elixir-mcp-collector/releases/tag/v3.0.4",
          source_url:
            "https://github.com/jthingelstad/elixir-mcp-collector/compare/v3.0.3...v3.0.4",
          changes: "Synthetic verified changes",
        },
      },
    ];
    assert.equal(
      (
        await runCollectorUpgrades({
          ...opts,
          accountEmail: "owner@example.com",
          replay,
        })
      ).dry_run,
      true,
    );
    await assert.rejects(
      runCollectorUpgrades({
        ...opts,
        accountEmail: "stranger@example.com",
        replay,
        apply: true,
      }),
    );
    const rr = await runCollectorUpgrades({
      ...opts,
      accountEmail: "owner@example.com",
      replay,
      apply: true,
    });
    assert.equal(rr.sent, 1);
    assert.match(sent.at(-1).text, /Synthetic verified changes/);
    assert.equal(
      (await db.query("select count(*)::int n from collector_release_note"))
        .rows[0].n,
      0,
      "replay notes never alter normal release metadata",
    );
    assert.match(rr.details[0].subject, /TEST.*historical replay/);
    assert.match(sent.at(-1).text, /No new upgrade was performed/);
    assert.equal(
      (
        await runCollectorUpgrades({
          ...opts,
          accountEmail: "owner@example.com",
          replay,
          apply: true,
        })
      ).sent,
      0,
    );
    await assert.rejects(
      runCollectorUpgrades({
        ...opts,
        accountEmail: "owner@example.com",
        replay: [{ ...replay[0], gateway_id: gateways[1].id }],
        apply: true,
      }),
    );
    // Enqueue can succeed before the DB ledger write fails. A retry
    // uses the original event's send id and conditional outbox key.
    await heartbeat(db, gateways[2], "v3.0.7");
    const objects = new Map();
    let puts = 0;
    const outbox = makeOutbox("test", {
      send: async (cmd) => {
        if (objects.has(cmd.input.Key))
          throw { $metadata: { httpStatusCode: 412 } };
        puts++;
        objects.set(cmd.input.Key, cmd.input.Body);
      },
    });
    let loseLedger = true;
    const flakyDb = {
      query: async (sql, params) => {
        if (sql.includes("insert into email_send") && loseLedger) {
          loseLedger = false;
          throw new Error("ledger unavailable after enqueue");
        }
        return db.query(sql, params);
      },
    };
    const crashOpts = {
      ...opts,
      db: flakyDb,
      enqueue: (msg) => outbox("email", msg, { id: msg.send_id, once: true }),
    };
    await assert.rejects(runCollectorUpgrades(crashOpts));
    assert.equal((await runCollectorUpgrades(crashOpts)).sent, 1);
    assert.equal(puts, 1);
    assert.equal((await runCollectorUpgrades(crashOpts)).sent, 0);

    const facts = await buildCollector({
      db,
      account: { accountId: owner, role: "owner", email: "owner@example.com" },
      week: {
        from: new Date("2026-09-20"),
        to: new Date("2026-09-27"),
        label: "Test week",
        key: "test",
      },
    });
    assert.equal(facts.collectors[0].version, "v3.0.6");
    const mail = renderMail("collector_activity", facts, {
      unsubscribe: "https://example.com/unsubscribe",
      manage: "https://example.com/manage",
    });
    assert.match(mail.html, /Mismatch:/);
    assert.match(mail.html, /not remote attestation/);
  } finally {
    await other.end();
    await s.drop();
  }
});
