/** Successful journeys use the real API and a per-run scratch database.
 * Only the HTTP transport is adapted; requests go through session/CSRF
 * resolution, route dispatch, SQL, JSON serialization and the browser client.
 */
import { test, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  configure,
  within,
} from "@testing-library/react";
import { App } from "../src/App.jsx";
// The route chunks compile while this file loads, not inside a wait.
import "./warm-routes.js";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { makeHandler } from "../../../services/web-api/src/handler.mjs";
import { createSession, emailHash } from "../../../packages/auth/src/index.mjs";

// These assertions include real PostgreSQL round trips, not resolved mocks.
// Bound the wait, but do not turn Testing Library's unit-test default (1s)
// into an accidental latency SLO for shared CI runners.
configure({ asyncUtilTimeout: 5000 });
let scratch, handler, cookie, accountId;
const pending = new Set();
// The scratch database runs every migration, and CREATE DATABASE queues
// behind any other on the host: 15 s missed on a host running several
// verify passes at once (2026-10-21). A bound, not a latency target.
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
    secret: "scratch-only",
    sendLoginEmail: async () => {},
  });
  vi.stubGlobal("fetch", (path, init = {}) => {
    const url = new URL(path, "http://localhost");
    const promise = handler({
      path: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams),
      method: init.method ?? "GET",
      headers: {
        ...init.headers,
        ...(init.credentials === "same-origin" ? { cookie } : {}),
      },
      body: init.body,
    }).then((r) => ({
      ok: r.statusCode >= 200 && r.statusCode < 300,
      status: r.statusCode,
      text: async () => r.body,
      json: async () => JSON.parse(r.body),
    }));
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
    return promise;
  });
}, 60000);
afterEach(async () => {
  cleanup();
  await Promise.all([...pending]);
});
// Dropping the scratch database waits for its connections to close, which
// outlasts vitest's 10 s default when the whole suite runs side by side;
// it gets the same minute as the setup.
// The handler's pool closes first: `drop database ... with (force)`
// otherwise terminates its idle connections under it, and each one
// logged a db_pool_error at the end of every run. A test that timed out
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
}, 60000);
async function clickReady(name) {
  const button = await screen.findByRole("button", { name, exact: true });
  // A committed DB write can precede delivery of its HTTP response. Wait for
  // the page to finish the operation before the next user action.
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}
/** The named button in the open question: a mis-click only ever gets here. */
async function confirmIt(name) {
  const dialog = await waitFor(() => {
    const d = document.querySelector("dialog.kit-confirm");
    expect(d).toBeTruthy();
    return d;
  });
  fireEvent.click(within(dialog).getByRole("button", { name, hidden: true }));
  await waitFor(() =>
    expect(document.querySelector("dialog.kit-confirm")).toBeNull(),
  );
}
function open(path) {
  window.history.pushState({}, "", path);
  render(<App />);
}

test(
  "a player claim and first captured snapshot become a usable first question",
  { timeout: 20000 },
  async () => {
    // Home's first step and Tracking offer the same field; this journey
    // uses Tracking, which manages what you track from then on.
    open("/settings/players");
    const input = await screen.findByLabelText("Player tag");
    fireEvent.change(input, { target: { value: "#00J" } });
    fireEvent.click(input.closest("form").querySelector("button"));
    await screen.findByText("#00J");
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
    await screen.findByText(/^read /);
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
    // The page reads the scratch database: under the whole suite's load
    // that can take past findBy's one second, so it waits for the read.
    await screen.findByText("Test client", {}, { timeout: 10_000 });
    await screen.findByText(/AI client you connected/);
    await screen.findByRole("heading", { name: "Try asking…" });
    const copy = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Copy question: Start with your latest profile",
      }),
    );
    await screen.findByText("Copied. Paste into your connected client.");
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
  { timeout: 20000 },
  async () => {
    await scratch.db.query(
      "insert into account_clan (account_id,clan_tag,scope) values ($1,'#0GG','comprehensive')",
      [accountId],
    );
    open("/settings/connections");
    fireEvent.click(await screen.findByRole("button", { name: "New agent" }));
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "journey-agent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await screen.findByText(/Copy this key now\./);
    // New agent opened in place, and the key is shown there, once.
    expect(window.location.pathname).toBe("/settings/connections");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // Open is the agent's page in Settings, at its public id.
    fireEvent.click(await screen.findByRole("link", { name: /journey-agent/ }));
    await screen.findByText("News it hasn't read");
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
    await waitFor(async () => {
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
    await screen.findByRole("button", { name: "Resume", exact: true });
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
    await screen.findAllByRole("button", { name: "Restore", exact: true });
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
    await screen.findByText("Removed agents (1)");
    expect(screen.queryByText("Open ›")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "journey-agent" }));
    // Restore brings it back among the agents, still suspended.
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        `/settings/agents/${publicId}/settings`,
      ),
    );
    const restore = await screen.findAllByRole("button", { name: "Restore" });
    fireEvent.click(restore[0]);
    await waitFor(async () => expect(await removedAt()).toBeNull());
    await clickReady("Resume");
    await screen.findByRole("button", { name: "Suspend", exact: true });
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
  { timeout: 20000 },
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
    const rowFor = async (client) =>
      (await screen.findByText(client)).closest(".kit-row");
    let row = await rowFor("Claude");
    await waitFor(() => expect(row.textContent).toContain("cr:read"));
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
    await waitFor(async () => {
      const { rows } = await scratch.db.query(
        `select scope from oauth_family where client_id = 'ui-scope'`,
      );
      expect(rows[0].scope).toBe("cr:read feedback:write");
    });
    row = await rowFor("Claude");
    await waitFor(() =>
      expect(row.textContent).toContain("cr:read feedback:write"),
    );

    // And back again: a capability can be taken away without disconnecting.
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    fireEvent.click(
      within(row).getByRole("checkbox", { name: /feedback:write/ }),
    );
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(async () => {
      const { rows } = await scratch.db.query(
        `select scope from oauth_family where client_id = 'ui-scope'`,
      );
      expect(rows[0].scope).toBe("cr:read");
    });
  },
  20000,
);
