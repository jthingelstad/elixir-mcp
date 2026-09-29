import { test, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Link,
  LogTable,
  NavigateProvider,
  Rail,
  type RailItem,
} from "../src/index.ts";

afterEach(cleanup);

/**
 * The kit's Link (review 2026-09-27 §7.5): a record link is a real
 * address, and the app takes over only the click a person means to stay
 * in the page with. Everything else is the browser's.
 */
const inApp = (navigate: (to: string) => void) =>
  render(
    <NavigateProvider navigate={navigate}>
      <Link to="/console/explore/player/20JJJ2CCRU">King Thing</Link>
    </NavigateProvider>,
  );

test("a Link always carries its href, so it focuses and copies", () => {
  inApp(vi.fn());
  const a = screen.getByRole("link", { name: "King Thing" });
  expect(a.getAttribute("href")).toBe("/console/explore/player/20JJJ2CCRU");
});

test("a plain primary click routes in-app and cancels the page load", () => {
  const navigate = vi.fn();
  inApp(navigate);
  const a = screen.getByRole("link", { name: "King Thing" });
  const followed = fireEvent.click(a, { button: 0 });
  expect(navigate).toHaveBeenCalledWith("/console/explore/player/20JJJ2CCRU");
  expect(followed).toBe(false); // preventDefault
});

test.each([
  ["Cmd", { metaKey: true }],
  ["Ctrl", { ctrlKey: true }],
  ["Shift", { shiftKey: true }],
  ["Alt", { altKey: true }],
  ["middle button", { button: 1 }],
])("a %s click is the browser's: a new tab, never the router", (_, init) => {
  const navigate = vi.fn();
  inApp(navigate);
  const a = screen.getByRole("link", { name: "King Thing" });
  const followed = fireEvent.click(a, init);
  expect(navigate).not.toHaveBeenCalled();
  expect(followed).toBe(true);
});

test("without a provider a Link is a plain anchor", () => {
  render(<Link to="/console/explore">Explore</Link>);
  const a = screen.getByRole("link", { name: "Explore" });
  expect(a.getAttribute("href")).toBe("/console/explore");
  expect(fireEvent.click(a)).toBe(true);
});

test("an outside address is never routed in-app", () => {
  const navigate = vi.fn();
  render(
    <NavigateProvider navigate={navigate}>
      <Link to="https://example.com/x">out</Link>
    </NavigateProvider>,
  );
  fireEvent.click(screen.getByRole("link", { name: "out" }));
  expect(navigate).not.toHaveBeenCalled();
});

test("a LogTable cell link is a Link; an outside one opens a new tab", () => {
  const navigate = vi.fn();
  render(
    <NavigateProvider navigate={navigate}>
      <LogTable
        title="Log"
        cols={[
          ["ID", "left"],
          ["SOURCE", "left"],
        ]}
        rows={[
          [
            { text: "abc123", href: "/console/account/activity/c/abc123" },
            { text: "source", href: "https://example.com/card" },
          ],
        ]}
      />
    </NavigateProvider>,
  );
  const id = screen.getByRole("link", { name: "abc123" });
  expect(id.getAttribute("href")).toBe("/console/account/activity/c/abc123");
  fireEvent.click(id, { metaKey: true });
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(id);
  expect(navigate).toHaveBeenCalledWith("/console/account/activity/c/abc123");
  const out = screen.getByRole("link", { name: "source" });
  expect(out.getAttribute("target")).toBe("_blank");
  expect(out.getAttribute("rel")).toContain("noopener");
});

test("the Rail leaves a modified click to the browser", () => {
  const navigate = vi.fn();
  const items: RailItem[] = [
    { key: "o", label: "Overview", icon: "layout-dashboard", to: "/o" },
  ];
  render(
    <Rail
      items={items}
      current="o"
      navigate={navigate}
      narrow={false}
      title="Console"
    />,
  );
  const a = screen.getByRole("link", { name: /Overview/ });
  expect(fireEvent.click(a, { ctrlKey: true })).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
  expect(fireEvent.click(a)).toBe(false);
  expect(navigate).toHaveBeenCalledWith("/o");
});
