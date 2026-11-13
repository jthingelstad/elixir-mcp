import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discordActionMessage,
  discordActionTitle,
  discordShareable,
  escapeDiscord,
  DISCORD_MAX_CHARS,
} from "../src/discord.mjs";
import { ACTION_TYPES } from "../src/actions.mjs";

const where = { clanTag: "#0QC8RCGY", appUrl: "https://elixir.test/clan/" };
const card = (extra = {}) => ({
  card_id: "c1",
  type: "promotion",
  status: "proposed",
  number: 12,
  player_tag: "#Q",
  player_name: "Quiet",
  ...extra,
});

test("an open action is its line and its own page, unpreviewed", () => {
  assert.equal(
    discordActionMessage(card(), where),
    "**#12 Promote to Elder: Quiet**\n<https://elixir.test/clan/0QC8RCGY/actions/12>",
  );
});

test("an action without a number links to the list", () => {
  assert.match(
    discordActionMessage(card({ number: undefined }), where),
    /<https:\/\/elixir\.test\/clan\/0QC8RCGY\/actions>$/,
  );
});

test("a closed action is struck through and says how, and by whom", () => {
  const done = discordActionMessage(
    card({ status: "done", decided_by: "#L", decided_by_name: "Lead" }),
    where,
  );
  assert.equal(
    done,
    "~~**#12 Promote to Elder: Quiet**~~\n✅ Completed by Lead\n<https://elixir.test/clan/0QC8RCGY/actions/12>",
  );
  assert.match(
    discordActionMessage(
      card({ status: "declined", decided_by: "#L", decided_by_name: null }),
      where,
    ),
    // A tag is no one's name: an older Action without one says who led.
    /\n❌ Declined by a leader\n/,
  );
  assert.match(
    discordActionMessage(card({ status: "withdrawn" }), where),
    /\n➖ Withdrawn: Elixir no longer suggests it\n/,
  );
});

test("a name is shown as typed, never as Markdown", () => {
  const text = discordActionMessage(
    card({
      status: "done",
      player_name: "*bold*_x_`y`",
      decided_by_name: "~z~",
    }),
    where,
  );
  assert.ok(text.includes("Elder: \\*bold\\*\\_x\\_\\`y\\`**"));
  assert.ok(text.includes("Completed by \\~z\\~"));
  assert.ok(text.length <= DISCORD_MAX_CHARS);
  // Mentions too: a name like <@&1> or @everyone stays text.
  const mention = discordActionMessage(
    card({ player_name: "<@&123> @everyone" }),
    where,
  );
  assert.ok(mention.includes("Elder: \\<\\@&123\\> \\@everyone**"));
  assert.equal(escapeDiscord("a\nb"), "a b");
});

test("a forum post's name is the action's line, plain and within 100", () => {
  assert.equal(
    discordActionTitle(card({ player_name: "*bold*" })),
    "#12 Promote to Elder: *bold*",
  );
  assert.ok(
    discordActionTitle(card({ player_name: "x".repeat(300) })).length <= 100,
  );
});

test("a member's own action, a removal, a promotion and a demotion are never posted; every other leader and elder one is", () => {
  assert.equal(
    discordShareable({ type: "away", player_tag: "#Q", audience: undefined }),
    false,
  );
  // Only the Leader and Co-Leaders see an open removal, promotion or
  // demotion (2026-11-13), and the channel also carries Elders' welcomes:
  // kept out, stored audience or not.
  const keptOut = ["removal", "promotion", "demotion"];
  for (const type of keptOut) {
    assert.equal(discordShareable({ type }), false, type);
    assert.equal(
      discordShareable({ type, audience: { kind: "leaders" } }),
      false,
      type,
    );
  }
  const posted = [
    "departure",
    "welcome",
    "awards_standings",
    "awards_announcement",
    "rules_announcement",
  ];
  for (const type of posted)
    assert.equal(discordShareable({ type }), true, type);
  // Every kind is accounted for here: a new one is a decision.
  assert.deepEqual(
    Object.keys(ACTION_TYPES).sort(),
    [...posted, ...keptOut, "away"].sort(),
  );
  assert.deepEqual(
    Object.keys(ACTION_TYPES)
      .filter((t) => ACTION_TYPES[t].discord === false)
      .sort(),
    [...keptOut].sort(),
  );
});
