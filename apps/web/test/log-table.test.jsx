/**
 * One log table, eleven pages.
 *
 * Step 5 of the 2026-09-09 handoff: Activity's three views and Admin's
 * six log pages are the same component with different columns, and
 * "adding a column must never mean a new table". The way that decays is
 * one page growing its own markup for one special case, so this asserts
 * the shape every one of them renders — a bare table with a sticky
 * header, no card around it, filters built from the rows, and a pager.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { LogTable } from "../src/components/LogTable.jsx";
import { Activity } from "../src/views/Activity.jsx";
import { Admin } from "../src/views/Admin.jsx";

const ME = { is_admin: true, is_owner: true };

function stub(body = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => {
      const p = String(path);
      const data = Object.entries(body).find(([k]) => p.includes(k))?.[1] ?? {};
      return {
        ok: true,
        status: 200,
        json: async () => data,
        text: async () => JSON.stringify(data),
      };
    }),
  );
}

beforeEach(() => {
  cleanup();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Every page in the console that is a log, and what it needs to have
 *  rows. If a page is added here it must go through LogTable too. */
const PAGES = [
  [
    "Activity ▸ Notifications",
    () => <Activity sub="notifications" navigate={() => {}} />,
    {
      "me/events": {
        events: [
          {
            event_id: "9",
            topic: "war_week_finished",
            subject_tag: "#C1",
            payload: {},
            created_at: "2026-09-09T06:02:00Z",
          },
        ],
        seen_through: 0,
      },
    },
  ],
  [
    "Activity ▸ MCP requests",
    () => <Activity sub="requests" navigate={() => {}} />,
    {
      "me/requests": {
        requests: [
          {
            created_at: "2026-09-09T18:44:02Z",
            tool: "war_current",
            token_name: "Claude Desktop",
            duration_ms: 84,
            request_id: "abcdef123456",
          },
        ],
      },
    },
  ],
  [
    "Activity ▸ Account events",
    () => <Activity sub="events" navigate={() => {}} />,
    {
      "me/activity": {
        events: [
          {
            created_at: "2026-09-09T09:12:00Z",
            kind: "claim_added",
            detail: { player_tag: "#L2QUVYY9" },
          },
        ],
      },
    },
  ],
  [
    "Admin ▸ Requests",
    () => <Admin me={ME} page="requests" navigate={() => {}} />,
    {
      "admin/requests": {
        requests: [
          {
            email_hash: "abcdef0123456789",
            requested_player_tag: "#P0Y",
            request_note: "clan leader",
            created_at: "2026-09-08T00:00:00Z",
          },
        ],
      },
    },
  ],
  [
    "Admin ▸ Accounts",
    () => <Admin me={ME} page="accounts" navigate={() => {}} />,
    {
      "admin/accounts": {
        accounts: [
          {
            account_id: "a1",
            email_hash: "abcdef0123456789",
            role: "leader",
            status: "approved",
            players_recording: 3,
            clans_recording: 2,
          },
        ],
        settable_roles: ["member", "leader"],
      },
    },
  ],
  [
    "Admin ▸ Feedback queue",
    () => <Admin me={ME} page="feedback" navigate={() => {}} />,
    {
      "admin/feedback": {
        feedback: [
          {
            feedback_id: 1,
            message: "Deck names do not match",
            category: "data_quality",
            status: "new",
            surface: "site",
            created_at: "2026-09-09T00:00:00Z",
          },
        ],
      },
    },
  ],
  [
    "Admin ▸ Collections",
    () => <Admin me={ME} page="collections" navigate={() => {}} />,
    {
      "admin/collections": {
        collections: [
          {
            slug: "war-carriers",
            title: "War carriers",
            kind: "player",
            visibility: "public",
            member_count: 12,
          },
        ],
      },
    },
  ],
  [
    "Admin ▸ Across accounts",
    () => <Admin me={ME} page="usage" navigate={() => {}} />,
    {
      "admin/usage": {
        accounts: [
          {
            account_id: "a1",
            email_hash: "abcdef0123456789",
            calls_7d: 1646,
            calls_today: 12,
            errors_7d: 3,
          },
        ],
        tools: [],
      },
    },
  ],
];

for (const [name, mount, body] of PAGES) {
  test(`${name} renders through the one log table`, async () => {
    stub(body);
    render(mount());
    const table = await waitFor(() => {
      const t = document.querySelector("table.table");
      expect(t, "not the shared table").toBeTruthy();
      return t;
    });
    // Interface, not a report: no card wrapping it, and the header rule
    // is the table's own.
    expect(table.closest(".panel"), "wrapped in a card").toBeNull();
    expect(table.querySelectorAll("thead th").length).toBeGreaterThan(1);
    // Every row has a cell for every header — a ragged row is how a
    // column gets added to the head and forgotten in the body.
    const heads = table.querySelectorAll("thead th").length;
    for (const row of table.querySelectorAll("tbody tr"))
      expect(row.children.length, `${name} row is ragged`).toBe(heads);
  });
}

test("filters offer what the rows contain, and narrow to it", () => {
  const rows = [
    ["09:00", "Claude Desktop", "ok"],
    ["09:01", "war-room", "refused"],
    ["09:02", "war-room", "ok"],
  ];
  render(
    <LogTable
      title="MCP requests"
      cols={[
        ["WHEN", "left"],
        ["CONNECTION", "left"],
        ["RESULT", "left"],
      ]}
      rows={rows}
      filters={[{ key: "connection", label: "Connection", col: 1 }]}
    />,
  );
  const select = screen.getByLabelText("Connection");
  // The options are the values present, not an enum that may have
  // drifted from them.
  expect([...select.options].map((o) => o.value).filter(Boolean)).toEqual([
    "Claude Desktop",
    "war-room",
  ]);
  fireEvent.change(select, { target: { value: "war-room" } });
  expect(document.querySelectorAll("tbody tr").length).toBe(2);
  expect(screen.getByText(/filtered from 3/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(document.querySelectorAll("tbody tr").length).toBe(3);
});

test("the pager moves a window over the rows and says which one", () => {
  const rows = Array.from({ length: 60 }, (_, i) => [`row ${i}`]);
  render(<LogTable title="Long" cols={[["N", "left"]]} rows={rows} />);
  expect(screen.getByText("1–25 of 60")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Newer" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Older" }));
  expect(screen.getByText("26–50 of 60")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Older" }));
  expect(screen.getByText("51–60 of 60")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Older" }).disabled).toBe(true);
});

test("an empty log says why it is empty rather than drawing a headed table", () => {
  render(
    <LogTable
      title="MCP requests"
      cols={[["WHEN", "left"]]}
      rows={[]}
      empty="No calls yet. A connection appears here the first time it reads."
    />,
  );
  expect(screen.getByText(/A connection appears here/)).toBeTruthy();
  expect(document.querySelector("table")).toBeNull();
});

test("a tone puts the dot and the ink on one value, never on two", () => {
  // Amber text on a green fill is the specific bug the one-tone rule
  // exists for, so ink and dot come from the same token.
  render(
    <LogTable
      title="Log"
      cols={[["RESULT", "left"]]}
      rows={[[{ text: "refused", tone: "bad" }]]}
    />,
  );
  const cell = document.querySelector("tbody td");
  const span = within(cell).getByText("refused");
  expect(span.style.color).toBe("var(--bad)");
  expect(cell.querySelector(".chip__dot").style.background).toBe("var(--bad)");
});
