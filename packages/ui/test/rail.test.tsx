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
  },
  { key: "collectors", label: "Collectors", icon: "server", to: "/c" },
];

test("wide: a list with groups, counts and dots", () => {
  const navigate = vi.fn();
  render(
    <Rail
      items={ITEMS}
      current="activity"
      navigate={navigate}
      narrow={false}
      title="Settings"
      label="Settings sections"
    />,
  );
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(nav).toBeTruthy();
  expect(screen.getByText("Your record")).toBeTruthy();
  expect(screen.getByText("3")).toBeTruthy();
  expect(
    screen.getByRole("img", { name: "Unread notifications" }),
  ).toBeTruthy();
  const on = screen.getByRole("link", { name: /Activity/ });
  expect(on.getAttribute("aria-current")).toBe("page");
  expect(
    screen
      .getByRole("link", { name: /Collectors/ })
      .getAttribute("aria-current"),
  ).toBeNull();
  // Head: the product; no disclosure to open.
  expect(screen.getByText("Settings")).toBeTruthy();
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
      navigate={vi.fn()}
      narrow
      title="Settings"
      subtitle="All settings"
    />,
  );
  const toggle = screen.getByRole("button", { expanded: false });
  expect(toggle.textContent).toContain("Activity");
  expect(toggle.textContent).toContain("All settings");
  expect(screen.queryByRole("navigation")).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
  expect(screen.getByRole("navigation")).toBeTruthy();
  // Following a link closes it.
  fireEvent.click(screen.getByRole("link", { name: /Overview/ }));
  expect(screen.queryByRole("navigation")).toBeNull();
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
  // A count of your own things waits for nobody.
  { key: "players", label: "Players", icon: "radar", to: "/k", meta: "4" },
  {
    key: "connections",
    label: "Connections",
    icon: "plug",
    to: "/c",
    dot: { tone: "alert", title: "A credential no longer works" },
  },
];

test("narrow, closed: one mark for what waits in another section, an alert beating unread", () => {
  const { rerender } = render(
    <Rail
      items={WAITING}
      current="overview"
      navigate={vi.fn()}
      narrow
      title="Settings"
    />,
  );
  const toggle = screen.getByRole("button", { expanded: false });
  const marks = toggle.querySelectorAll(".rail__dot");
  expect(marks).toHaveLength(1);
  const mark = screen.getByRole("img", {
    name: "Timeline: Unread notifications; Connections: A credential no longer works",
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
      items={WAITING}
      current="connections"
      navigate={vi.fn()}
      narrow
      title="Settings"
    />,
  );
  fireEvent.click(screen.getByRole("button", { expanded: true }));
  const only = screen.getByRole("img", {
    name: "Timeline: Unread notifications",
  });
  expect(only.className).toContain("rail__dot--unread");
});

test("narrow, closed: nothing waiting draws no mark, and a count alone draws none", () => {
  render(
    <Rail
      items={WAITING.filter((r) => r.key === "overview" || r.key === "players")}
      current="overview"
      navigate={vi.fn()}
      narrow
      title="Settings"
    />,
  );
  expect(
    screen.getByRole("button", { expanded: false }).querySelector(".rail__dot"),
  ).toBeNull();
});

test("wide: the column's contents sit in one pin", () => {
  render(
    <Rail
      items={WAITING}
      current="overview"
      navigate={vi.fn()}
      narrow={false}
      title="Settings"
    />,
  );
  const pin = document.querySelector(".rail > .rail__pin")!;
  expect(pin).toBeTruthy();
  expect(pin.querySelector("nav")).toBeTruthy();
  // The two dots, each on its own item.
  expect(document.querySelectorAll(".rail__dot")).toHaveLength(2);
});

test("narrow: no pin, the disclosure flows above the page", () => {
  render(
    <Rail
      items={WAITING}
      current="overview"
      navigate={vi.fn()}
      narrow
      title="Settings"
    />,
  );
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  expect(document.querySelector(".rail__pin")).toBeNull();
  expect(document.querySelector(".rail > nav")).toBeTruthy();
});
