import { test, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Rail,
  RailIdentity,
  type RailAccount,
  type RailItem,
} from "../src/index.ts";

afterEach(cleanup);

const ITEMS: RailItem[] = [
  { key: "overview", label: "Overview", icon: "layout-dashboard", to: "/o" },
  {
    group: "Your record",
    key: "activity",
    label: "Activity",
    icon: "activity",
    to: "/a",
    meta: "3",
    dot: { tone: "unread", title: "Unread notifications" },
    subs: [
      { slug: "notifications", label: "Notifications", to: "/a" },
      { slug: "requests", label: "MCP requests", to: "/a/requests" },
    ],
  },
  {
    key: "collectors",
    label: "Collectors",
    icon: "server",
    to: "/c",
    subs: [{ slug: "fleet", label: "Fleet", to: "/c/fleet" }],
  },
];

test("wide: a list with groups, counts, dots, and the current item's subs only", () => {
  const navigate = vi.fn();
  render(
    <Rail
      items={ITEMS}
      current="activity"
      sub="requests"
      navigate={navigate}
      narrow={false}
      title="Console"
      aside="leader"
      label="Console sections"
    />,
  );
  const nav = screen.getByRole("navigation", { name: "Console sections" });
  expect(nav).toBeTruthy();
  expect(screen.getByText("Your record")).toBeTruthy();
  expect(screen.getByText("3")).toBeTruthy();
  expect(
    screen.getByRole("img", { name: "Unread notifications" }),
  ).toBeTruthy();
  // The current item, and only it, has its sub-pages under it.
  const on = screen.getByRole("link", { name: /Activity/ });
  expect(on.getAttribute("aria-current")).toBe("page");
  expect(
    screen
      .getByRole("link", { name: "MCP requests" })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(screen.queryByRole("link", { name: "Fleet" })).toBeNull();
  // Head: the product and the aside; no disclosure to open.
  expect(screen.getByText("Console")).toBeTruthy();
  expect(screen.getByText("leader")).toBeTruthy();
  expect(screen.queryByRole("button", { expanded: false })).toBeNull();
  // A click navigates in-app and never follows the href.
  const ev = fireEvent.click(screen.getByRole("link", { name: /Overview/ }));
  expect(ev).toBe(false);
  expect(navigate).toHaveBeenCalledWith("/o");
});

test("narrow: a disclosure above the content naming where you are, opening to the same list", () => {
  render(
    <Rail
      items={ITEMS}
      current="activity"
      sub="requests"
      navigate={vi.fn()}
      narrow
      title="Console"
    />,
  );
  const toggle = screen.getByRole("button", { expanded: false });
  expect(toggle.textContent).toContain("Activity");
  expect(toggle.textContent).toContain("MCP requests");
  expect(screen.queryByRole("navigation")).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
  expect(screen.getByRole("navigation")).toBeTruthy();
  // Following a link closes it.
  fireEvent.click(screen.getByRole("link", { name: /Overview/ }));
  expect(screen.queryByRole("navigation")).toBeNull();
});

test("the identity block: who you are, the way to the profile, and the way out as an action", () => {
  const onClick = vi.fn((e) => e.preventDefault());
  const out = vi.fn();
  render(
    <Rail
      items={ITEMS}
      current="overview"
      navigate={vi.fn()}
      narrow={false}
      title="Console"
      identity={
        <RailIdentity
          href="/profile"
          onClick={onClick}
          name="jamie@example.com"
          title="jamie@example.com"
          detail="leader · America/Chicago"
          action={
            <button type="button" aria-label="Sign out" onClick={out}>
              out
            </button>
          }
        />
      }
    />,
  );
  const link = screen.getByRole("link", { name: /jamie@example.com/ });
  expect(link.getAttribute("href")).toBe("/profile");
  expect(screen.getByText("leader · America/Chicago")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(out).toHaveBeenCalled();
  fireEvent.click(link);
  expect(onClick).toHaveBeenCalled();
});

const ACCOUNTS: [RailAccount, RailAccount] = [
  { key: "me", label: "Jamie", aside: "owner", to: "/account/overview" },
  {
    key: "abc12345",
    label: "poap-bot",
    detail: "POAP KINGS",
    aside: "agent · leader",
    to: "/agent/abc12345/overview",
  },
];

test("accounts: the head is the selector, and choosing one goes to its console", () => {
  const navigate = vi.fn();
  render(
    <Rail
      items={ITEMS}
      current="overview"
      navigate={navigate}
      narrow={false}
      title="Console"
      accounts={ACCOUNTS}
      account="me"
      manage={{ label: "Manage agents…", to: "/account/agents" }}
    />,
  );
  const head = screen.getByRole("button", { name: /Jamie/ });
  expect(head.getAttribute("aria-expanded")).toBe("false");
  expect(head.textContent).toContain("owner");
  expect(head.closest(".rail__switch")?.getAttribute("data-scoped")).toBe(
    "false",
  );
  fireEvent.click(head);
  expect(screen.getByRole("link", { name: /poap-bot/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Manage agents/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: /poap-bot/ }));
  expect(navigate).toHaveBeenCalledWith("/agent/abc12345/overview");
  expect(screen.queryByRole("link", { name: /Manage agents/ })).toBeNull();
  // Escape closes it too.
  fireEvent.click(head);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("link", { name: /Manage agents/ })).toBeNull();
});

test("accounts: an agent's console is tinted, and the selector stays in the narrow closed row", () => {
  render(
    <Rail
      items={ITEMS}
      current="overview"
      navigate={vi.fn()}
      narrow
      title="Console"
      accounts={ACCOUNTS}
      account="abc12345"
    />,
  );
  const head = screen.getByRole("button", { name: /poap-bot/ });
  expect(head.textContent).toContain("agent · leader");
  expect(head.closest(".rail__switch")?.getAttribute("data-scoped")).toBe(
    "true",
  );
  // The section disclosure is closed, and the selector is still there.
  expect(screen.queryByRole("navigation")).toBeNull();
});

test("one account or none: the head is the plain title, as before", () => {
  render(
    <Rail
      items={ITEMS}
      current="overview"
      navigate={vi.fn()}
      narrow={false}
      title="Console"
      aside="member"
      accounts={[ACCOUNTS[0]]}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("Console")).toBeTruthy();
  expect(screen.getByText("member")).toBeTruthy();
});
