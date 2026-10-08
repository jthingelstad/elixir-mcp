/**
 * Account items name their subject. The fresh-person journey on
 * 2026-10-08 read "your account: clan added (#92P2LPLP)": Elixir's
 * follow of the primary's clan (0205) records the player it followed for
 * beside the clan, and the line named the player.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { itemText } from "../src/activity/summary.mjs";

const item = (kind, facts) => ({
  kind: `account_${kind}`,
  subject_name: "your account",
  at: "2026-10-08T21:28:00Z",
  facts,
});

test("an automatic clan follow names the clan, then the player it followed for", () => {
  const text = itemText(
    item("clan_added", {
      clan_tag: "#GGJG2CCR",
      scope: "activity",
      via: "profile",
      auto: true,
      player_tag: "#92P2LPLP",
    }),
  );
  assert.match(
    text,
    /clan added \(#GGJG2CCR, automatically: #92P2LPLP's clan\)\.$/,
  );
});

test("a clan added by hand, or removed, names the clan alone", () => {
  assert.match(
    itemText(item("clan_added", { clan_tag: "#GGJG2CCR", via: "console" })),
    /clan added \(#GGJG2CCR\)\.$/,
  );
  assert.match(
    itemText(
      item("clan_removed", {
        clan_tag: "#GGJG2CCR",
        auto: true,
        reason: "primary_clan_moved",
      }),
    ),
    /clan removed \(#GGJG2CCR, automatically\)\.$/,
  );
});

test("a player event still names the player", () => {
  assert.match(
    itemText(item("claim_added", { player_tag: "#92P2LPLP" })),
    /claim added \(#92P2LPLP\)\.$/,
  );
  assert.match(
    itemText(item("recording_started", { clan_tag: "#GGJG2CCR" })),
    /recording started \(#GGJG2CCR\)\.$/,
  );
});
