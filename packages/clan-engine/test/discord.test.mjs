import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discordActionMessage,
  discordShareable,
  DISCORD_MAX_CHARS,
} from "../src/discord.mjs";

const where = { clanTag: "#2PQRJ8LV", appUrl: "https://elixir.test/clan/" };
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
    "**#12 Promote to Elder: Quiet**\n<https://elixir.test/clan/2PQRJ8LV/actions/12>",
  );
});

test("an action without a number links to the list", () => {
  assert.match(
    discordActionMessage(card({ number: undefined }), where),
    /<https:\/\/elixir\.test\/clan\/2PQRJ8LV\/actions>$/,
  );
});

test("a closed action is struck through and says how, and by whom", () => {
  const done = discordActionMessage(
    card({ status: "done", decided_by: "#L", decided_by_name: "Lead" }),
    where,
  );
  assert.equal(
    done,
    "~~**#12 Promote to Elder: Quiet**~~\n✅ Completed by Lead\n<https://elixir.test/clan/2PQRJ8LV/actions/12>",
  );
  assert.match(
    discordActionMessage(
      card({ status: "declined", decided_by: "#L", decided_by_name: null }),
      where,
    ),
    /\n❌ Declined by #L\n/,
  );
  assert.match(
    discordActionMessage(card({ status: "withdrawn" }), where),
    /\n➖ Withdrawn: Elixir Clan no longer suggests it\n/,
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
});

test("a member's own action is never posted; leader and elder ones are", () => {
  assert.equal(
    discordShareable({ type: "away", player_tag: "#Q", audience: undefined }),
    false,
  );
  assert.equal(discordShareable({ type: "welcome" }), true);
  assert.equal(discordShareable({ type: "removal" }), true);
});
