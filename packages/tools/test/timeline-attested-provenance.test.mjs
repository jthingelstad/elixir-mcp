/** Conditional attester metadata is real output, not evidence every natural
 * window must contain. Scratch facts keep both the shape and access rule. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { factItems } from "../src/activity/entries.mjs";
import { missingFacts } from "../src/activity/schemas.mjs";

const CLAN = "#0CPP";
const MEMBER = "#08U2";
const LEADER = "#02YQ";
const AT = "2026-11-18T10:00:00.000Z";
const subjects = [{ kind: "clan", tag: CLAN }];
let ctx, member, stranger;

before(async () => {
  ctx = await scratchDb("timeline_attester");
  const db = ctx.db;
  const account = async (key) =>
    (
      await db.query(
        `insert into account(email_hash,status) values ($1,'approved') returning account_id`,
        [key],
      )
    ).rows[0].account_id;
  member = await account("attester-member");
  const leader = await account("attester-leader");
  stranger = await account("attester-stranger");
  await db.query("insert into clan(clan_tag,name) values ($1,'Example Clan')", [
    CLAN,
  ]);
  for (const [id, tag, name, role] of [
    [member, MEMBER, "Invented Member", "elder"],
    [leader, LEADER, "Invented Leader", "leader"],
  ]) {
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      name,
    ]);
    await db.query(
      `insert into claim(account_id,player_tag,is_primary,relationship,status)
       values ($1,$2,true,'primary','verified')`,
      [id, tag],
    );
    await db.query(
      `insert into clan_membership(clan_tag,player_tag,role,joined_observed_at)
       values ($1,$2,$3,'2026-11-01T00:00:00Z')`,
      [CLAN, tag, role],
    );
  }
  for (const [type, detail, by, tag, role] of [
    [
      "role_change_made",
      { from: "member", to: "elder" },
      leader,
      LEADER,
      "leader",
    ],
    [
      "award_standing",
      {
        award: "Example award",
        award_id: "example-award",
        season_id: 137,
        place: 1,
        value: 4,
        unit: "donations",
        as_of: AT,
      },
      null,
      null,
      null,
    ],
  ])
    await db.query(
      `insert into attested_fact
       (subject_kind,clan_tag,player_tag,fact_type,detail,visibility,
        source,source_ref,attester_account_id,attester_tag,attester_role,
        occurred_at,recorded_at)
       values ('clan',$1,$2,$3,$4,'clan','clan.poapkings.com',$3,$5,$6,$7,$8,$8)`,
      [CLAN, MEMBER, type, detail, by, tag, role, AT],
    );
});
after(async () => ctx?.drop());

const read = (accountId, extra = {}) =>
  factItems(ctx.db, subjects, {
    accountId,
    fromMs: Date.parse("2026-11-18T09:00:00Z"),
    toMs: Date.parse("2026-11-18T11:00:00Z"),
    ...extra,
  });

test("authorized clan facts carry actor or app attester metadata required by their contract", async () => {
  {
    const items = await read(member);
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.find((it) => it.kind === "role_change_made").facts.attested_by,
      {
        app: "Clan",
        player_tag: LEADER,
        name: "Invented Leader",
        role: "leader",
      },
    );
    assert.deepEqual(
      items.find((it) => it.kind === "award_standing").facts.attested_by,
      { app: "Clan", player_tag: null, name: null, role: null },
    );
    for (const it of items) {
      assert.deepEqual(missingFacts(it), []);
      const without = { ...it.facts };
      delete without.attested_by;
      assert.ok(
        missingFacts({ ...it, facts: without }).includes("attested_by"),
      );
    }
  }
});

test("no attester metadata is returned without clan membership or an in-window fact", async () => {
  assert.deepEqual(await read(stranger), []);
  assert.deepEqual(await read(undefined), []);
  assert.deepEqual(
    await read(member, {
      fromMs: Date.parse("2026-11-17T09:00:00Z"),
      toMs: Date.parse("2026-11-17T11:00:00Z"),
    }),
    [],
  );
});
