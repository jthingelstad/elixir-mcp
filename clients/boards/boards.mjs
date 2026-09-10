#!/usr/bin/env node
/**
 * Leaderboard collections: keep a collection equal to a CR leaderboard.
 *
 * Some collections are hand-curated and always will be — Pros, Creators.
 * Others are a query somebody has to run every day. This is the second
 * kind, and it is deliberately a CLIENT: it uses nothing but the public
 * MCP surface, so Elixir MCP gains no leaderboard code, no scheduler
 * entry and no new table for it.
 *
 * TWO CALLS PER BOARD, both over one HTTP endpoint:
 *
 *   live_fetch      one raw GET against the CR API through the hub's live
 *                   lane, so no CR token lives here and this can run
 *                   anywhere. It spends one fetch from the shared budget.
 *   collections_edit action "set" replaces the membership with exactly
 *                   today's board. add/remove would leave last week's
 *                   players behind and the collection would slowly become
 *                   "everyone who was ever up there".
 *
 * The door is stateless JSON-RPC: no initialize handshake, no session id,
 * no SDK. A POST with a Bearer token is the whole client.
 *
 * WHAT IT COSTS. Collection membership is a recording reason, so every
 * player in one of these boards is recorded while they stay in it and
 * stops when they drop out (unless something else keeps them). A top-100
 * board is therefore about a hundred recorded players. That is the reason
 * this ships with ONE board and a --dry-run: measure the fetch rate for a
 * week before adding a second.
 *
 *   node boards.mjs --dry-run     say what would change, write nothing
 *   node boards.mjs               do it
 *   node boards.mjs --board=pol-global-top-100
 *
 * ELIXIR_TOKEN is a service token (svt_...) for an account that OWNS the
 * collections below; collections_edit refuses somebody else's.
 */
import { pathToFileURL } from "node:url";

const ENDPOINT =
  process.env.ELIXIR_MCP_URL ?? "https://elixir.poapkings.com/mcp";
const TOKEN = process.env.ELIXIR_TOKEN;

/**
 * The boards. Adding one is a line here, not a rewrite — but each one is
 * another hundred players recorded, so add them one at a time.
 *
 * `path` must be a live_fetch path: /locations/{id}/pathoflegend/players
 * or /locations/{id}/rankings/players, where {id} is `global` or a
 * numeric location. The game-mode boards (/leaderboards) are not on the
 * live lane's allowlist and cannot be reached from here yet.
 */
export const BOARDS = [
  {
    slug: "pol-global-top-100",
    path: "/locations/global/pathoflegend/players",
    top: 100,
    label: "Path of Legends · global",
  },
];

/** A board that comes back short is usually a season boundary, not news:
 *  the ranking is empty for the first hours of a season (cr-agent-api-docs,
 *  locations). Writing that as a `set` would empty the collection, so a
 *  board has to arrive at least this full to be believed. */
const MIN_FILL = 0.5;

/** The CR tag alphabet, copied from packages/contracts (CR_TAG_ALPHABET)
 *  rather than imported: this file is a standalone client with no
 *  dependencies, which is most of why it is easy to run anywhere. A tag
 *  the hub would refuse is dropped here instead of failing the whole
 *  call — one malformed entry in a leaderboard payload must not leave a
 *  collection unsynced. There is no letter O in the alphabet. */
const CANONICAL_TAG = /^#[0289PYLQGRJCUV]{3,12}$/;

async function rpc(method, params) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `${method}: non-JSON answer (HTTP ${res.status}): ${text.slice(0, 200)}`,
    );
  }
  if (body.error) {
    throw new Error(
      `${method}: ${body.error.message ?? JSON.stringify(body.error)}`,
    );
  }
  return body.result;
}

/** tools/call, unwrapped. Every tool answers structuredContent; the text
 *  block is the same object for a reader, so this prefers the structured
 *  one and falls back rather than assuming. */
async function call(name, args) {
  const result = await rpc("tools/call", { name, arguments: args });
  if (result?.isError) {
    const said = result.content?.[0]?.text ?? "refused";
    throw new Error(`${name}: ${said}`);
  }
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.[0]?.text;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

/** The board, newest read, as canonical tags in rank order. */
async function readBoard(board) {
  const answer = await call("live_fetch", { path: board.path });
  // live_fetch hands back the raw CR payload; rankings put the players
  // in `items`, already in rank order.
  const payload = answer.payload ?? answer.data ?? answer;
  const items = payload.items ?? payload.Items ?? [];
  if (!Array.isArray(items))
    throw new Error(`${board.slug}: no items in the payload`);
  return items
    .map((i) => String(i.tag ?? "").toUpperCase())
    .filter((t) => CANONICAL_TAG.test(t))
    .slice(0, board.top);
}

export async function syncBoard(board, { dryRun } = {}) {
  const tags = await readBoard(board);
  if (tags.length < board.top * MIN_FILL) {
    return {
      slug: board.slug,
      skipped: `board returned ${tags.length} of ${board.top} — too short to trust (season boundary?)`,
    };
  }

  // What is in there now, so a dry run can say what would move and a real
  // run has something to report beyond a count.
  const before = await call("collections_get", { collection: board.slug });
  const had = new Set(
    (before.members ?? before.players ?? []).map((m) =>
      String(m.player_tag ?? m.tag ?? m).toUpperCase(),
    ),
  );
  const wanted = new Set(tags);
  const adding = tags.filter((t) => !had.has(t));
  const dropping = [...had].filter((t) => !wanted.has(t));

  if (dryRun) {
    return {
      slug: board.slug,
      dryRun: true,
      size: tags.length,
      adding: adding.length,
      dropping: dropping.length,
      sample: adding.slice(0, 5),
    };
  }

  const done = await call("collections_edit", {
    collection: board.slug,
    action: "set",
    tags,
  });
  return {
    slug: board.slug,
    size: tags.length,
    adding: adding.length,
    dropping: dropping.length,
    result: done,
  };
}

export async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const only = args.find((a) => a.startsWith("--board="))?.split("=")[1];
  if (!TOKEN) {
    console.error(
      "ELIXIR_TOKEN is not set (a svt_ service token for the collections' owner).",
    );
    process.exit(2);
  }
  const boards = only ? BOARDS.filter((b) => b.slug === only) : BOARDS;
  if (boards.length === 0) {
    console.error(
      `No board named ${only}. Known: ${BOARDS.map((b) => b.slug).join(", ")}`,
    );
    process.exit(2);
  }

  let failed = 0;
  for (const board of boards) {
    const started = Date.now();
    try {
      const outcome = await syncBoard(board, { dryRun });
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          ms: Date.now() - started,
          ...outcome,
        }),
      );
    } catch (err) {
      failed += 1;
      // One board failing must not stop the next: a rate limit on one
      // location is not a reason to leave every other collection stale.
      console.error(
        JSON.stringify({
          at: new Date().toISOString(),
          slug: board.slug,
          error: err.message,
        }),
      );
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

// Importable for its tests, runnable as a job: main only fires when this
// file IS the command, never when a test reaches in for syncBoard.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
