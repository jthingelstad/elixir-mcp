/** Conditional Drop facts need a source-backed MCP assertion even when
 * production's natural acceptance window has no completed game. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { recordDropGame } from "@elixir-mcp/record/attested-facts";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";
import { validateArgs } from "../src/validate.mjs";
import { OUTPUT_SCHEMAS } from "../src/output-schemas.mjs";

const PLAYER = "#0PGQ2UYL";
const OTHER = "#0RJ29CVY";
const CLAN = "#0Q2L8";
const iso = (ms) => new Date(ms).toISOString();

test("elixir_timeline serves canonical Drop game fields only to the current player audience", async () => {
  const scratch = await scratchDb("timeline_drop_game");
  const { db } = scratch;
  try {
    const people = {};
    for (const key of ["owner", "follower", "outsider"])
      people[key] = (
        await db.query(
          "insert into account(email_hash,status) values($1,'approved') returning account_id",
          [`drop-timeline-${key}`],
        )
      ).rows[0].account_id;
    await db.query(
      "insert into player(player_tag,name) values($1,'Invented Player'),($2,'Invented Clanmate')",
      [PLAYER, OTHER],
    );
    await db.query(
      "insert into clan(clan_tag,name) values($1,'Invented Clan')",
      [CLAN],
    );
    for (const [who, tag] of [
      ["owner", PLAYER],
      ["outsider", OTHER],
    ]) {
      await db.query(
        "insert into claim(account_id,player_tag,is_primary,relationship,status,verified_at) values($1,$2,true,'primary','verified',now())",
        [people[who], tag],
      );
      await db.query(
        "insert into clan_membership(clan_tag,player_tag,role,joined_observed_at) values($1,$2,'member',now())",
        [CLAN, tag],
      );
    }
    await db.query(
      "insert into claim(account_id,player_tag,relationship,notify) values($1,$2,'friend',true)",
      [people.follower, PLAYER],
    );
    await db.query(
      "insert into account_clan(account_id,clan_tag,scope,notify) values($1,$2,'comprehensive',true)",
      [people.outsider, CLAN],
    );
    const started = Date.now() - 60_000;
    const gameId = randomUUID();
    assert.equal(
      await recordDropGame(db, {
        version: 1,
        type: "drop.game.completed",
        accountId: people.owner,
        playerTag: PLAYER,
        gameId,
        mode: "exact-ten",
        startedAt: iso(started),
        completedAt: iso(started + 10_000),
        score: 10,
        answers: 1,
        cards: [
          { id: 26000000, name: "Knight", cost: 3, reason: "solution" },
          { id: 26000020, name: "Giant Skeleton", cost: 6, reason: "solution" },
          { id: 26000010, name: "Skeletons", cost: 1, reason: "solution" },
        ],
      }),
      1,
    );
    const read = async (who) => {
      const invoke = makeInvoker({
        db,
        account: {
          accountId: people[who],
          kind: "person",
          role: "member",
          timezone: "UTC",
          credentialType: "oauth",
        },
        registry: makeRegistry(),
      });
      const result = await invoke("elixir_timeline", {
        from: iso(started - 60_000),
        to: iso(Date.now()),
        basis: "observed",
        kinds: ["drop_game"],
        player_tag: PLAYER,
        mark_read: false,
        skip_empty: true,
      });
      assert.equal(result.isError, false, JSON.stringify(result.body));
      assert.equal(
        validateArgs(OUTPUT_SCHEMAS.elixir_timeline, result.body),
        null,
      );
      return result.body.timeline;
    };
    for (const who of ["owner", "follower"]) {
      const items = await read(who);
      assert.equal(items.length, 1, who);
      assert.equal(items[0].kind, "drop_game");
      assert.equal(items[0].section, "attested");
      assert.equal(items[0].facts.game_id, gameId);
      assert.equal(items[0].facts.player_tag, PLAYER);
      assert.equal(items[0].publishable, false);
    }
    assert.deepEqual(
      await read("outsider"),
      [],
      "Clan membership and player_tag do not grant Drop access",
    );
    await db.query("update claim set notify=false where account_id=$1", [
      people.follower,
    ]);
    assert.deepEqual(
      await read("follower"),
      [],
      "a muted saved player grants no current Drop audience",
    );
  } finally {
    await scratch.drop();
  }
});
