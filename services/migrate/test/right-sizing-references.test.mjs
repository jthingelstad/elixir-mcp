import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { rightSizingCensus } from "../src/ops-right-sizing.mjs";

test("reference evidence has a separate definition without changing the history census", async () => {
  const history = await rightSizingCensus("unused"),
    refs = await rightSizingCensus("unused", { group: "references" });
  assert.equal(
    history.definition_sha256,
    "6cf446529805f98b59341411e631b316ba46e569075c35e167bd404943587338",
  );
  assert.notEqual(refs.definition_sha256, history.definition_sha256);
  assert.deepEqual(refs.lanes, [
    "deck",
    "war_period_anchor",
    "clan_event_inventory",
    "player_profile_provenance",
    "clan_profile_provenance",
    "ranking_player_entities",
    "ranking_clan_entities",
    "live_job",
    "mcp_call_audit",
    "email_issue",
    "email_featured_card",
    "email_send",
  ]);
  await assert.rejects(
    rightSizingCensus("must-not-connect", { group: "arbitrary" }),
    /unknown census group/,
  );
  await assert.rejects(
    rightSizingCensus("must-not-connect", {
      group: "references",
      export: { lane: "clan_state" },
    }),
    /unknown census lane/,
  );
});

test("reference pages retain identifiers and hashes while excluding mail bodies and call arguments", async () => {
  const ctx = await scratchDb("rightrefs"),
    objects = new Map();
  const settings = {
    bucket: "private",
    s3: {
      async send(command) {
        assert.equal(command.constructor.name, "PutObjectCommand");
        const x = command.input;
        assert.equal(x.IfNoneMatch, "*");
        objects.set(x.Key, Buffer.from(x.Body));
        return {};
      },
    },
  };
  const cutoff = "2026-10-02T00:00:00.000Z",
    snapshot_id = "00000000-0000-0000-0000-000000000001";
  const exportLane = (lane, after = null) =>
    rightSizingCensus(
      ctx.url,
      {
        group: "references",
        export: { lane, after, cutoff, snapshot_id, limit: 1 },
      },
      settings,
    );
  try {
    await ctx.db.query(
      "insert into card(card_id,name,kind,rarity,max_level) values(26000000,'Knight','card','common',14)",
    );
    await ctx.db.query(
      "insert into deck(deck_hash,card_count,first_seen_at,last_seen_at) values('kept-deck',2,'2026-01-01','2026-01-01'),('future-deck',1,'2026-10-03','2026-10-03')",
    );
    await ctx.db.query(
      "insert into deck_card(deck_hash,card_id,form) values('kept-deck',26000000,0),('kept-deck',26000000,1)",
    );
    const deck = await exportLane("deck");
    assert.equal(deck.rows, 1);
    assert.deepEqual(JSON.parse(objects.get(deck.key)).rows, [
      { deck_hash: "kept-deck", cards: "2" },
    ]);
    const facts = { obsolete_stats: "never-export-facts" },
      note = "never-export-note";
    await ctx.db.query(
      "insert into email_issue(kind,period_key,facts,note,subject_line,composed_at) values('ultimate_champions','2026-01',$1,$2,'never-export-subject','2026-01-01'),('ultimate_champions','future',$1,$2,'never-export-subject','2026-10-03')",
      [facts, note],
    );
    const issue = await exportLane("email_issue"),
      bytes = objects.get(issue.key),
      row = JSON.parse(bytes).rows[0];
    assert.equal(issue.rows, 1);
    assert.equal(issue.cutoff_policy, "timestamptz:composed_at");
    assert.equal(
      row.facts_sha256,
      createHash("sha256").update(JSON.stringify(facts)).digest("hex"),
    );
    assert.equal(
      row.note_sha256,
      createHash("sha256").update(JSON.stringify(note)).digest("hex"),
    );
    assert.equal(row.facts_bytes, Buffer.byteLength(JSON.stringify(facts)));
    assert.doesNotMatch(bytes.toString(), /never-export/);
    await ctx.db.query(
      "insert into mcp_call_audit(tool,args,request_id,created_at) values('rankings_players','{\"private\":\"never-export-call\"}','00000000-0000-0000-0000-000000000002','2026-01-01')",
    );
    const call = await exportLane("mcp_call_audit");
    assert.doesNotMatch(
      objects.get(call.key).toString(),
      /never-export-call|"args"|viewer_ip/,
    );
    assert.equal(
      JSON.parse(objects.get(call.key)).rows[0].tool,
      "rankings_players",
    );
    await ctx.db.query("insert into clan(clan_tag) values('#P2LQ0')");
    await ctx.db.query(
      "insert into clan_event(clan_tag,event_type,timing,window_start,window_end,joined_observed_at) values('#P2LQ0','member_joined','estimated','2026-01-01','2026-01-02','2026-01-02'),('#P2LQ0','role_changed','estimated','2026-01-01','2026-01-02',null)",
    );
    const first = await exportLane("clan_event_inventory"),
      second = await exportLane("clan_event_inventory", first.next_after);
    assert.equal(first.cutoff_policy, "timestamptz:window_end");
    assert.equal(first.rows, 1);
    assert.equal(second.rows, 1);
    assert.equal(second.done, true);
    assert.ok(JSON.parse(objects.get(second.key)).rows[0].event_id);
    for (const lane of [
      "player_profile_provenance",
      "clan_profile_provenance",
      "ranking_player_entities",
      "ranking_clan_entities",
      "live_job",
    ]) {
      const receipt = await exportLane(lane);
      assert.equal(receipt.rows, 0);
      assert.equal(receipt.done, true);
      assert.ok(JSON.parse(objects.get(receipt.key)).primary_key.length);
    }
  } finally {
    await ctx.drop();
  }
});
