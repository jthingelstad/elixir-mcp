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
import { scratchDb } from "../../../services/ingest/test/helpers.mjs";
import { makeHandler } from "../../../services/web-api/src/handler.mjs";
import { createSession, emailHash } from "../../../services/auth/src/index.mjs";

// These assertions include real PostgreSQL round trips, not resolved mocks.
// Bound the wait, but do not turn Testing Library's unit-test default (1s)
// into an accidental latency SLO for shared CI runners.
configure({ asyncUtilTimeout: 5000 });
let scratch, handler, cookie, accountId;
const pending = new Set();
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
      rawPath: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams),
      requestContext: {
        http: { method: init.method ?? "GET", sourceIp: "127.0.0.1" },
      },
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
}, 15000);
afterEach(async () => {
  cleanup();
  await Promise.all([...pending]);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await scratch?.drop();
});
async function clickReady(name) {
  const button = await screen.findByRole("button", { name, exact: true });
  // A committed DB write can precede delivery of its HTTP response. Wait for
  // the page to finish the operation before the next user action.
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}
function open(path) {
  window.history.pushState({}, "", path);
  render(<App />);
}

test(
  "a player claim and first captured snapshot become a usable first question",
  { timeout: 20000 },
  async () => {
    open("/account/overview");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add your player",
        exact: true,
      }),
    );
    const input = document.getElementById("add-player-tag");
    fireEvent.change(input, { target: { value: "#P0Y" } });
    fireEvent.click(input.parentElement.querySelector("button"));
    await screen.findByText("Waiting for the first capture");
    expect(
      (
        await scratch.db.query(
          "select player_tag from claim where account_id=$1",
          [accountId],
        )
      ).rows,
    ).toEqual([{ player_tag: "#P0Y" }]);
    await scratch.db.query(
      "insert into player_snapshot_daily (player_tag,snapshot_date,snapshot_kind,observed_at) values ('#P0Y',current_date,'daily',now())",
    );
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByRole("button", {
      name: "Copy question: Start with your player snapshot",
    });
    // Consent is fixture setup on the scratch DB; the UI consumes the real
    // connection and readiness responses after returning from OAuth.
    await scratch.db.query(
      "insert into oauth_client (client_id,client_name,redirect_uris,expires_at) values ('journey-client','Test client','[]',now()+interval '1 day')",
    );
    await scratch.db.query(
      "insert into oauth_family (client_id,account_id,absolute_expires_at) values ('journey-client',$1,now()+interval '1 day')",
      [accountId],
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Connect your client", exact: true }),
    );
    await screen.findByText("Test client");
    await screen.findByText(/AI client you connected/);
    await screen.findByRole("heading", { name: "Try asking…" });
    const copy = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: copy },
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Copy question: Start with your player snapshot",
      }),
    );
    await screen.findByText("Copied — paste into your connected client.");
    expect(copy.mock.calls[0][0]).toContain("#P0Y");
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
  "create an agent, open its detail, rotate its key, suspend and resume it",
  { timeout: 20000 },
  async () => {
    await scratch.db.query(
      "insert into account_clan (account_id,clan_tag,scope) values ($1,'#P0G','comprehensive')",
      [accountId],
    );
    open("/account/agents");
    fireEvent.change(await screen.findByPlaceholderText("agent name"), {
      target: { value: "journey-agent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await screen.findByText("Copy this key now.");
    fireEvent.click(await screen.findByText("Open ›"));
    await screen.findByText("Unread notifications");
    const agentId = window.location.pathname.split("/").at(-1);
    expect(
      (
        await scratch.db.query(
          "select kind,owned_by_account_id from account where account_id=$1",
          [agentId],
        )
      ).rows[0],
    ).toEqual({ kind: "agent", owned_by_account_id: accountId });
    await clickReady("Issue a new key");
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
    await screen.findByRole("button", { name: "Resume", exact: true });
    expect(
      (
        await scratch.db.query(
          "select status from account where account_id=$1",
          [agentId],
        )
      ).rows[0].status,
    ).toBe("disabled");
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

test(
  "admin provisions and suspends a platform integration with a collection grant",
  { timeout: 20000 },
  async () => {
    await scratch.db.query(
      "update account set role='admin' where account_id=$1",
      [accountId],
    );
    const c = (
      await scratch.db.query(
        "insert into collection(slug,title,kind,owner_account) values('ui-integration','Integration players','player',$1) returning collection_id",
        [accountId],
      )
    ).rows[0];
    open("/admin/integrations");
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "ui-platform" },
    });
    await screen.findByRole("option", {
      name: "Integration players (ui-integration)",
    });
    fireEvent.change(screen.getByLabelText("Allow additions to collection"), {
      target: { value: c.collection_id },
    });
    await clickReady("Create and issue key");
    await screen.findByText("Copy this key now. It is shown once.");
    await screen.findByText("ui-platform");
    await clickReady("Dismiss key");
    await clickReady("Suspend");
    await screen.findByText("Suspended");
    const row = (
      await scratch.db.query(
        "select a.kind,a.role,a.status from integration i join account a using(account_id) where i.name='ui-platform'",
      )
    ).rows[0];
    expect(row).toEqual({
      kind: "integration",
      role: "partner",
      status: "disabled",
    });
  },
);

/**
 * Capabilities are editable on a live connection, without disconnecting it.
 *
 * The client's authorize request decides scope, so an app that never asks
 * for a capability could not be allowed one from anywhere. This is the
 * surface where the person decides instead.
 */
test("a connection's capabilities can be widened and narrowed in place", async () => {
  await scratch.db.query(
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
       values ('ui-scope', 'Claude', '[]', now() + interval '30 days')
       on conflict do nothing`,
  );
  await scratch.db.query(
    `insert into oauth_family (client_id, account_id, absolute_expires_at, scope)
       values ('ui-scope', $1, now() + interval '90 days', 'cr:read')`,
    [accountId],
  );

  open("/account/connections");
  // It starts read-only, showing exactly what the client was granted. The
  // page names scopes in more than one place, so assert on the row itself.
  // Other journeys in this file leave their own connections behind, so every
  // query is scoped to THIS row rather than the whole page.
  const rowFor = async (client) =>
    (await screen.findByText(client)).closest("tr");
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
}, 20000);
