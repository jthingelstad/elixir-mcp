/** Successful journeys use the real API and a per-run scratch database.
 * Only the HTTP transport is adapted; requests go through session/CSRF
 * resolution, route dispatch, SQL, JSON serialization and the browser client.
 *
 * No step here races a clock (#963). Each page fires a burst of reads (up
 * to nine at once) at a pool of DB_POOL_MAX connections, so how long a step
 * takes is the host's business: on a loaded one it took past every bound
 * this file used to set, and the pool's 2.5 s connect bound turned a
 * queued read into a 503, which the client retried once and then showed as
 * an error the wait could never find. Now a queued read waits its turn,
 * every wait is for its condition (`until`), and any 5xx or failed section
 * ends the test at once with what failed. The timeouts left are hang
 * guards, never latency bounds.
 */
import { test, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  within,
} from "@testing-library/react";
import { App } from "../src/App.jsx";
// The route chunks compile while this file loads, not inside a wait.
import "./warm-routes.js";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { makeHandler } from "../../../services/web-api/src/handler.mjs";
import { makeDatabase } from "../../../packages/http/src/database.mjs";
import { createSession, emailHash } from "../../../packages/auth/src/index.mjs";
import { warmPools } from "../../../services/web-api/test/warm-pools.mjs";

/** A hang guard for a test or hook: nothing below waits on time. */
const HANG = 600_000;
let scratch, handler, cookie, accountId;
const pending = new Set();
/** Every 5xx the API answered, as "METHOD path status". */
const failures = [];
/** Counts finished tests, so an until() a timed-out test left running
 *  stops instead of acting on the next test's page. */
let finished = 0;
// The scratch database is a clone of the migrated template, and CREATE
// DATABASE queues behind any other on the host (several verify runs at
// once): a queue, so its bound is a hang guard.
beforeAll(async () => {
  scratch = await scratchDb("ui_journeys");
  const hash = emailHash("journeys@example.com");
  ({
    rows: [{ account_id: accountId }],
  } = await scratch.db.query(
    "insert into account (email_hash,status,role,timezone) values ($1,'approved','member','UTC') returning account_id",
    [hash],
  ));
  const session = await createSession(scratch.db, {
    secret: "scratch-only",
    accountId,
    emailHash: hash,
  });
  cookie = `__Host-elixir_session=${session.token}`;
  const databaseUrl = (
    process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres"
  ).replace(/\/postgres$/, `/${scratch.db.connectionParameters.database}`);
  handler = makeHandler({
    databaseUrl,
    // The run's pool size, with no bound on waiting for a connection: a
    // page's burst queues on it, and on a loaded host the doors' 2.5 s
    // bound answered the tail of the queue 503 (reproduced by slowing
    // every query 120 ms: a 503 and a 21 s journey).
    database: makeDatabase({
      connectionString: databaseUrl,
      max: Number(process.env.DB_POOL_MAX ?? 4),
      connectionTimeoutMillis: 0,
    }),
    secret: "scratch-only",
    sendLoginEmail: async () => {},
  });
  // The pool opens here, not on a page's first burst of requests.
  await warmPools([handler]);
  vi.stubGlobal("fetch", (path, init = {}) => {
    const url = new URL(path, "http://localhost");
    const method = init.method ?? "GET";
    const promise = handler({
      path: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams),
      method,
      headers: {
        ...init.headers,
        ...(init.credentials === "same-origin" ? { cookie } : {}),
      },
      body: init.body,
    }).then((r) => {
      if (r.statusCode >= 500)
        failures.push(`${method} ${url.pathname} ${r.statusCode}`);
      return {
        ok: r.statusCode >= 200 && r.statusCode < 300,
        status: r.statusCode,
        text: async () => r.body,
        json: async () => JSON.parse(r.body),
      };
    });
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
    return promise;
  });
}, HANG);
afterEach(async () => {
  finished += 1;
  cleanup();
  await Promise.all([...pending]);
  expect(failures.splice(0)).toEqual([]);
});
// The handler's pool closes first: `drop database ... with (force)`
// otherwise terminates its idle connections under it, and each one
// logged a db_pool_error at the end of every run. A test that failed
// can leave a request holding a client, and pool.end() waits for every
// client to come back, so the close gets 5 s; the forced drop then ends
// whatever is still open.
afterAll(async () => {
  vi.unstubAllGlobals();
  let timer;
  await Promise.race([
    handler?.close(),
    new Promise((resolve) => {
      timer = setTimeout(resolve, 5000);
    }),
  ]);
  clearTimeout(timer);
  await scratch?.drop();
}, HANG);

/** Wait for a condition, however long the host takes: `check` is tried
 *  after each turn of the page (its reads answered, React flushed) until
 *  it returns without throwing. A 5xx from the API or a section that
 *  failed to render can never turn into the condition, so either ends the
 *  wait at once, naming it. */
async function until(check) {
  const test = finished;
  for (;;) {
    if (finished !== test) throw new Error("the test this wait was for ended");
    if (failures.length)
      throw new Error(`the API answered ${failures.join(", ")}`);
    if (screen.queryByText(/This section failed to render/))
      throw new Error("a section failed to render");
    try {
      return await check();
    } catch (error) {
      if (failures.length) continue;
      await act(async () => {
        await Promise.all([...pending]);
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      if (!(error instanceof Error)) throw error;
    }
  }
}
async function clickReady(name) {
  // A committed DB write can precede delivery of its HTTP response. Wait for
  // the page to finish the operation before the next user action.
  const button = await until(() => {
    const b = screen.getByRole("button", { name, exact: true });
    expect(b.disabled).toBe(false);
    return b;
  });
  fireEvent.click(button);
}
/** The named button in the open question: a mis-click only ever gets here. */
async function confirmIt(name) {
  const dialog = await until(() => {
    const d = document.querySelector("dialog.kit-confirm");
    expect(d).toBeTruthy();
    return d;
  });
  fireEvent.click(within(dialog).getByRole("button", { name, hidden: true }));
  await until(() =>
    expect(document.querySelector("dialog.kit-confirm")).toBeNull(),
  );
}
function open(path) {
  window.history.pushState({}, "", path);
  render(<App />);
}

test(
  "a player claim and first captured snapshot become a usable first question",
  { timeout: HANG },
  async () => {
    // Home's first step and Tracking offer the same field; this journey
    // uses Tracking, which manages what you track from then on.
    open("/settings/players");
    const input = await until(() => screen.getByLabelText("Player tag"));
    fireEvent.change(input, { target: { value: "#00J" } });
    fireEvent.click(input.closest("form").querySelector("button"));
    // Adding opens the new player's page. Its tag is on that page twice
    // (the heading and the line under it), and three times once the
    // recording status reads, so "#00J" alone matched one element only in
    // the moment between the list's refresh and the navigation: a race
    // findBy won on an idle host and lost on a loaded one (#963).
    await until(() => {
      expect(window.location.pathname).toBe("/settings/players/00J");
      return screen.getByRole("heading", { level: 1, name: "#00J" });
    });
    expect(
      (
        await scratch.db.query(
          "select player_tag from claim where account_id=$1",
          [accountId],
        )
      ).rows,
    ).toEqual([{ player_tag: "#00J" }]);
    await scratch.db.query(
      "insert into player_snapshot_daily (player_tag,snapshot_date,snapshot_kind,observed_at,profile_observed_at) values ('#00J',current_date,'daily',now(),now())",
    );
    // On the record, readiness has moved on its own: the snapshot is the
    // evidence, and the line says when it was taken.
    cleanup();
    open("/settings/players/00J");
    await until(() => screen.getByText(/^read /));
    // Consent is fixture setup on the scratch DB; the UI consumes the real
    // connection and readiness responses after returning from OAuth.
    await scratch.db.query(
      "insert into oauth_client (client_id,client_name,redirect_uris,expires_at) values ('journey-client','Test client','{}',now()+interval '1 day')",
    );
    await scratch.db.query(
      "insert into oauth_family (client_id,account_id,absolute_expires_at) values ('journey-client',$1,now()+interval '1 day')",
      [accountId],
    );
    // The starter questions moved to Connections, which is where a
    // connection is the thing you are working on.
    fireEvent.click(screen.getByRole("link", { name: /Connections/ }));
    await until(() => screen.getByText("Test client"));
    await until(() => screen.getByText(/AI client you connected/));
    await until(() => screen.getByRole("heading", { name: "Try asking…" }));
    const copy = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    fireEvent.click(
      await until(() =>
        screen.getByRole("button", {
          name: "Copy question: Start with your latest profile",
        }),
      ),
    );
    await until(() =>
      screen.getByText("Copied. Paste into your connected client."),
    );
    expect(copy.mock.calls[0][0]).toContain("#00J");
    expect(
      (
        await scratch.db.query(
          "select count(*)::int n from mcp_call_audit where account_id=$1",
          [accountId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(screen.queryByText(/This section failed to render/)).toBeNull();
  },
);

test(
  "create an agent, open its detail, rotate its key, suspend, remove and resume it",
  { timeout: HANG },
  async () => {
    await scratch.db.query(
      "insert into account_clan (account_id,clan_tag,scope) values ($1,'#0GG','comprehensive')",
      [accountId],
    );
    open("/settings/connections");
    fireEvent.click(
      await until(() => screen.getByRole("button", { name: "New agent" })),
    );
    fireEvent.change(await until(() => screen.getByLabelText("Name")), {
      target: { value: "journey-agent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await until(() => screen.getByText(/Copy this key now\./));
    // New agent opened in place, and the key is shown there, once.
    expect(window.location.pathname).toBe("/settings/connections");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // Open is the agent's page in Settings, at its public id.
    fireEvent.click(
      await until(() => screen.getByRole("link", { name: /journey-agent/ })),
    );
    await until(() => screen.getByText("News it hasn't read"));
    const publicId = window.location.pathname.split("/")[3];
    expect(window.location.pathname).toBe(
      `/settings/agents/${publicId}/overview`,
    );
    const {
      rows: [agent],
    } = await scratch.db.query(
      "select account_id,kind,owned_by_account_id from account where public_id=$1",
      [publicId],
    );
    expect({
      kind: agent.kind,
      owned_by_account_id: agent.owned_by_account_id,
    }).toEqual({ kind: "agent", owned_by_account_id: accountId });
    const agentId = agent.account_id;
    // What you change is its Settings, one tab away.
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await clickReady("Issue a new key");
    await confirmIt("Issue a new key");
    await until(async () => {
      const {
        rows: [keys],
      } = await scratch.db.query(
        "select count(*)::int total, count(*) filter (where revoked_at is null)::int live from service_token where account_id=$1",
        [agentId],
      );
      expect(keys).toEqual({ total: 2, live: 1 });
    });
    await clickReady("Suspend");
    await confirmIt("Suspend");
    await until(() =>
      screen.getByRole("button", { name: "Resume", exact: true }),
    );
    expect(
      (
        await scratch.db.query(
          "select status from account where account_id=$1",
          [agentId],
        )
      ).rows[0].status,
    ).toBe("disabled");
    // A suspended agent can be removed from view (0215): out of the
    // Agents list into its folded Removed list, deleting nothing.
    await clickReady("Remove");
    await until(() =>
      screen.getAllByRole("button", { name: "Restore", exact: true }),
    );
    const removedAt = async () =>
      (
        await scratch.db.query(
          "select removed_at from account where account_id=$1",
          [agentId],
        )
      ).rows[0].removed_at;
    expect(await removedAt()).not.toBeNull();
    cleanup();
    open("/settings/connections");
    await until(() => screen.getByText("Removed agents (1)"));
    expect(screen.queryByText("Open ›")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "journey-agent" }));
    // Restore brings it back among the agents, still suspended.
    await until(() =>
      expect(window.location.pathname).toBe(
        `/settings/agents/${publicId}/settings`,
      ),
    );
    const restore = await until(() =>
      screen.getAllByRole("button", { name: "Restore" }),
    );
    fireEvent.click(restore[0]);
    await until(async () => expect(await removedAt()).toBeNull());
    await clickReady("Resume");
    await until(() =>
      screen.getByRole("button", { name: "Suspend", exact: true }),
    );
    expect(
      (
        await scratch.db.query(
          "select status from account where account_id=$1",
          [agentId],
        )
      ).rows[0].status,
    ).toBe("approved");
    expect(screen.queryByText(/This section failed to render/)).toBeNull();
  },
);

/**
 * Capabilities are editable on a live connection, without disconnecting it.
 *
 * The client's authorize request decides scope, so an app that never asks
 * for a capability could not be allowed one from anywhere. This is the
 * surface where the person decides instead.
 */
test(
  "a connection's capabilities can be widened and narrowed in place",
  { timeout: HANG },
  async () => {
    await scratch.db.query(
      `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
       values ('ui-scope', 'Claude', '{}', now() + interval '30 days')
       on conflict do nothing`,
    );
    await scratch.db.query(
      `insert into oauth_family (client_id, account_id, absolute_expires_at, scope)
       values ('ui-scope', $1, now() + interval '90 days', 'cr:read')`,
      [accountId],
    );

    open("/settings/connections");
    // It starts read-only, showing exactly what the client was granted. The
    // page names scopes in more than one place, so assert on the row itself.
    // Other journeys in this file leave their own connections behind, so every
    // query is scoped to THIS row rather than the whole page.
    const rowFor = (client) =>
      until(() => screen.getByText(client).closest(".kit-row"));
    let row = await rowFor("Claude");
    await until(() => expect(row.textContent).toContain("cr:read"));
    expect(row.textContent).not.toContain("feedback:write");

    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const feedback = within(row).getByRole("checkbox", {
      name: /feedback:write/,
    });
    expect(feedback.checked).toBe(false);
    // cr:read is what every read tool needs, so it is not a choice.
    const read = within(row).getByRole("checkbox", { name: /cr:read/ });
    expect(read.checked).toBe(true);
    expect(read.disabled).toBe(true);

    fireEvent.click(feedback);
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    // Persisted, in canonical order, and reflected back on the page.
    await until(async () => {
      const { rows } = await scratch.db.query(
        `select scope from oauth_family where client_id = 'ui-scope'`,
      );
      expect(rows[0].scope).toBe("cr:read feedback:write");
    });
    row = await rowFor("Claude");
    await until(() =>
      expect(row.textContent).toContain("cr:read feedback:write"),
    );

    // And back again: a capability can be taken away without disconnecting.
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    fireEvent.click(
      within(row).getByRole("checkbox", { name: /feedback:write/ }),
    );
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await until(async () => {
      const { rows } = await scratch.db.query(
        `select scope from oauth_family where client_id = 'ui-scope'`,
      );
      expect(rows[0].scope).toBe("cr:read");
    });
  },
);
