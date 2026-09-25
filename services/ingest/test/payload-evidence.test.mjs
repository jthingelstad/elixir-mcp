import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  EVIDENCE_ENUMS,
  GAME_CONTENT_NAME_PATHS,
  createEvidence,
} from "../src/payload-evidence.mjs";
import { PAYLOAD_KEYS, payloadPaths } from "../src/payload-keys.mjs";
import { repoRoot } from "./helpers.mjs";

test("evidence leaves use the manifest's path grammar (every payloadPaths leaf is an evidence path)", async () => {
  const root = path.join(repoRoot, "fixtures");
  let walked = 0;
  for (const endpoint of await readdir(root)) {
    if (!PAYLOAD_KEYS[endpoint]) continue;
    for (const file of await readdir(path.join(root, endpoint))) {
      if (!file.endsWith(".json")) continue;
      const payload = JSON.parse(
        await readFile(path.join(root, endpoint, file), "utf8"),
      );
      const ev = createEvidence(endpoint);
      ev.add(payload, "2026-09-25");
      const got = new Set(ev.toJSON().paths.map((p) => p.path));
      for (const leaf of payloadPaths(payload))
        assert.ok(got.has(leaf), `${endpoint}/${file}: ${leaf} missing`);
      walked += 1;
    }
  }
  assert.ok(walked >= 5, `walked ${walked} fixtures`);
});

test("absent, null and empty are told apart, and each path knows its first and last archive day", () => {
  const ev = createEvidence("player");
  ev.add(
    { tag: "#A", clan: { tag: "#C" }, badges: [] },
    "2026-09-01",
    "entity=A",
  );
  ev.add(
    { tag: "#B", clan: null, badges: [{ name: "Classic12Wins" }] },
    "2026-09-03",
    "entity=B",
  );
  ev.add({ tag: "#A", badges: [] }, "2026-09-02", "entity=A");
  const out = ev.toJSON();
  const at = (p) => out.paths.find((x) => x.path === p);
  assert.equal(out.objects, 3);
  // Entities are counted, never listed.
  assert.equal(out.entities, 2);
  assert.equal(at("clan").entities, 2);
  assert.equal(at("badges[].name").entities, 1);
  assert.ok(!JSON.stringify(out).includes("entity=A"));
  assert.deepEqual(out.dt_range, { first: "2026-09-01", last: "2026-09-03" });
  // clan: present twice (once an object, once null), absent once.
  assert.deepEqual(at("clan").types, { object: 1, null: 1 });
  assert.equal(at("clan").seen, 2);
  assert.equal(at("clan.tag").seen, 1);
  // badges: always an array, empty twice.
  assert.equal(at("badges").empty, 2);
  assert.equal(at("badges[]").seen, 1);
  assert.equal(at("badges[].name").first_dt, "2026-09-03");
  assert.equal(at("badges").first_dt, "2026-09-01");
  assert.equal(at("badges").last_dt, "2026-09-03");
});

test("values are collected only on the enum allowlist, with counts and days", () => {
  const ev = createEvidence("player_battlelog");
  ev.add(
    [
      {
        type: "PvP",
        gameMode: { id: 72000006, name: "Ladder" },
        team: [{ tag: "#A", name: "Someone" }],
      },
      {
        type: "boatBattle",
        gameMode: { id: 72000006, name: "Ladder" },
        boatBattleSide: "defender",
      },
    ],
    "2026-09-24",
  );
  ev.add(
    [{ type: "PvP", gameMode: { id: 72000464, name: "Ranked1v1" } }],
    "2026-09-25",
  );
  const { enums } = ev.toJSON();
  assert.deepEqual(
    enums["[].type"].values.map((v) => [v.value, v.count]),
    [
      ["PvP", 2],
      ["boatBattle", 1],
    ],
  );
  assert.equal(enums["[].gameMode.id"].values[0].value, "72000006");
  assert.equal(
    enums["[].gameMode.id"].values.find((v) => v.value === "72000464").first_dt,
    "2026-09-25",
  );
  assert.equal(
    enums["[].team[].name"],
    undefined,
    "a player name is never a value",
  );
  assert.equal(enums["[].team[].tag"], undefined, "a tag is never a value");
});

test("a map's keys are values when the map path is on the allowlist", () => {
  const ev = createEvidence("player");
  ev.add(
    {
      progress: {
        "seasonal-trophy-road-202609": { trophies: 1 },
        AutoChess_2026_Aug: { trophies: 2 },
      },
    },
    "2026-09-25",
  );
  const { enums, paths } = ev.toJSON();
  assert.deepEqual(enums["progress.*"].values.map((v) => v.value).sort(), [
    "AutoChess_2026_Aug",
    "seasonal-trophy-road-202609",
  ]);
  assert.ok(paths.some((p) => p.path === "progress.*.trophies"));
});

test("the enum allowlist never enumerates a tag or a person's or clan's name (the reference is public)", () => {
  for (const [endpoint, list] of Object.entries(EVIDENCE_ENUMS)) {
    assert.ok(PAYLOAD_KEYS[endpoint], `${endpoint} is not a manifest endpoint`);
    for (const p of list) {
      if (!/(^|\.|\])(tag|name)$/.test(p)) continue;
      assert.ok(
        GAME_CONTENT_NAME_PATHS.has(`${endpoint}:${p}`),
        `${endpoint}:${p} would publish identities; allow it only if it is game content`,
      );
    }
  }
});

test("a leaf the manifest does not know is UNCATALOGUED; a container is not", () => {
  const ev = createEvidence("cards");
  ev.add({ items: [{ id: 1, brandNewField: 3 }] }, "2026-09-25");
  const by = Object.fromEntries(ev.toJSON().paths.map((p) => [p.path, p]));
  assert.equal(by["items[].brandNewField"].disposition, "UNCATALOGUED");
  assert.equal(by["items"].disposition, "container");
  assert.equal(by["items[]"].disposition, "container");
});
