/**
 * The accounts list is a list of people: every account is one (0317).
 * Test identities and deleted accounts are named for what they are, and
 * the record's Delete account runs a dry run before it deletes.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  screen,
  waitFor,
  cleanup,
  within,
  fireEvent,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Admin } from "../src/views/Admin.jsx";

const PERSON = {
  account_id: "acct-1",
  email: "jamie@example.com",
  email_hash: "abcdef0123456789",
  status: "approved",
  role: "owner",
  is_owner: true,
  players_tracked: 3,
  clans_tracked: 1,
};

const ACCOUNTS = [PERSON];

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

test("the list carries people, and says so", async () => {
  renderWithProviders(
    <Admin me={{ is_admin: true }} page="accounts" navigate={vi.fn()} />,
  );
  await waitFor(() =>
    expect(screen.getByText("jamie@example.com")).toBeTruthy(),
  );
  expect(screen.getByText(/^Every account is a person\./)).toBeTruthy();
  expect(screen.queryByText(/Agents|integrations/i)).toBeNull();
});

// Deleting accounts from Admin (2026-11-23).
const TEST_ID = {
  ...PERSON,
  account_id: "acct-4",
  email: null,
  email_hash: "test:gym",
  role: "member",
  is_owner: false,
  test_name: "gym",
  removed: false,
  last_active_at: null,
};
const MEMBER = {
  ...PERSON,
  account_id: "acct-6",
  email: "member@example.com",
  email_hash: "0123456789abcdef",
  role: "member",
  is_owner: false,
  removed: false,
};
const TOMBSTONE = {
  ...PERSON,
  account_id: "acct-5abcdef",
  email: null,
  email_hash: "removed:xyz",
  role: "member",
  is_owner: false,
  removed: true,
};

function stubAccounts(accounts, onRemove = () => ({})) {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, init) => {
      const p = String(path);
      let body;
      if (p === "/api/admin/accounts/remove") {
        const sent = JSON.parse(init.body);
        calls.push(sent);
        body = onRemove(sent);
      } else body = { accounts, settable_roles: ["member", "partner"] };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }),
  );
  return calls;
}

test("test identities read Test: and their name; deleted accounts wait behind a toggle", async () => {
  stubAccounts([PERSON, TEST_ID, TOMBSTONE]);
  renderWithProviders(
    <Admin me={{ is_admin: true }} page="accounts" navigate={vi.fn()} />,
  );
  await screen.findByText("Test: gym");
  expect(screen.queryByText(/^Deleted ·/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show 1 removed" }));
  await screen.findByText("Deleted · acct-5ab");
  expect(screen.getAllByText("never").length).toBeGreaterThan(0);
});

test("the record's Delete account runs a dry run first, then deletes and goes back", async () => {
  const navigate = vi.fn();
  const calls = stubAccounts([PERSON, MEMBER], (sent) => ({
    ok: true,
    account_id: sent.account_id,
    dry_run: sent.dry_run,
    removed: { session: 2, claim: 1, feedback: 0 },
    subjects: 1,
    mail_archived: 3,
  }));
  renderWithProviders(
    <Admin
      me={{ is_admin: true }}
      page="accounts"
      itemId="acct-6"
      navigate={navigate}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Dry run" }));
  await screen.findByText(/session 2 · claim 1/);
  expect(screen.queryByText(/feedback 0/)).toBeNull();
  expect(calls).toEqual([{ account_id: "acct-6", dry_run: true }]);
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete account" }),
  );
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith("/settings/admin/accounts"),
  );
  expect(calls.at(-1)).toEqual({ account_id: "acct-6", dry_run: false });
});

test("a suite's test identity carries a warning; the owner has no delete", async () => {
  stubAccounts([PERSON, TEST_ID]);
  renderWithProviders(
    <Admin
      me={{ is_admin: true }}
      page="accounts"
      itemId="acct-4"
      navigate={vi.fn()}
    />,
  );
  await screen.findByText(/gym suite’s test identity/);
  cleanup();
  renderWithProviders(
    <Admin
      me={{ is_admin: true }}
      page="accounts"
      itemId="acct-1"
      navigate={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: "Save grant" });
  expect(screen.queryByRole("button", { name: "Dry run" })).toBeNull();
});
