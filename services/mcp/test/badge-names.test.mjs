import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeLabel, masteryCard } from "../src/badge-names.mjs";

test("Mastery badges name the card a player knows, codename or not", () => {
  assert.equal(badgeLabel("MasterySkeletonWarriors"), "Guards Mastery");
  assert.equal(badgeLabel("MasteryHogRider"), "Hog Rider Mastery");
  assert.equal(badgeLabel("MasteryAxeMan"), "Executioner Mastery");
  assert.equal(badgeLabel("MasteryRageBarbarian"), "Lumberjack Mastery");
  assert.equal(badgeLabel("MasteryXbow"), "X-Bow Mastery");
  assert.equal(badgeLabel("MasteryLog"), "The Log Mastery");
  assert.equal(badgeLabel("MasteryMiniPekka"), "Mini P.E.K.K.A Mastery");
  assert.equal(
    badgeLabel("MasteryElixir Collector"),
    "Elixir Collector Mastery",
  );
  assert.equal(masteryCard("MasteryDartBarrell"), "Flying Machine");
  assert.equal(masteryCard("Crl20Wins2024"), null);
});

test("the other badges read as words, with the API's suffixes dropped", () => {
  assert.equal(badgeLabel("Crl20Wins2024"), "CRL 20 Wins 2024");
  assert.equal(badgeLabel("CrlSpectator2025"), "CRL Spectator 2025");
  assert.equal(badgeLabel("SeasonalBadge_202509"), "Season September 2025");
  assert.equal(badgeLabel("SeasonalBadge_202507_v2"), "Season July 2025");
  assert.equal(
    badgeLabel("MergeTacticsBadge_202506"),
    "Merge Tactics June 2025",
  );
  assert.equal(badgeLabel("RoyalTournamentRank_v2"), "Royal Tournament Rank");
  assert.equal(badgeLabel("CrazyArenaBadge3"), "Crazy Arena Badge 3");
  assert.equal(badgeLabel("2026YearBadge"), "2026 Year Badge");
  assert.equal(badgeLabel("2xElixir"), "Double Elixir");
  assert.equal(badgeLabel("Grand12Wins"), "Grand Challenge 12 Wins");
  assert.equal(badgeLabel("Royals2v2_2024"), "Royals 2v2 2024");
  assert.equal(badgeLabel("ClanWarsVeteran"), "Clan Wars Veteran");
  // Unknown shapes never throw and never come back as the identifier alone.
  assert.equal(badgeLabel("SomethingNewBadge"), "Something New");
  assert.equal(badgeLabel(""), "");
  assert.equal(badgeLabel(null), "");
});
