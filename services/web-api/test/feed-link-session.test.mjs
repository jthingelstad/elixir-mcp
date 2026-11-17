/** The RSS feed's link for a sitting is its session page (2026-11-16);
 *  every other item opens where it did. Names escaped. Invented tags. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRss } from "../src/feed-link.mjs";

const ORIGIN = "https://elixir.poapkings.com";
const sitting = {
  id: "tl_0000000000000000c001",
  kind: "battle_session",
  at: "2026-11-16T16:00:00.000Z",
  text: `<b>Bo</b> & "Co" won 5 of 6.`,
  subjects: [{ kind: "player", tag: "#0YRL2GQP", name: `<b>Bo</b> & "Co"` }],
  evidence: { kind: "session" },
  facts: { player_tag: "#0YRL2GQP", started_at: "2026-11-16T15:02:00.000Z" },
};

test("a sitting opens its session page; an old row its player", () => {
  const xml = renderRss([sitting], { now: new Date("2026-11-16T17:00:00Z") });
  assert.ok(
    xml.includes(
      `<link>${ORIGIN}/home/player/0YRL2GQP/session/tl_0000000000000000c001?at=2026-11-16T15%3A02%3A00.000Z</link>`,
    ),
  );
  assert.ok(!xml.includes("<b>"));
  assert.ok(xml.includes("&lt;b&gt;Bo&lt;/b&gt; &amp; &quot;Co&quot;"));
  const old = renderRss([{ ...sitting, evidence: null }]);
  assert.ok(old.includes(`<link>${ORIGIN}/home/player/0YRL2GQP</link>`));
});
