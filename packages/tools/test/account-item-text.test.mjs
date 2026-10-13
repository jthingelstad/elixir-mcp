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

test("#556: an ended claim names the tag and what it was, never the account that verified it", () => {
  const primary = itemText(
    item("claim_ended", {
      player_tag: "#2PP0V90Y",
      reason: "verified_elsewhere",
      was_primary: true,
      relationship: "primary",
      count: 1,
    }),
  );
  assert.match(
    primary,
    /another account verified #2PP0V90Y, so it is no longer your primary player, and you have none/,
  );
  const alt = itemText(
    item("claim_ended", {
      player_tag: "#2PP0V90Y",
      reason: "verified_elsewhere",
      was_primary: false,
      relationship: "alt",
      count: 1,
    }),
  );
  assert.match(
    alt,
    /another account verified #2PP0V90Y, so it is no longer your alt\./,
  );
  assert.match(
    itemText(item("claim_ended", { count: 2, was_primary: false })),
    /2 of your players were verified by other accounts/,
  );
  assert.match(
    itemText(
      item("claim_refused", {
        player_tag: "#9VUP08YL",
        reason: "verified_elsewhere",
      }),
    ),
    /#9VUP08YL, the player tag you signed up with, is verified by another account, so it was not added\./,
  );
});
