import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveInventory } from "../../../infra/scripts/right-sizing-archive.mjs";
const cutoff = "2026-10-02T00:00:00.000Z";
const version = (version_id, time = "2026-01-01") => ({
  Key: "payloads/endpoint=player_battlelog/entity=P0LYQ/a.gz",
  VersionId: version_id,
  LastModified: new Date(time),
  Size: 12,
  IsLatest: false,
});
test("version inventory exhausts both pagination markers and keeps delete markers", async () => {
  const calls = [],
    lines = [];
  let n = 0;
  const s3 = {
    send: async (c) => {
      calls.push(c.input);
      if (c.constructor.name === "GetBucketVersioningCommand")
        return { Status: "Enabled" };
      return n++ === 0
        ? {
            Versions: [version("one")],
            DeleteMarkers: [version("delete")],
            IsTruncated: true,
            NextKeyMarker: "key",
            NextVersionIdMarker: "one",
          }
        : {
            Versions: [version("two"), version("new", "2026-10-03")],
            IsTruncated: false,
          };
    },
  };
  const r = await archiveInventory({
    s3,
    bucket: "private",
    cutoff,
    write: async (l) => lines.push(l),
  });
  assert.deepEqual(calls[2], {
    Bucket: "private",
    Prefix: "payloads/",
    MaxKeys: 1000,
    KeyMarker: "key",
    VersionIdMarker: "one",
  });
  assert.equal(r.versions, 2);
  assert.equal(r.markers, 1);
  assert.equal(r.newer, 1);
  assert.equal(r.bytes, 24);
  assert.equal(r.complete, true);
  assert.equal(lines.length, 3);
  assert.match(r.sha256, /^[a-f0-9]{64}$/);
});
test("incomplete version identity and missing completion proof refuse", async () => {
  for (const response of [
    {
      Versions: [{ ...version("a"), VersionId: undefined }],
      IsTruncated: false,
    },
    { Versions: [] },
    { Versions: [], IsTruncated: true },
    {
      Versions: [],
      IsTruncated: true,
      NextKeyMarker: "same",
      NextVersionIdMarker: "same",
    },
  ]) {
    const s3 = {
      send: async (c) =>
        c.constructor.name === "GetBucketVersioningCommand"
          ? { Status: "Enabled" }
          : response,
    };
    await assert.rejects(
      archiveInventory({
        s3,
        bucket: "private",
        cutoff,
        write: async () => {},
      }),
    );
  }
});
