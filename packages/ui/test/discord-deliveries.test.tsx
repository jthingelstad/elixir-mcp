import { test, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DiscordDeliveries } from "../src/index.ts";

afterEach(cleanup);

/**
 * A Discord channel's last deliveries (2026-10-11): what happened to
 * each, Discord's own words for a refusal, and the count that did not
 * arrive; nothing at all before the first.
 */
test("each delivery says what happened, a refusal in Discord's words, and the misses are counted", () => {
  render(
    <DiscordDeliveries
      notDelivered={2}
      entries={[
        {
          at: "2026-10-11T12:00:00Z",
          outcome: "refused",
          ref: "#12",
          http_status: 400,
          reason: "Invalid Form Body",
          excerpt: "Promote to Elder",
        },
        { at: "2026-10-11T11:00:00Z", outcome: "posted", ref: "#11" },
        { at: "2026-10-11T10:00:00Z", outcome: "unknown" },
      ]}
    />,
  );
  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(items[0]?.textContent).toContain("Refused");
  expect(items[0]?.textContent).toContain(
    "Discord: HTTP 400, Invalid Form Body",
  );
  expect(items[1]?.textContent).toContain("Posted#11");
  expect(items[2]?.textContent).toContain("No answer");
  expect(screen.getByText(/2 not delivered in 30 days/)).toBeTruthy();
});

test("nothing is drawn before the first delivery", () => {
  const { container } = render(<DiscordDeliveries entries={[]} />);
  expect(container.textContent).toBe("");
});

test("a clan's activity line is shown whole and says when the clan's model wrote it; an item's id is not shown", () => {
  const long = `Ada joined us ${"and stayed ".repeat(20)}`.trim();
  render(
    <DiscordDeliveries
      whole
      entries={[
        {
          at: "2026-10-11T12:00:00Z",
          outcome: "posted",
          ref: "tl_0123456789abcdef0123",
          excerpt: long,
          rewritten: true,
        },
      ]}
    />,
  );
  const [item] = screen.getAllByRole("listitem");
  expect(item?.textContent).toContain("by the clan’s model");
  expect(item?.textContent).toContain(long);
  expect(item?.textContent).not.toContain("tl_");
  expect(screen.getByText(long).className).not.toContain("truncate");
});

test("all twenty the history keeps are listed", () => {
  render(
    <DiscordDeliveries
      entries={Array.from({ length: 20 }, (_, i) => ({
        at: new Date(Date.UTC(2026, 9, 11, 12, i)).toISOString(),
        outcome: "posted" as const,
      }))}
    />,
  );
  expect(screen.getAllByRole("listitem")).toHaveLength(20);
});

test("a story the clan's channel skipped says why, and is not counted as missed", () => {
  render(
    <DiscordDeliveries
      whole
      entries={[
        {
          at: "2026-10-11T12:00:00Z",
          outcome: "skipped",
          ref: "tl_0123456789abcdef0123",
          reason: "A badge level-up below its top level.",
          excerpt: "Ada took Hog Mastery to level 5.",
        },
      ]}
    />,
  );
  const [item] = screen.getAllByRole("listitem");
  expect(item?.textContent).toContain("Skipped");
  expect(item?.textContent).toContain("A badge level-up below its top level.");
  expect(item?.className).not.toContain("text-warn");
});

test("a post is rated thumbs up or down with an optional note; one never sent, or a page with nowhere to send it, offers nothing", async () => {
  const onRate = vi.fn(async () => ({ ok: true }));
  render(
    <DiscordDeliveries
      entries={[
        {
          at: "2026-10-11T12:00:00Z",
          outcome: "posted",
          excerpt: "Ada joined us.",
          ledger_id: "aaaaaaaa-0000-4000-8000-000000000001",
        },
        {
          at: "2026-10-11T11:00:00Z",
          outcome: "posted",
          ledger_id: "aaaaaaaa-0000-4000-8000-000000000002",
        },
        { at: "2026-10-11T10:00:00Z", outcome: "posted" },
      ]}
      ratings={{ "aaaaaaaa-0000-4000-8000-000000000002": { rating: "down" } }}
      onRate={onRate}
    />,
  );
  const items = screen.getAllByRole("listitem");
  expect(items[1]?.textContent).toContain("Your rating");
  expect(items[2]?.querySelector("button")).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "A good post" })[0]!);
  fireEvent.change(screen.getByLabelText("A note (optional)"), {
    target: { value: "  Just right. " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Thanks: Elixir reads every rating.");
  expect(onRate).toHaveBeenCalledWith({
    ledger_id: "aaaaaaaa-0000-4000-8000-000000000001",
    rating: "up",
    note: "Just right.",
  });
  cleanup();
  render(
    <DiscordDeliveries
      entries={[
        {
          at: "2026-10-11T12:00:00Z",
          outcome: "posted",
          ledger_id: "aaaaaaaa-0000-4000-8000-000000000001",
        },
      ]}
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
});

test("a refused rating says so in the server's words", async () => {
  const onRate = vi.fn(async () => ({
    ok: false,
    data: { message: "That post is not in this history." },
  }));
  render(
    <DiscordDeliveries
      entries={[
        {
          at: "2026-10-11T12:00:00Z",
          outcome: "posted",
          ledger_id: "aaaaaaaa-0000-4000-8000-000000000001",
        },
      ]}
      onRate={onRate}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "A poor post" }));
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("That post is not in this history.");
  expect(onRate).toHaveBeenCalledWith({
    ledger_id: "aaaaaaaa-0000-4000-8000-000000000001",
    rating: "down",
  });
});
