/**
 * The client, against a fake door.
 *
 * There is no credential in this repo that can reach the real one — the
 * Discord consumer's token is bound to its own agent door and answers
 * `wrong_resource` at /mcp, which is the principal binding working — so
 * the server is stubbed here and the things worth pinning are the ones
 * that would quietly corrupt a collection: the shape of the payload we
 * read, and the refusal to write a board that came back short.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

let server;
let seen;
let boardItems;
let members;

/** The two tools this client calls, answered the way the door answers. */
before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const call = JSON.parse(body);
      seen.push(call);
      const { name, arguments: args } = call.params;
      let result;
      if (name === "live_fetch") {
        result = { structuredContent: { payload: { items: boardItems } } };
      } else if (name === "collections_get") {
        result = { structuredContent: { members } };
      } else if (name === "collections_edit") {
        result = {
          structuredContent: {
            added: args.tags.length,
            total: args.tags.length,
          },
        };
      } else {
        result = { isError: true, content: [{ text: `unknown tool ${name}` }] };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.ELIXIR_MCP_URL = `http://127.0.0.1:${server.address().port}/mcp`;
  process.env.ELIXIR_MCP_TOKEN = "svt_test";
});
after(() => server.close());

const board = {
  slug: "pol-global-top-100",
  path: "/locations/global/pathoflegend/players",
  top: 10,
};
/** Tags from the real CR alphabet (0289PYLQGRJCUV): the first fixtures
 *  here used A and B, the client dropped every one of them as malformed,
 *  and it was right to. */
const ALPHABET = "0289PYLQGRJCUV";
const tagFor = (i) =>
  `#2P0${ALPHABET[Math.floor(i / ALPHABET.length) % ALPHABET.length]}${ALPHABET[i % ALPHABET.length]}`;
const ranked = (n) =>
  Array.from({ length: n }, (_, i) => ({
    tag: tagFor(i),
    name: `p${i}`,
    rank: i + 1,
  }));

test("a full board replaces the membership with exactly today's players", async () => {
  const { syncBoard } = await import("./boards.mjs");
  seen = [];
  boardItems = ranked(25);
  members = [{ player_tag: tagFor(0) }, { player_tag: "#2PLLGQ" }];

  const out = await syncBoard(board, { dryRun: false });
  // Ranked order, cut to the board's size.
  assert.equal(out.size, 10);
  assert.equal(out.dropping.length, 1, "the player who fell off is dropped");
  assert.equal(out.dropping[0].tag, "#2PLLGQ");
  assert.equal(out.adding.length, 9);
  // Named, ranked, placed: the report says WHO moved, not how many.
  assert.equal(out.adding[0].name, "p1");
  assert.equal(out.adding[0].rank, 2);

  const edit = seen.find((c) => c.params.name === "collections_edit");
  assert.equal(
    edit.params.arguments.action,
    "set",
    "add would accumulate forever",
  );
  assert.equal(edit.params.arguments.tags.length, 10);
  assert.equal(edit.params.arguments.tags[0], tagFor(0));
});

test("a board that collapsed against the held set is not written", async () => {
  const { syncBoard } = await import("./boards.mjs");
  seen = [];
  // A season boundary resets everyone below the rating floor: a hundred
  // members yesterday, three today. Writing that through would stop
  // ninety-seven recordings tonight and restart them over the fortnight.
  boardItems = ranked(3);
  members = ranked(100).map((i) => ({ player_tag: i.tag }));

  const out = await syncBoard(board, { dryRun: false });
  assert.match(out.skipped, /collapsed/);
  assert.equal(
    seen.filter((c) => c.params.name === "collections_edit").length,
    0,
  );
});

test("a small board into a small collection is simply the truth", async () => {
  const { syncBoard } = await import("./boards.mjs");
  seen = [];
  // Early in a season every regional board is small — Japan had 34
  // players on day 3, India 4 — and a collection that starts empty takes
  // what is there rather than waiting for a hundred that may never come.
  boardItems = ranked(4);
  members = [];

  const out = await syncBoard(board, { dryRun: false });
  assert.equal(out.size, 4);
  assert.equal(
    seen.filter((c) => c.params.name === "collections_edit").length,
    1,
  );
});

test("an empty board is never written, whatever is held", async () => {
  const { syncBoard } = await import("./boards.mjs");
  seen = [];
  boardItems = [];
  members = [{ player_tag: tagFor(0) }];

  const out = await syncBoard(board, { dryRun: false });
  assert.match(out.skipped, /empty/);
  assert.equal(
    seen.filter((c) => c.params.name === "collections_edit").length,
    0,
  );
});

test("a dry run reports the move and writes nothing", async () => {
  const { syncBoard } = await import("./boards.mjs");
  seen = [];
  boardItems = ranked(25);
  members = [{ player_tag: tagFor(0) }];

  const out = await syncBoard(board, { dryRun: true });
  assert.equal(out.dryRun, true);
  assert.equal(out.adding.length, 9);
  assert.equal(
    seen.filter((c) => c.params.name === "collections_edit").length,
    0,
  );
});

test("a malformed tag in the payload is dropped, not passed on", async () => {
  const { syncBoard } = await import("./boards.mjs");
  seen = [];
  boardItems = [...ranked(12), { tag: "not-a-tag" }, { name: "no tag at all" }];
  members = [];

  const out = await syncBoard(board, { dryRun: false });
  assert.equal(out.size, 10);
  const edit = seen.find((c) => c.params.name === "collections_edit");
  assert.ok(edit.params.arguments.tags.every((t) => t.startsWith("#")));
});
