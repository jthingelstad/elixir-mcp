import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { clanImport } from "../src/ops-clan-import.mjs";
let scratch;
before(async () => {
  scratch = await scratchDb("clan_import_op");
});
after(async () => scratch?.drop());
const key = "clan-migration/v1/00000000-0000-0000-0000-000000000001.json";
const base = () => ({
  version: 1,
  source: {
    frozen: true,
    freeze_completed_at: new Date(Date.now() - 400000).toISOString(),
    exported_at: new Date().toISOString(),
  },
  items: [{ pk: "pref##P0LYQ", clan_tag: "#P2LQ0" }],
});
function object(snapshot) {
  const bytes = Buffer.from(JSON.stringify(snapshot));
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    s3: {
      send: async () => ({
        ContentLength: bytes.length,
        Body: { transformToByteArray: async () => bytes },
      }),
    },
  };
}
test("private import op previews, applies and compares without returning private bodies", async () => {
  const { sha256, s3 } = object(base());
  const settings = { bucket: "fixture", s3 };
  const preview = await clanImport(scratch.url, { key, sha256 }, settings);
  assert.equal(preview.applied, false);
  assert.equal(
    (await scratch.db.query("select count(*)::int as n from clan_state"))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await clanImport(scratch.url, { key, sha256, apply: true }, settings))
      .applied,
    true,
  );
  const compared = await clanImport(
    scratch.url,
    { key, sha256, compare: true },
    settings,
  );
  assert.equal(compared.equal, true);
  assert.equal(JSON.stringify(compared).includes("#P2LQ0"), false);
});
test("freeze bypasses, NaN timestamps, future exports and short quiet periods refuse before DB I/O", async () => {
  for (const source of [
    { frozen: false },
    {
      frozen: true,
      freeze_completed_at: "invalid",
      exported_at: new Date().toISOString(),
    },
    {
      frozen: true,
      freeze_completed_at: new Date(Date.now() - 400000).toISOString(),
      exported_at: "invalid",
    },
    {
      frozen: true,
      freeze_completed_at: new Date().toISOString(),
      exported_at: new Date().toISOString(),
    },
    {
      frozen: true,
      freeze_completed_at: new Date().toISOString(),
      exported_at: new Date(Date.now() + 400000).toISOString(),
    },
  ]) {
    const { sha256, s3 } = object({ ...base(), source });
    await assert.rejects(
      clanImport(
        "invalid://never-connect",
        { key, sha256, apply: true },
        { bucket: "fixture", s3 },
      ),
      /frozen snapshot/,
    );
  }
});
