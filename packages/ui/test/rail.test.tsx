import { test, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Rail, type RailItem } from "../src/index.ts";

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

test("back and foot: a way back above the head, a place or an action at the foot", () => {
  const navigate = vi.fn();
  const out = vi.fn();
  const { rerender } = render(
    <Rail
      items={ITEMS}
      current={null}
      navigate={navigate}
      narrow={false}
      title="Console"
      back={{ label: "Console", to: "/console/account/overview" }}
      foot={{
        label: "Send feedback",
        icon: "message-square",
        to: "/console/account/feedback",
        current: true,
      }}
    />,
  );
  fireEvent.click(screen.getByRole("link", { name: /Console/ }));
  expect(navigate).toHaveBeenCalledWith("/console/account/overview");
  const fb = screen.getByRole("link", { name: /Send feedback/ });
  expect(fb.getAttribute("aria-current")).toBe("page");
  fireEvent.click(fb);
  expect(navigate).toHaveBeenCalledWith("/console/account/feedback");
  // An action is a button, never a link.
  rerender(
    <Rail
      items={ITEMS}
      current={null}
      navigate={navigate}
      narrow={false}
      title="Console"
      foot={{ label: "Sign out of Elixir", icon: "log-out", onClick: out }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Sign out of Elixir/ }));
  expect(out).toHaveBeenCalled();
});

test("a group's heading is drawn once, where the group changes", () => {
  // Every item may name its group; the heading belongs to the run.
  render(
    <Rail
      items={[
        { key: "a", label: "Roster", icon: "users", to: "/a" },
        { group: "Social", key: "b", label: "Map", icon: "map", to: "/b" },
        { group: "Social", key: "c", label: "Recruit", icon: "x", to: "/c" },
        { group: "Manage", key: "d", label: "Scout", icon: "x", to: "/d" },
        // An older rail names the group on the first item only.
        { key: "e", label: "Settings", icon: "x", to: "/e" },
        { group: "You", key: "f", label: "Players", icon: "x", to: "/f" },
      ]}
      current="a"
      navigate={vi.fn()}
      narrow={false}
      title="Clan"
    />,
  );
  const headings = [...document.querySelectorAll(".rail__group")].map(
    (g) => g.textContent,
  );
  expect(headings).toEqual(["Social", "Manage", "You"]);
  // Scout's heading is the one right above it.
  const scout = screen.getByRole("link", { name: /Scout/ });
  expect(scout.previousElementSibling?.textContent).toBe("Manage");
});

const WAITING: RailItem[] = [
  { key: "overview", label: "Overview", icon: "x", to: "/o" },
  {
    key: "timeline",
    label: "Timeline",
    icon: "bell",
    to: "/t",
    dot: { tone: "unread", title: "Unread notifications" },
  },
  // A count of your own things is not attention.
  { key: "tracking", label: "Tracking", icon: "radar", to: "/k", meta: "4" },
  {
    key: "connections",
    label: "Connections",
    icon: "plug",
    to: "/c",
    dot: { tone: "alert", title: "A credential no longer works" },
  },
  {
    key: "actions",
    label: "Actions",
    icon: "inbox",
    to: "/a",
    meta: "2",
    attention: "2 waiting for you",
  },
];

test("narrow, closed: one mark for what waits in another section, an alert beating unread", () => {
  const { rerender } = render(
    <Rail
      items={WAITING}
      current="overview"
      navigate={vi.fn()}
      narrow
      title="Console"
    />,
  );
  const toggle = screen.getByRole("button", { expanded: false });
  const marks = toggle.querySelectorAll(".rail__dot");
  expect(marks).toHaveLength(1);
  const mark = screen.getByRole("img", {
    name: "Timeline: Unread notifications; Connections: A credential no longer works; Actions: 2 waiting for you",
  });
  expect(mark.className).toContain("rail__dot--alert");
  expect(mark.getAttribute("title")).toBe(mark.getAttribute("aria-label"));
  // Open, the list shows each item's own; the row's mark goes.
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
  expect(screen.queryByRole("img", { name: /Timeline:/ })).toBeNull();
  expect(
    screen.getByRole("img", { name: "Unread notifications" }),
  ).toBeTruthy();

  // On the section that waits, its own is not counted: unread remains
  // from the timeline once the alert is the current page's.
  rerender(
    <Rail
      items={WAITING.filter((r) => r.key !== "timeline")}
      current="connections"
      navigate={vi.fn()}
      narrow
      title="Console"
    />,
  );
  fireEvent.click(screen.getByRole("button", { expanded: true }));
  const only = screen.getByRole("img", {
    name: "Actions: 2 waiting for you",
  });
  expect(only.className).toContain("rail__dot--unread");
});

test("narrow, closed: nothing waiting draws no mark, and a count alone is not attention", () => {
  render(
    <Rail
      items={WAITING.filter(
        (r) => r.key === "overview" || r.key === "tracking",
      )}
      current="overview"
      navigate={vi.fn()}
      narrow
      title="Console"
    />,
  );
  expect(
    screen.getByRole("button", { expanded: false }).querySelector(".rail__dot"),
  ).toBeNull();
});

test("wide: the column's contents sit in one pin, and attention draws nothing new", () => {
  render(
    <Rail
      items={WAITING}
      current="overview"
      navigate={vi.fn()}
      narrow={false}
      title="Console"
      foot={{
        label: "Send feedback",
        icon: "message-square",
        onClick: vi.fn(),
      }}
    />,
  );
  const pin = document.querySelector(".rail > .rail__pin")!;
  expect(pin).toBeTruthy();
  expect(pin.querySelector("nav")).toBeTruthy();
  expect(pin.querySelector(".rail__foot")).toBeTruthy();
  // The two dots, each on its own item; Actions keeps only its count.
  expect(document.querySelectorAll(".rail__dot")).toHaveLength(2);
  expect(
    screen.getByRole("link", { name: /Actions/ }).querySelector(".rail__dot"),
  ).toBeNull();
  expect(screen.getByRole("link", { name: /Actions/ }).textContent).toContain(
    "2",
  );
});

test("narrow: no pin, the disclosure flows above the page", () => {
  render(
    <Rail
      items={WAITING}
      current="overview"
      navigate={vi.fn()}
      narrow
      title="Console"
    />,
  );
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  expect(document.querySelector(".rail__pin")).toBeNull();
  expect(document.querySelector(".rail > nav")).toBeTruthy();
});
