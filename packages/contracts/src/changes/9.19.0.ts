import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.19.0",
  date: "2026-10-02",
  summary: md(
    "A boat battle's `boat` carries `role`: this row's player's part, `attacker` or `defender`. `side` is the API's `boatBattleSide` as the log that recorded the battle said it, for that log's own player, so on a row for the other player it named their opponent's part. A sweep that read `side` as yours filed some boat attacks as defenses and some defenses as attacks. Read `role`; a defense is still not the member's battle. Compact keeps both. The JSON API's `GET /players/{tag}/battles` carries it too (2.10.0). Additive.",
  ),
} satisfies ChangelogEntry;
