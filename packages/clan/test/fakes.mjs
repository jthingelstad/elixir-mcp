/** Fakes for every seam. No network, no spend: the record is scripted,
 *  the store is in memory, the clock is a number the test moves. */

import { createAccountContext } from "../src/account.mjs";
import { createHandler } from "@elixir-mcp/clan/handler.mjs";

export const PERSON = {
  kind: "person",
  subject: { type: "player", tag: "#098R2R0PUL", name: "Ada" },
  clan: { tag: "#0QC8RCGY", name: "Example Clan" },
};

export function player(overrides = {}) {
  return {
    player_tag: "#098R2R0PUL",
    name: "Ada",
    relationship: "primary",
    is_primary: true,
    claim_status: "verified",
    notify: false,
    recording: "active",
    clan_tag: "#0QC8RCGY",
    clan_role: "leader",
    ...overrides,
  };
}

export function rosterBody(members) {
  return {
    clan_tag: "#0QC8RCGY",
    name: "Example Clan",
    member_count: members.length,
    members,
    notes: ["last_seen_in_game is the game's own lastSeen."],
    docs: "recording#the-games-own-last-seen",
    meta: {
      as_of: "2026-09-12T18:00:00.000Z",
      freshness_seconds: 120,
      source_polls: {
        clan: {
          observed_at: "2026-09-12T17:58:00.000Z",
          freshness_seconds: 120,
        },
      },
      contract_version: "1.7.0",
    },
  };
}

/**
 * Elixir's record, scripted. `principal` is what identity answers;
 * `players` what elixir_my_players answers; `roster` what clans_roster
 * answers (a body, or `{ error: { code, message } }` for a tool failure);
 * `rosters` answers per clan, keyed by the `clan_tag` asked for, falling
 * back to `roster` when the call names no clan or one not listed (as the
 * real tool falls back to the account's default recorded clan).
 * `refuse` makes identity answer 401 until cleared, which is how a
 * signed-out request looks from here.
 * The roster's `meta.source_polls.clan.observed_at` is now unless
 * `state.rosterObservedAt` names another instant (a stale roster makes a
 * leader mutation ask for a live read: role-freshness.mjs); a live ask
 * answers `state.liveStatus`, pending by default.
 */
import { timedRead } from "@elixir-mcp/clan/trace.mjs";

export function fakeRecord({
  principal = PERSON,
  players = [player()],
  roster = null,
  rosters = null,
} = {}) {
  const calls = [];
  const state = {
    principal,
    players,
    roster,
    rosters,
    refuse: false,
    facts: [],
    removed: [],
    mail: [],
    mailStatus: {},
    factAnswer: null,
  };
  return {
    calls,
    state,
    // Timed into the request's trace like the real record, so a test can
    // read the story a request tells.
    identity() {
      return timedRead("identity", async () => {
        calls.push(["identity"]);
        if (state.refuse)
          return { ok: false, status: 401, error: "unauthenticated" };
        return {
          ok: true,
          body: { principal: state.principal, players: state.players },
          principal: state.principal,
        };
      });
    },
    read(name, args) {
      return timedRead(name, () => this.rawRead(name, args));
    },
    // Attested facts: recorded, answered as scripted.
    async writeFact(clanTag, fact) {
      calls.push(["writeFact", { clanTag, ...fact }]);
      state.facts.push({ clanTag, ...fact });
      return (
        state.factAnswer ?? {
          ok: true,
          body: { id: String(state.facts.length), visibility: "clan" },
        }
      );
    },
    // Mail through Elixir: recorded; each message is answered from
    // `state.mailStatus[tag]`, else sent.
    async sendMail(clanTag, body) {
      calls.push(["sendMail", { clanTag, ...body }]);
      state.mail.push({ clanTag, ...body });
      return {
        ok: true,
        body: {
          kind: body.kind,
          results: body.messages.map((m) => ({
            player_tag: m.player_tag,
            status: state.mailStatus[m.player_tag] ?? "sent",
          })),
        },
      };
    },
    async removeFact(clanTag, ref) {
      calls.push(["removeFact", { clanTag, ref }]);
      state.removed.push(ref);
      return { ok: true };
    },
    async rawRead(name, args) {
      calls.push([name, args]);
      if (name === "elixir_my_players")
        return {
          ok: true,
          body: {
            players: state.players,
            meta: { as_of: "2026-09-12T18:00:00.000Z" },
          },
        };
      if (name === "clans_roster") {
        const roster = state.rosters?.[args?.clan_tag] ?? state.roster;
        if (roster?.error)
          return {
            ok: false,
            code: roster.error.code,
            error: roster.error.message,
            hint: roster.error.hint,
          };
        const body = structuredClone(roster ?? rosterBody([]));
        if (body.meta?.source_polls?.clan)
          body.meta.source_polls.clan.observed_at =
            state.rosterObservedAt ?? new Date().toISOString();
        if (args?.live === true)
          body.live_status = state.liveStatus ?? {
            state: "pending",
            retry_after_s: 15,
          };
        return { ok: true, body };
      }
      return { ok: false, code: "unknown", error: `no fake for ${name}` };
    },
  };
}

export function createTestAccount() {
  const items = new Map();
  const state = {
    get: async (pk) => items.get(pk) ?? null,
    put: async (row) => {
      items.set(row.pk, structuredClone(row));
    },
  };
  let context;
  const identity = {
    async load(event) {
      const signedIn = String(event.headers?.cookie ?? "")
        .split(/;\s*/)
        .includes("__Host-elixir_session=test-person");
      if (!signedIn) return null;
      context = createAccountContext({
        account: { kind: "person", accountId: "test-person" },
        state,
      });
      return context.identity.load(event);
    },
  };
  const store = { items };
  for (const name of [
    "updateSession",
    "getPreference",
    "putPreference",
    "deleteSession",
  ])
    store[name] = (...args) => context.store[name](...args);
  return { identity, store };
}

export function harness(opts = {}) {
  const clock = { t: Date.parse("2026-09-12T18:00:00Z") };
  const now = () => clock.t;
  const record = opts.record ?? fakeRecord(opts.door);
  const { identity, store } = createTestAccount();
  const handler = createHandler({
    record,
    identity,
    store,
    memberActivity: opts.memberActivity ?? null,
    directory: opts.directory ?? null,
    avatars: opts.avatars ?? null,
    manage: opts.manage ?? null,
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    now,
    log: { warn() {}, error() {}, info() {} },
  });
  return { clock, now, record, store, handler };
}

export function req(method, path, { query, cookies, body } = {}) {
  return {
    path,
    method,
    queryStringParameters: query,
    body,
    headers: {
      cookie: cookies
        ? Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; ")
        : "",
    },
  };
}

/** The outer web API has already authenticated this Elixir person. */
export async function signIn(h) {
  const sessionCookie = "__Host-elixir_session=test-person";
  const me = await h.handler(
    req("GET", "/api/me", { cookies: cookieHeader(sessionCookie) }),
  );
  return { me, sessionCookie };
}

export function cookieHeader(sessionCookie) {
  const [k, v] = sessionCookie.split("=");
  return { [k]: v };
}

/**
 * A memory ledger holding a saved version of one clan's policy, awards or
 * pitch, synchronously: the test harnesses are built without awaiting,
 * and nothing in clan management runs until a clan has a policy.
 */
export function seedVersion(ledger, kind, clanTag, values, version = 1) {
  const saved_at = "2026-09-01T00:00:00.000Z";
  ledger.items.set(`${kind}#${clanTag}#v${version}`, {
    pk: `${kind}#${clanTag}#v${version}`,
    gsi1pk: `clan#${clanTag}`,
    gsi1sk: `${kind}#v${String(version).padStart(6, "0")}`,
    clan_tag: clanTag,
    version,
    values,
    saved_by: "#TESTLEADER",
    saved_by_name: "A leader",
    saved_at,
    note: null,
  });
  ledger.items.set(`${kind}#${clanTag}`, {
    pk: `${kind}#${clanTag}`,
    version,
    saved_at,
  });
  return ledger;
}

export const ledgerWithPolicy = (ledger, clanTag, values, version = 1) =>
  seedVersion(ledger, "policy", clanTag, values, version);
