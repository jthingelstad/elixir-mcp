/** A departure's role is the one held in the stint it ended, never the role
 * of a later stint after the member came back (Codex on #677). */
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { factItems } from "../src/activity/entries.mjs";

const CLAN = "#PYLQ";
const BACK = "#9QYU";
const NEVER_LEFT = "#9QUY";
let ctx;

before(async () => {
  ctx = await scratchDb("departure_role");
  const db = ctx.db;
  await db.query(`insert into clan (clan_tag, name) values ($1, 'Example')`, [
    CLAN,
  ]);
  await db.query(
    `insert into player (player_tag, name) values ($1, 'Back'), ($2, 'Stayed')`,
    [BACK, NEVER_LEFT],
  );
  await db.query(
    `insert into clan_membership
       (clan_tag, player_tag, joined_observed_at, left_observed_at, role)
     values
       ($1, $2, '2026-09-01T00:00Z', '2026-09-10T00:00Z', 'member'),
       ($1, $2, '2026-09-20T00:00Z', '2026-09-25T00:00Z', 'member'),
       ($1, $2, '2026-10-01T00:00Z', null, 'elder'),
       ($1, $3, '2026-09-01T00:00Z', null, 'elder')`,
    [CLAN, BACK, NEVER_LEFT],
  );
  await db.query(
    `insert into attested_fact
       (subject_kind, clan_tag, player_tag, fact_type, detail, visibility,
        source, source_ref, occurred_at, recorded_at)
     values
       ('clan', $1, $2, 'departure_classified',
        '{"kind":"kick","left_at":"2026-09-10T00:00:00Z"}', 'clan',
        'clan.poapkings.com', 'first', '2026-09-11T00:00Z', '2026-09-11T00:00Z'),
       ('clan', $1, $2, 'departure_classified', '{"kind":"leave"}', 'clan',
        'clan.poapkings.com', 'late-word', '2026-10-02T00:00Z', '2026-10-02T00:00Z'),
       ('clan', $1, $3, 'departure_classified', '{"kind":"leave"}', 'clan',
        'clan.poapkings.com', 'no-stint', '2026-10-02T00:00Z', '2026-10-02T00:00Z')`,
    [CLAN, BACK, NEVER_LEFT],
  );
});

after(() => ctx.drop());

test("a departure reads the role of the stint it ended, and none when no stint matches", async () => {
  const items = await factItems(ctx.db, [{ kind: "clan", tag: CLAN }], {
    clanMember: true,
    fromMs: Date.parse("2026-09-01T00:00Z"),
    toMs: Date.parse("2026-10-30T00:00Z"),
  });
  const role = (ref, tag) =>
    items.find(
      (i) =>
        i.kind === "departure_classified" &&
        i.facts.player_tag === tag &&
        i.at.startsWith(ref),
    ).facts.role_at_departure;
  // Back as an Elder today: the old departure still says Member.
  assert.equal(role("2026-09-11", BACK), "member");
  // A word given after the return, with no left_at: the last closed stint.
  assert.equal(role("2026-10-02", BACK), "member");
  // Still in the only stint the record holds: no role, never a guess.
  assert.equal(role("2026-10-02", NEVER_LEFT), undefined);
});
