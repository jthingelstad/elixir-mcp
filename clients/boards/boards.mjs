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
 *   rankings_players / rankings_clans
 *                   the RECORDED board (contract 1.3.0). The hub records
 *                   the global Path of Legends board hourly and every
 *                   location daily, so this reads the record and spends
 *                   nothing from the shared CR budget. Until 1.3.0 this
 *                   client read the game through live_fetch, which was
 *                   capped at the top 100 and threw the board away.
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
 * The boards. Adding one is a line here, not a rewrite.
 *
 * `location` is what rankings_players takes: `global`, a numeric CR
 * location id, or a two-letter country code. `board` is pol (Path of
 * Legends) or trophy. A board with `derive: "clans"` is the clans most
 * represented on the ranking, via rankings_clans.
 *
 * Membership still records players (a collection is a recording reason),
 * but the global top 200 is ALREADY recorded by the hub for the season —
 * ranking presence is its own reason since 0068 — so these collections
 * now add far less recording load than they did.
 */
export const BOARDS = [
  {
    slug: "pol-global-top-100",
    location: "global",
    top: 100,
    label: "Path of Legends · global",
  },
  // Regional boards are season-shaped: the ranking lists only players
  // above a rating floor, so they are small on day one and fill through
  // the month. "top-100" is the cap, not a promise — the US had 98 rated
  // players and Japan 34 when these were added (2026-09-10, day 3).
  {
    slug: "pol-us-top-100",
    location: "US",
    top: 100,
    label: "Path of Legends · United States",
  },
  {
    slug: "pol-jp-top-100",
    location: "JP",
    top: 100,
    label: "Path of Legends · Japan",
  },
  // A CLAN board: the clans with the most players rated in Path of
  // Legends, globally — rankings_clans counts over EVERYONE above the
  // rating floor (847 players on 2026-09-11, growing through the month),
  // not the top 100, where sixty-four clans tie at one player. Strict
  // ten; the hub breaks a tie at the cutoff by best-placed player.
  // The collection must be kind clan and scope ACTIVITY: ten top clans
  // at comprehensive would be every member's battles, the single most
  // expensive thing this system could be asked to record.
  {
    slug: "global-top-10-clans",
    location: "global",
    derive: "clans",
    top: 10,
    label: "Clans most represented in Path of Legends · global",
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

/** One read of a board per run, shared by every collection drawn from it
 *  (the top-100 players and the clans are the same global board). The
 *  cache is a Map the RUN owns — main() makes one, a test makes its own —
 *  rather than module state, which would make every board read whatever
 *  the first one saw. */
const PAGE = 500;

/** The whole recorded board as players, in rank order. Paged: a board can
 *  run to a thousand places and the door delivers 500 at most per call. */
async function readPlayers(board, fetched) {
  const key = `players:${board.board ?? "pol"}:${board.location}`;
  if (!fetched.has(key)) {
    fetched.set(
      key,
      (async () => {
        const players = [];
        let snapshot = null;
        for (let offset = 0; ; offset += PAGE) {
          const page = await call("rankings_players", {
            board: board.board ?? "pol",
            location: board.location,
            limit: PAGE,
            offset,
          });
          snapshot = page.snapshot;
          for (const p of page.players ?? []) {
            players.push({
              tag: String(p.player_tag).toUpperCase(),
              name: p.name ?? "",
              clan: p.clan_name ?? "",
              clanTag: String(p.clan_tag ?? "").toUpperCase(),
              rank: p.rank ?? null,
              elo: p.rating ?? null,
            });
          }
          if (!snapshot || offset + PAGE >= snapshot.entries) break;
        }
        return { players, snapshot };
      })(),
    );
  }
  return fetched.get(key);
}

/** A player board: the top N of the recorded ranking. */
async function readBoard(board, fetched) {
  const { players } = await readPlayers(board, fetched);
  return players.slice(0, board.top);
}

/** A clan board: the hub's own aggregate over the whole ranking, ties
 *  already broken by best-placed player. Each entry carries the count and
 *  that best rank, so the report can say why a clan is here. */
async function deriveClans(board, fetched) {
  const key = `clans:${board.board ?? "pol"}:${board.location}`;
  if (!fetched.has(key)) {
    fetched.set(
      key,
      call("rankings_clans", {
        board: board.board ?? "pol",
        location: board.location,
        limit: board.top,
      }).then((r) =>
        (r.clans ?? []).map((c) => ({
          tag: String(c.clan_tag).toUpperCase(),
          name: c.clan_name ?? "",
          count: c.rated_players,
          best: c.best_rank,
          rank: c.rank,
        })),
      ),
    );
  }
  return fetched.get(key);
}

export async function syncBoard(
  board,
  { dryRun = false, fetched = new Map() } = {},
) {
  const ranked =
    board.derive === "clans"
      ? await deriveClans(board, fetched)
      : await readBoard(board, fetched);
  const tags = ranked.map((r) => r.tag);
  if (tags.length === 0) {
    return { slug: board.slug, skipped: "board is empty — nothing believed" };
  }

  // What is in there now: the dry run says who would move, the real run
  // reports who did, and the collapse guard needs the size.
  const before = await call("collections_get", { collection: board.slug });
  // The collection has to be the kind the board produces — a clan tag
  // set into a player collection is refused by the door, but saying so
  // here is clearer than the door's error. And a clan collection at
  // comprehensive scope records every member of every clan in it: for
  // ten top clans that is hundreds of battle logs, so it is refused
  // outright rather than run by accident.
  const kind = before.kind ?? before.collection?.kind;
  const wantKind = board.derive === "clans" ? "clan" : "player";
  if (kind && kind !== wantKind) {
    return {
      slug: board.slug,
      skipped: `collection is kind ${kind}; this board produces ${wantKind} tags`,
    };
  }
  const scope = before.scope ?? before.collection?.scope;
  if (wantKind === "clan" && scope === "comprehensive") {
    return {
      slug: board.slug,
      skipped:
        "clan collection is at comprehensive scope — that records every member of every clan in it; make it activity",
    };
  }
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
    kind: wantKind,
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
  const noun = out.kind === "clan" ? "clans" : "players";
  lines.push(
    `${out.slug} · ${out.label} · ${out.size} ${noun} · +${out.adding.length} −${out.dropping.length} ${verb}`,
  );
  const who = (p) =>
    `${p.tag.padEnd(11)} ${(p.name || "?").padEnd(18)}${p.clan ? ` (${p.clan})` : ""}`;
  for (const p of out.adding) {
    // A clan arrives with how many rated players it has and where its
    // best one sits; a player with the rank and rating they came in at.
    const at = p.rank != null ? ` · #${p.rank}` : "";
    const why =
      p.count != null
        ? ` · ${p.count} rated · best #${p.best}`
        : p.elo != null
          ? ` · ${p.elo}`
          : "";
    lines.push(`  + ${who(p)}${at}${why}`);
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
  const fetched = new Map(); // one ranking read per path, for the whole run
  let failed = 0;
  for (const board of boards) {
    const started = Date.now();
    try {
      const outcome = await syncBoard(board, { dryRun, fetched });
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
