import { test } from "node:test";
import assert from "node:assert/strict";
import {
  playerTagsIn,
  withPlayerVerifications,
} from "../src/player-identities.mjs";
import { json } from "../src/http.mjs";
const A = "#00C298UC",
  B = "#080J2V9Q",
  C = "#0G2ULUJP";

test("proof covers initials and chosen art, never follows or clan subjects", async () => {
  let calls = 0;
  const db = {
    query: async (sql, [tags]) => {
      calls++;
      assert.match(sql, /c.status = 'verified'/);
      assert.match(sql, /relationship in \('primary', 'alt'\)/);
      assert.match(sql, /coalesce\(a.kind, 'person'\) = 'person'/);
      assert.deepEqual(tags, [A, B, C]);
      return {
        rows: [
          { player_tag: A, avatar_card_id: null },
          { player_tag: C, avatar_card_id: 26000000 },
        ],
      };
    },
  };
  const result = await withPlayerVerifications(
    db,
    "GET /api/me/people/find",
    json(200, {
      people: [
        { tag: A, name: "Ada" },
        { tag: B, name: "Elm", avatar_card_id: 26000001 },
        { tag: C, name: "Juniper" },
      ],
      subjects: [{ kind: "clan", tag: "#0QC8RCGY", name: "Grove" }],
    }),
  );
  const body = JSON.parse(result.body);
  assert.deepEqual(body.player_verifications, {
    [A]: true,
    [B]: false,
    [C]: true,
  });
  assert.equal(body.people[1].avatar_card_id, 26000001);
  assert.equal(calls, 1);
  assert.deepEqual([...playerTagsIn({ members: [{ player_tag: A }] })], [A]);
});

test("website tool projection keeps the underlying body intact and puts proof where the UI caches it", async () => {
  const db = { query: async () => ({ rows: [] }) };
  const response = json(200, {
    tool: "players_summary",
    body: { player: { player_tag: A, name: "Ada" } },
  });
  const out = JSON.parse(
    (await withPlayerVerifications(db, "POST /api/me/tool", response)).body,
  );
  assert.deepEqual(out.body.player_verifications, { [A]: false });
  assert.deepEqual(out.body.player, { player_tag: A, name: "Ada" });
});

test("errors, writes, /api/v1, admin and non-player reads do not query or change", async () => {
  const db = {
    query: () => {
      throw new Error("unexpected query");
    },
  };
  for (const [route, status, body] of [
    ["GET /api/v1/me", 200, { player_tag: A }],
    ["GET /api/me/people/find", 401, { player_tag: A }],
    ["POST /api/me/follow", 200, { player_tag: A }],
    ["GET /api/admin/accounts", 200, { player_tag: A }],
    ["GET /api/me/home", 200, { clan_tag: A }],
  ]) {
    const response = json(status, body);
    assert.equal(await withPlayerVerifications(db, route, response), response);
  }
});
