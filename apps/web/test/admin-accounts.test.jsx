/**
 * The accounts list is a list of PEOPLE.
 *
 * An agent or an integration is an account in the schema (0053) — its own
 * door, its own connections — but it is not a signup: no email, no tier of
 * its own, and it arrives because somebody created it. Listing them beside
 * their owners made the queue of actual humans unreadable (Jamie,
 * 2026-09-10), so they are counted on the row and named on the record.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  within,
  fireEvent,
} from "@testing-library/react";
import { Admin } from "../src/views/Admin.jsx";

const PERSON = {
  account_id: "acct-1",
  email: "jamie@example.com",
  email_hash: "abcdef0123456789",
  status: "approved",
  role: "owner",
  is_owner: true,
  kind: "person",
  owned_by_account_id: null,
  children: 2,
  players_recording: 3,
  clans_recording: 1,
};
const AGENT = {
  account_id: "acct-2",
  email: null,
  email_hash: null,
  status: "approved",
  role: "member",
  kind: "agent",
  public_id: "a_7f3d",
  principal_name: "elixir-mcp-discord",
  owned_by_account_id: "acct-1",
  children: 0,
  players_recording: 0,
  clans_recording: 0,
};
const INTEGRATION = {
  ...AGENT,
  account_id: "acct-3",
  kind: "integration",
  public_id: "i_91aa",
  principal_name: "elixir-drop",
};

const ACCOUNTS = [PERSON, AGENT, INTEGRATION];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => {
      const body = path.includes("accounts")
        ? { accounts: ACCOUNTS, settable_roles: ["member", "leader"] }
        : { requests: [], tools: [], totals: {}, feedback: [], tokens: [] };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

test("the list carries people, and counts what each one runs", async () => {
  render(<Admin me={{ is_admin: true }} page="accounts" navigate={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByText("jamie@example.com")).toBeTruthy(),
  );

  // The agent and the integration are not rows of their own.
  expect(screen.queryByText("elixir-mcp-discord")).toBeNull();
  expect(screen.queryByText("elixir-drop")).toBeNull();

  const row = screen.getByText("jamie@example.com").closest("tr");
  expect(within(row).getByText("2")).toBeTruthy();
});

test("the record names the children and navigates to each", async () => {
  const navigate = vi.fn();
  render(
    <Admin
      me={{ is_admin: true }}
      page="accounts"
      itemId="acct-1"
      navigate={navigate}
    />,
  );
  await waitFor(() =>
    expect(screen.getByText("Agents and integrations")).toBeTruthy(),
  );
  expect(screen.getByText("agent")).toBeTruthy();
  expect(screen.getByText("integration")).toBeTruthy();

  fireEvent.click(screen.getByText("elixir-mcp-discord"));
  expect(navigate).toHaveBeenCalledWith("/admin/accounts/acct-2");
});

test("a child's record says whose it is, and leads back", async () => {
  const navigate = vi.fn();
  render(
    <Admin
      me={{ is_admin: true }}
      page="accounts"
      itemId="acct-2"
      navigate={navigate}
    />,
  );
  await waitFor(() => expect(screen.getByText(/belongs to/)).toBeTruthy());
  fireEvent.click(screen.getByText("jamie@example.com"));
  expect(navigate).toHaveBeenCalledWith("/admin/accounts/acct-1");
});
