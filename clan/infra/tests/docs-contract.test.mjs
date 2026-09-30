import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the weekly clan report has one status across the product contract", async () => {
  const [agents, vision, notes] = await Promise.all([
    read("AGENTS.md"),
    read("docs/VISION.md"),
    read("docs/NOTES.md"),
  ]);

  assert.match(
    agents,
    /The weekly clan report is a page \(The week\); its email waits on Elixir's mail kind for it\./,
  );
  assert.match(vision, /weekly clan\s+report by email is next\./);
  assert.match(notes, /The weekly clan report is its own later round\./);
  assert.match(notes, /The week: the weekly clan report, as a page/);
  assert.doesNotMatch(agents, /weekly digest/);
});

test("unverified claimers have one ratified membership contract", async () => {
  const [agents, vision, chooser, notes] = await Promise.all([
    read("AGENTS.md"),
    read("docs/VISION.md"),
    read("apps/web/src/views/Clans.jsx"),
    read("docs/NOTES.md"),
  ]);

  assert.match(agents, /\*\*Unverified players are members/);
  assert.match(vision, /claimed players is in it, verified or not/);
  assert.match(
    chooser,
    /An unverified player is a member here whatever its role in the game/,
  );
  assert.match(
    notes,
    /Confirmed by Jamie on 2026-09-30: an unverified member only\s+reads/,
  );
  assert.doesNotMatch(vision, /only when their verified player is in it/);
  assert.doesNotMatch(
    notes,
    /Defaults chosen here, for Jamie to confirm: an unverified member/,
  );
});

test("the open family-name decision names Clan's current location", async () => {
  const notes = await read("docs/NOTES.md");
  const waiting = notes.match(
    /## Waiting on Jamie\n(?<items>[\s\S]*?)\n## Open/,
  )?.groups?.items;

  assert.ok(waiting, "waiting-on-Jamie section is present");
  assert.match(waiting, /lives at `elixir\.poapkings\.com\/clan`/);
  assert.doesNotMatch(waiting, /lives at `clan\.poapkings\.com`/);
});
