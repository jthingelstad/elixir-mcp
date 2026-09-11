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
 *   node boards.mjs --dry-run     say WHO would be added and dropped, write nothing
 *   node boards.mjs               do it, and say who moved
 *   node boards.mjs --board=pol-global-top-100
 *   node boards.mjs --json        one machine-readable line per board, for a log
 *
 * ELIXIR_MCP_TOKEN is a service token (svt_...) for an account that OWNS
 * the collections below; collections_edit refuses somebody else's. Put it
 * in a .env beside this file, or in the environment.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

// A .env beside this file, if there is one. Loaded first so an exported
// variable still wins over it, and quietly absent so a launchd job that
// sets the environment itself needs no file. Same names as the Discord
// consumer's .env, so the two clients read alike. The file is covered by
// the repo's .env ignore rule; keep it mode 0600.
try {
  process.loadEnvFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), ".env"),
  );
} catch {
  // no .env here; the environment is the environment
}

const ENDPOINT =
  process.env.ELIXIR_MCP_URL ?? "https://elixir.poapkings.com/mcp";
const TOKEN = process.env.ELIXIR_MCP_TOKEN;

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
  // Regional boards are season-shaped: the ranking lists only players
  // above a rating floor, so they are small on day one and fill through
  // the month. "top-100" is the cap, not a promise — the US had 98 rated
  // players and Japan 34 when these were added (2026-09-10, day 3).
  {
    slug: "pol-us-top-100",
    path: "/locations/57000249/pathoflegend/players",
    top: 100,
    label: "Path of Legends · United States",
  },
  {
    slug: "pol-jp-top-100",
    path: "/locations/57000122/pathoflegend/players",
    top: 100,
    label: "Path of Legends · Japan",
  },
];

/**
 * When NOT to believe a board.
 *
 * A Path of Legends ranking lists only players above a rating floor, and a
 * season resets everyone below it: three days into S136 the global board
 * had 836 players, the US 98, Japan 34, India 4. So a SMALL board is not
 * suspicious — early in a season every regional board is small, and a
 * collection that starts empty should simply take what is there.
 *
 * What is suspicious is a board that has COLLAPSED against what the
 * collection already holds: a hundred members yesterday, five today. That
 * is the season boundary (or an API hiccup returning a stub), and writing
 * it through would stop ninety-five recordings tonight and restart them
 * over the next fortnight as players climb back. So the collection holds
 * last season's set until the new board fills back to at least this share
 * of it. An EMPTY board is never written, whatever the collection holds.
 */
const COLLAPSE_SHARE = 0.5;
const COLLAPSE_FLOOR = 20; // below this many members there is nothing to collapse from

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

/** The board, newest read: canonical tag, name, clan and rank, in rank
 *  order and cut to the board's size. Kept whole rather than reduced to
 *  tags, because the report has to say WHO moved, not how many. */
async function readBoard(board) {
  const answer = await call("live_fetch", { path: board.path });
  // live_fetch hands back the raw CR payload; rankings put the players
  // in `items`, already in rank order.
  const payload = answer.payload ?? answer.data ?? answer;
  const items = payload.items ?? payload.Items ?? [];
  if (!Array.isArray(items))
    throw new Error(`${board.slug}: no items in the payload`);
  return items
    .map((i) => ({
      tag: String(i.tag ?? "").toUpperCase(),
      name: i.name ?? "",
      clan: i.clan?.name ?? "",
      rank: i.rank ?? null,
      elo: i.eloRating ?? i.trophies ?? null,
    }))
    .filter((i) => CANONICAL_TAG.test(i.tag))
    .slice(0, board.top);
}

export async function syncBoard(board, { dryRun } = {}) {
  const ranked = await readBoard(board);
  const tags = ranked.map((r) => r.tag);
  if (tags.length === 0) {
    return { slug: board.slug, skipped: "board is empty — nothing believed" };
  }

  // What is in there now: the dry run says who would move, the real run
  // reports who did, and the collapse guard needs the size.
  const before = await call("collections_get", { collection: board.slug });
  const held = new Map(
    (before.members ?? before.players ?? []).map((m) => {
      const tag = String(
        m.player_tag ?? m.subject_tag ?? m.tag ?? m,
      ).toUpperCase();
      return [tag, { tag, name: m.name ?? "" }];
    }),
  );
  if (held.size >= COLLAPSE_FLOOR && tags.length < held.size * COLLAPSE_SHARE) {
    return {
      slug: board.slug,
      skipped: `board returned ${tags.length} against ${held.size} held — collapsed (season boundary?), holding the current set`,
    };
  }

  const wanted = new Set(tags);
  const adding = ranked.filter((r) => !held.has(r.tag));
  const dropping = [...held.values()].filter((m) => !wanted.has(m.tag));

  const out = {
    slug: board.slug,
    label: board.label,
    dryRun: Boolean(dryRun),
    size: tags.length,
    adding,
    dropping,
  };
  if (dryRun) return out;

  out.result = await call("collections_edit", {
    collection: board.slug,
    action: "set",
    tags,
  });
  return out;
}

/** The report a person reads: one line per player who moved, with the
 *  rank and rating they arrived at. A count says a board churned; a name
 *  says whether that was the summit changing hands or the floor shifting. */
function report(out) {
  const lines = [];
  if (out.skipped) {
    lines.push(`${out.slug} · skipped: ${out.skipped}`);
    return lines.join("\n");
  }
  const verb = out.dryRun ? "would change" : "changed";
  lines.push(
    `${out.slug} · ${out.label} · ${out.size} players · +${out.adding.length} −${out.dropping.length} ${verb}`,
  );
  const who = (p) =>
    `${p.tag.padEnd(11)} ${(p.name || "?").padEnd(18)}${p.clan ? ` (${p.clan})` : ""}`;
  for (const p of out.adding) {
    const at = p.rank != null ? ` · #${p.rank}` : "";
    const elo = p.elo != null ? ` · ${p.elo}` : "";
    lines.push(`  + ${who(p)}${at}${elo}`);
  }
  for (const p of out.dropping) lines.push(`  − ${who(p)}`);
  if (out.adding.length === 0 && out.dropping.length === 0)
    lines.push("  no change");
  return lines.join("\n");
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

  const asJson = args.includes("--json");
  let failed = 0;
  for (const board of boards) {
    const started = Date.now();
    try {
      const outcome = await syncBoard(board, { dryRun });
      if (asJson) {
        console.log(
          JSON.stringify({
            at: new Date().toISOString(),
            ms: Date.now() - started,
            ...outcome,
            adding: outcome.adding?.map((p) => p.tag),
            dropping: outcome.dropping?.map((p) => p.tag),
          }),
        );
      } else {
        console.log(report(outcome));
        console.log();
      }
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
