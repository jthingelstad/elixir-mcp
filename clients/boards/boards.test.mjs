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
let memberKind = "player";
let memberScope = "activity";

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
      if (name === "rankings_players") {
        // The recorded board, paged the way the door pages it.
        const all = boardItems.map((i) => ({
          rank: i.rank,
          player_tag: i.tag,
          name: i.name,
          rating: i.eloRating ?? null,
          clan_tag: i.clan?.tag ?? null,
          clan_name: i.clan?.name ?? null,
        }));
        const offset = args.offset ?? 0;
        result = {
          structuredContent: {
            snapshot: all.length ? { entries: all.length } : null,
            players: all.slice(offset, offset + (args.limit ?? 100)),
          },
        };
      } else if (name === "rankings_clans") {
        // The hub's aggregate: count over the whole board, ties by best rank.
        const by = new Map();
        for (const i of boardItems) {
          if (!i.clan) continue;
          const c = by.get(i.clan.tag) ?? {
            clan_tag: i.clan.tag,
            clan_name: i.clan.name,
            rated_players: 0,
            best_rank: Infinity,
          };
          c.rated_players += 1;
          c.best_rank = Math.min(c.best_rank, i.rank);
          by.set(i.clan.tag, c);
        }
        const clans = [...by.values()]
          .sort(
            (a, b) =>
              b.rated_players - a.rated_players || a.best_rank - b.best_rank,
          )
          .slice(0, args.limit ?? 25)
          .map((c, n) => ({ ...c, rank: n + 1 }));
        result = { structuredContent: { clans } };
      } else if (name === "collections_get") {
        result = {
          structuredContent: { kind: memberKind, scope: memberScope, members },
        };
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
  location: "global",
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

test("the board is read in pages and reassembled whole", async () => {
  const { syncBoard } = await import("./boards.mjs");
  seen = [];
  // 12 places against a 10-place board: the client pages the record at
  // 500 a call, so one call here — but the shape is what is pinned: the
  // top 10 of a board that is longer than 10.
  boardItems = ranked(12);
  members = [];
  memberKind = "player";
  memberScope = "activity";

  const out = await syncBoard(board, { dryRun: false });
  assert.equal(out.size, 10, JSON.stringify(out));
  const reads = seen.filter((c) => c.params.name === "rankings_players");
  assert.equal(reads.length, 1);
  assert.equal(reads[0].params.arguments.location, "global");
  assert.equal(reads[0].params.arguments.limit, 500);
  const edit = seen.find((c) => c.params.name === "collections_edit");
  assert.ok(edit.params.arguments.tags.every((t) => t.startsWith("#")));
});

/**
 * The derived clan board. Counted over the WHOLE ranking, not a top-N
 * slice; ties at the cutoff go to the clan whose best player is placed
 * highest; and a collection of the wrong kind or the wrong scope is
 * refused here, in words, rather than by the door.
 */
const clanBoard = {
  slug: "global-top-10-clans",
  location: "global",
  derive: "clans",
  top: 2,
};
const inClan = (i, clanTag, clanName) => ({
  ...ranked(1)[0],
  tag: tagFor(i),
  rank: i + 1,
  clan: { tag: clanTag, name: clanName },
});

test("clans are ranked by rated players, ties by best-placed member", async () => {
  const { syncBoard } = await import("./boards.mjs");
  seen = [];
  // Alpha has 3, Beta and Gamma have 2 each; Gamma's best is #1, Beta's #5.
  boardItems = [
    inClan(0, "#2GGG", "Gamma"),
    inClan(1, "#2PPP", "Alpha"),
    inClan(2, "#2PPP", "Alpha"),
    inClan(3, "#2PPP", "Alpha"),
    inClan(4, "#2YYY", "Beta"),
    inClan(5, "#2GGG", "Gamma"),
    inClan(6, "#2YYY", "Beta"),
    { ...ranked(1)[0], tag: tagFor(7), rank: 8 }, // no clan: not counted
  ];
  members = [];
  memberKind = "clan";
  memberScope = "activity";

  const out = await syncBoard(clanBoard, { dryRun: false });
  assert.equal(out.kind, "clan");
  assert.deepEqual(
    out.adding.map((c) => [c.name, c.count, c.best]),
    [
      ["Alpha", 3, 2],
      ["Gamma", 2, 1],
    ],
    "Gamma takes the tie over Beta on its #1 player",
  );
  const edit = seen.find((c) => c.params.name === "collections_edit");
  assert.deepEqual(edit.params.arguments.tags, ["#2PPP", "#2GGG"]);
});

test("a clan board into a player collection is refused in words", async () => {
  const { syncBoard } = await import("./boards.mjs");
  seen = [];
  boardItems = [inClan(0, "#2PPP", "Alpha")];
  members = [];
  memberKind = "player";
  memberScope = "activity";
  const out = await syncBoard(clanBoard, { dryRun: false });
  assert.match(out.skipped, /kind player/);
  assert.equal(
    seen.filter((c) => c.params.name === "collections_edit").length,
    0,
  );
});

test("a comprehensive clan collection is refused: that is every member's battles", async () => {
  const { syncBoard } = await import("./boards.mjs");
  seen = [];
  boardItems = [inClan(0, "#2PPP", "Alpha")];
  members = [];
  memberKind = "clan";
  memberScope = "comprehensive";
  const out = await syncBoard(clanBoard, { dryRun: false });
  assert.match(out.skipped, /comprehensive/);
  assert.equal(
    seen.filter((c) => c.params.name === "collections_edit").length,
    0,
  );
});

test("two collections on one board read the record once each way, never the game", async () => {
  const { syncBoard, BOARDS } = await import("./boards.mjs");
  seen = [];
  boardItems = ranked(30).map((i, n) => inClan(n, "#2PPP", "Alpha"));
  members = [];
  memberKind = "player";
  memberScope = "activity";
  const fetched = new Map(); // the run's cache, shared by both boards
  await syncBoard(board, { dryRun: true, fetched });
  await syncBoard(board, { dryRun: true, fetched }); // a second player board on the same ranking
  memberKind = "clan";
  await syncBoard(
    { ...clanBoard, location: board.location },
    { dryRun: true, fetched },
  );
  const players = seen.filter((c) => c.params.name === "rankings_players");
  const clans = seen.filter((c) => c.params.name === "rankings_clans");
  assert.equal(
    players.length,
    1,
    "the ranking was read once for both player boards",
  );
  assert.equal(clans.length, 1);
  assert.equal(
    seen.filter((c) => c.params.name === "live_fetch").length,
    0,
    "nothing reaches the game",
  );
  assert.ok(BOARDS.some((b) => b.derive === "clans"));
});
