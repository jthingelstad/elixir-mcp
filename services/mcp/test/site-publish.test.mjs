/**
 * Publishing the site (infra/scripts/lib/site-publish.mjs; #73,
 * 2026-10-21): what is uploaded, in what order, with which headers, and
 * which assets the prune may take. S3 is a fake keyed by command name;
 * nothing here reaches AWS.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_TYPES,
  IMMUTABLE,
  REVALIDATE,
  SITE_ASSETS_PREFIX,
  contentType,
  eachLimit,
  etagMd5,
  hashedAssets,
  md5,
  publish,
  publishPlan,
  pruneCandidates,
  readPublished,
  referencedAssets,
  siteAssetsKey,
} from "../../../infra/scripts/lib/site-publish.mjs";

// One `s3 sync --delete` with no Cache-Control removed the old build's
// lazy chunks while an open console, or an edge still holding the old
// app.html, could ask for them: a blank page mid-session (#73).
const VITE_OUT = [
  "AccountPage-C3FTy2qB.js",
  "index-BTm8TzAt.js",
  "index-DQxSyd3a.css",
  "tag-url-DSiL-xl4.js",
];

test("publish: only Vite's content-hashed chunks are immutable (#73)", () => {
  const hashed = hashedAssets(
    [
      ...VITE_OUT.map((f) => `assets/${f}`),
      // The site's own assets keep one name and are busted by ?v=, which
      // the edge's cache key ignores: they must revalidate.
      "assets/site.css",
      "assets/chrome-menu.js",
      "assets/rail-anchors.js",
      "assets/updates-filter.js",
      "assets/fonts/Clash_Regular.otf",
      "assets/cards/26000000_evo.png",
      "index.html",
    ],
    [...VITE_OUT, "fonts"],
  );
  assert.deepEqual(
    [...hashed].sort(),
    VITE_OUT.map((f) => `assets/${f}`).sort(),
  );
  // A name that merely looks hashed but did not come from Vite is not.
  assert.deepEqual([...hashedAssets(["assets/some-abcdefgh.js"], [])], []);
});

test("publish: each kind of file keeps the type the bucket gave it, and every .txt names its charset", () => {
  // Read from the bucket 2026-10-21: what `aws s3 sync` typed each kind.
  for (const [rel, type] of [
    ["index.html", "text/html"],
    ["docs/tools/index.html", "text/html"],
    ["assets/site.css", "text/css"],
    ["assets/index-BTm8TzAt.js", "text/javascript"],
    ["tools.json", "application/json"],
    ["sitemap.xml", "application/xml"],
    ["README.md", "text/markdown"],
    ["assets/elixir-logo-96.webp", "image/webp"],
    ["assets/cards/26000000_evo.png", "image/png"],
    ["favicon.ico", "image/x-icon"],
    ["assets/fonts/Inter-latin.woff2", "font/woff2"],
    ["assets/fonts/Clash_Regular.otf", "font/otf"],
    // llms.txt read as Latin-1 showed "adding â€¦" (2026-09-10).
    ["llms.txt", "text/plain; charset=utf-8"],
    ["assets/fonts/Inter-OFL.txt", "text/plain; charset=utf-8"],
  ])
    assert.equal(contentType(rel), type, rel);
  assert.equal(contentType("LICENSE"), undefined);
  assert.equal(contentType("assets/v1.2/file"), undefined);
  assert.equal(contentType("image.svg"), undefined);
  assert.equal(contentType("SHOUT.HTML"), "text/html");
  assert.equal(Object.keys(CONTENT_TYPES).length, 12);
});

const sum = (text) => md5(Buffer.from(text));
const entry = (rel, text, cacheControl = REVALIDATE) => ({
  md5: sum(text),
  contentType: contentType(rel),
  cacheControl,
});

test("publish: only a change is uploaded; assets first, documents next, and only documents are removed", () => {
  const hashed = new Set(["assets/index-BTm8TzAt.js"]);
  const files = [
    { rel: "index.html", md5: sum("home v2") },
    { rel: "llms.txt", md5: sum("llms") },
    { rel: "docs/index.html", md5: sum("docs") },
    { rel: "assets/site.css", md5: sum("css") },
    { rel: "assets/index-BTm8TzAt.js", md5: sum("chunk") },
    { rel: "assets/cards/1.png", md5: sum("card") },
  ];
  const listing = new Map([
    ["index.html", { etag: sum("home v1") }], // content changed
    ["llms.txt", { etag: sum("llms") }], // same, record vouches
    ["docs/index.html", { etag: sum("docs") }], // same, no record: HEAD
    ["assets/site.css", { etag: sum("css") }], // same, record's headers differ
    ["assets/cards/1.png", { etag: null }], // multipart: not an MD5
    ["old/index.html", { etag: sum("old") }], // gone from the build
    ["assets/index-OLD00000.js", { etag: sum("old chunk") }], // never removed here
  ]);
  const published = {
    "llms.txt": entry("llms.txt", "llms"),
    "assets/site.css": {
      ...entry("assets/site.css", "css"),
      cacheControl: IMMUTABLE,
    },
  };
  const plan = publishPlan({
    files,
    listing,
    published,
    hashed,
    removeMissing: true,
  });
  assert.deepEqual(
    plan.upload.map((w) => [w.rel, w.cacheControl]),
    [
      ["assets/index-BTm8TzAt.js", IMMUTABLE],
      ["assets/cards/1.png", REVALIDATE],
      ["index.html", REVALIDATE],
    ],
  );
  assert.deepEqual(
    plan.confirm.map((w) => w.rel),
    ["assets/site.css", "docs/index.html"],
  );
  assert.deepEqual(
    plan.unchanged.map((w) => w.rel),
    ["llms.txt"],
  );
  assert.deepEqual(plan.remove, ["old/index.html"]);
  // The app's assets alone (the assets phase) never remove anything.
  assert.deepEqual(
    publishPlan({ files, listing, published, hashed }).remove,
    [],
  );
  // A file with no content type is refused, never guessed.
  assert.throws(
    () =>
      publishPlan({
        files: [{ rel: "logo.svg", md5: sum("svg") }],
        listing: new Map(),
        published: {},
        hashed,
      }),
    /no content type for logo\.svg/,
  );
  assert.equal(etagMd5(`"${sum("x")}"`), sum("x"));
  assert.equal(etagMd5('"0123456789abcdef0123456789abcdef-3"'), null);
  assert.equal(etagMd5(undefined), null);
});

/** S3 as a map of objects, recording every call; PUTs can be held. */
function fakeS3(objects = new Map()) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    objects,
    calls,
    get maxInFlight() {
      return maxInFlight;
    },
    async send(command) {
      const name = command.constructor.name;
      const input = command.input;
      calls.push([name, input.Key ?? input.Prefix ?? null]);
      switch (name) {
        case "HeadObjectCommand": {
          const o = objects.get(input.Key);
          if (!o) throw Object.assign(new Error(), { name: "NotFound" });
          return {
            ETag: `"${o.md5}"`,
            ContentType: o.contentType,
            CacheControl: o.cacheControl,
          };
        }
        case "PutObjectCommand": {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setImmediate(r));
          inFlight -= 1;
          objects.set(input.Key, {
            md5: md5(Buffer.from(input.Body)),
            contentType: input.ContentType,
            cacheControl: input.CacheControl,
            body: String(input.Body),
          });
          return {};
        }
        case "GetObjectCommand": {
          const o = objects.get(input.Key);
          if (!o)
            throw Object.assign(new Error("no such key"), {
              name: "NoSuchKey",
            });
          return { Body: { transformToString: async () => o.body } };
        }
        case "DeleteObjectsCommand":
          for (const { Key } of input.Delete.Objects) objects.delete(Key);
          return {};
        case "ListObjectsV2Command": {
          const keys = [...objects.keys()]
            .filter((k) => k.startsWith(input.Prefix ?? ""))
            .filter((k) => !input.StartAfter || k > input.StartAfter)
            .sort();
          return {
            Contents: keys.map((Key) => ({
              Key,
              ETag: `"${objects.get(Key).md5}"`,
              LastModified: objects.get(Key).lastModified ?? new Date(0),
            })),
            IsTruncated: false,
          };
        }
        default:
          throw new Error(`unexpected ${name}`);
      }
    },
  };
}

test("publish: HEAD settles what the record cannot; uploads go group by group, a bounded number at a time", async () => {
  const bodies = {
    "assets/a-AAAAAAAA.js": "a",
    "assets/b-BBBBBBBB.js": "b",
    "assets/site.css": "css",
    "index.html": "home",
    "docs/index.html": "docs",
    "about/index.html": "about",
  };
  const hashed = new Set(["assets/a-AAAAAAAA.js", "assets/b-BBBBBBBB.js"]);
  const s3 = fakeS3(
    new Map([
      // the right bytes and headers, unrecorded: HEAD confirms, no upload
      ["docs/index.html", entry("docs/index.html", "docs")],
      // the right bytes under the wrong headers: HEAD finds it, re-upload
      [
        "about/index.html",
        {
          ...entry("about/index.html", "about"),
          contentType: "binary/octet-stream",
        },
      ],
      ["gone.html", entry("gone.html", "gone")],
    ]),
  );
  const listing = new Map(
    [...s3.objects].map(([key, o]) => [key, { etag: o.md5 }]),
  );
  const plan = publishPlan({
    files: Object.entries(bodies).map(([rel, text]) => ({
      rel,
      md5: sum(text),
    })),
    listing,
    published: {},
    hashed,
    removeMissing: true,
  });
  const result = await publish({
    s3,
    bucket: "b",
    plan,
    read: async (rel) => Buffer.from(bodies[rel]),
    concurrency: 2,
  });
  const puts = s3.calls
    .filter(([n]) => n === "PutObjectCommand")
    .map(([, k]) => k);
  assert.deepEqual(puts.slice(0, 2).sort(), [
    "assets/a-AAAAAAAA.js",
    "assets/b-BBBBBBBB.js",
  ]);
  assert.equal(puts[2], "assets/site.css");
  assert.deepEqual(puts.slice(3).sort(), ["about/index.html", "index.html"]);
  // Two at a time, never more.
  assert.equal(s3.maxInFlight, 2);
  assert.deepEqual(
    s3.calls
      .filter(([n]) => n === "HeadObjectCommand")
      .map(([, k]) => k)
      .sort(),
    ["about/index.html", "docs/index.html"],
  );
  assert.ok(!s3.objects.has("gone.html"));
  assert.equal(s3.objects.get("assets/a-AAAAAAAA.js").cacheControl, IMMUTABLE);
  assert.equal(s3.objects.get("about/index.html").contentType, "text/html");
  assert.deepEqual(
    {
      uploaded: result.uploaded,
      confirmed: result.confirmed,
      unchanged: result.unchanged,
      removed: result.removed,
    },
    { uploaded: 5, confirmed: 1, unchanged: 0, removed: 1 },
  );
  // The entries are what the bucket now holds, so the next publish
  // uploads nothing and asks nothing.
  assert.deepEqual(
    Object.keys(result.entries).sort(),
    Object.keys(bodies).sort(),
  );
  const again = publishPlan({
    files: Object.entries(bodies).map(([rel, text]) => ({
      rel,
      md5: sum(text),
    })),
    listing: new Map([...s3.objects].map(([key, o]) => [key, { etag: o.md5 }])),
    published: result.entries,
    hashed,
    removeMissing: true,
  });
  assert.deepEqual(
    [again.upload.length, again.confirm.length, again.remove.length],
    [0, 0, 0],
  );
});

test("publish: a bounded pool stops at the first failure", async () => {
  let peak = 0;
  let running = 0;
  const seen = [];
  await assert.rejects(
    eachLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setImmediate(r));
      running -= 1;
      seen.push(n);
      if (n === 2) throw new Error("PUT failed");
    }),
    /PUT failed/,
  );
  assert.ok(peak <= 3);
  assert.ok(seen.length < 8, String(seen.length));
  await eachLimit([], 4, async () => assert.fail("ran"));
});

test("publish: a missing or unreadable record means HEAD, never a crash; any other error is one", async () => {
  const s3 = fakeS3();
  assert.deepEqual(await readPublished(s3, "code"), {});
  s3.objects.set("deploys/site-published.json", { body: "{not json" });
  assert.deepEqual(await readPublished(s3, "code"), {});
  s3.objects.set("deploys/site-published.json", {
    body: JSON.stringify({ objects: { "a.html": entry("a.html", "a") } }),
  });
  assert.deepEqual(Object.keys(await readPublished(s3, "code")), ["a.html"]);
  await assert.rejects(
    readPublished(
      {
        send: async () => {
          throw Object.assign(new Error("denied"), { name: "AccessDenied" });
        },
      },
      "code",
    ),
    /denied/,
  );
});

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-21T12:00:00Z");

test("prune: only an asset no deploy in the window shipped, not uploaded in it, and not in this build", () => {
  const objects = [
    // shipped by this build: kept however old
    { Key: "assets/index-NEW00000.js", LastModified: new Date(NOW - 90 * DAY) },
    // unchanged for months and dropped by this build, but a deploy last
    // week shipped it: an open tab from then may ask (the manifests)
    { Key: "assets/index-WEEK0000.js", LastModified: new Date(NOW - 60 * DAY) },
    // shipped by no deploy in the window, and old
    { Key: "assets/index-OLD00000.js", LastModified: new Date(NOW - 20 * DAY) },
    // uploaded yesterday, in no manifest (a manifest write that failed)
    { Key: "assets/index-RECENT00.js", LastModified: new Date(NOW - DAY) },
    // never under assets/: not the prune's business
    { Key: "index.html", LastModified: new Date(NOW - 90 * DAY) },
  ];
  const current = new Set(["assets/index-NEW00000.js"]);
  const referenced = new Set([
    "assets/index-NEW00000.js",
    "assets/index-WEEK0000.js",
  ]);
  assert.deepEqual(
    pruneCandidates({ objects, current, referenced, now: NOW, days: 14 }),
    ["assets/index-OLD00000.js"],
  );
  // An empty build prunes nothing: it is a broken build, not a new one.
  assert.deepEqual(
    pruneCandidates({
      objects,
      current: new Set(),
      referenced,
      now: NOW,
      days: 14,
    }),
    [],
  );
});

test("prune: the referenced assets come from every manifest in the window, and any doubt stops the prune", async () => {
  const sha = "f".repeat(40);
  const key = (daysAgo) =>
    siteAssetsKey(new Date(NOW - daysAgo * DAY).toISOString(), sha);
  const own = key(0);
  assert.equal(
    own,
    `${SITE_ASSETS_PREFIX}2026-10-21T12-00-00-000Z-${sha.slice(0, 12)}.json`,
  );
  const manifest = (assets) => ({ body: JSON.stringify({ sha, assets }) });
  const s3 = fakeS3(
    new Map([
      [key(20), manifest(["assets/ancient.js"])], // outside the window
      [key(13), manifest(["assets/last-week.js"])],
      [key(1), manifest(["assets/yesterday.js"])],
      [own, manifest(["assets/today.js"])],
    ]),
  );
  const referenced = await referencedAssets(s3, "code", {
    now: NOW,
    days: 14,
    own,
  });
  assert.deepEqual([...referenced].sort(), [
    "assets/last-week.js",
    "assets/today.js",
    "assets/yesterday.js",
  ]);
  // The listing starts at the window's edge, so old manifests cost nothing.
  assert.ok(
    !s3.calls.some(([n, k]) => n === "GetObjectCommand" && k === key(20)),
  );
  // This deploy's own manifest not listed: the view is not complete.
  await assert.rejects(
    referencedAssets(s3, "code", { now: NOW, days: 14, own: key(0.5) }),
    /is not listed/,
  );
  // A manifest that cannot be read, or lists nothing: no prune.
  s3.objects.set(key(2), { body: "{broken" });
  await assert.rejects(
    referencedAssets(s3, "code", { now: NOW, days: 14, own }),
  );
  s3.objects.set(key(2), { body: JSON.stringify({ sha }) });
  await assert.rejects(
    referencedAssets(s3, "code", { now: NOW, days: 14, own }),
    /lists no assets/,
  );
});
