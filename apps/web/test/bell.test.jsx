/**
 * The bell's sheet (#765): every link out of it closes it, the rest-of-
 * the-list link included. On a Clan page the shell stays mounted across
 * the navigation, so a link that left the sheet open would leave Run's
 * Waiting behind a modal. Invented names only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "../src/client/index.ts";
import { renderWithProviders } from "./helpers.jsx";
import { BellSheet } from "../src/shell/Bell.jsx";
import { readMemberItemPath } from "@elixir-mcp/ui/item-link";

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const CLAN = {
  ok: true,
  state: "member",
  clan_tag: "#0QC8RCGY",
  name: "Ada's Clan",
  role: "leader",
  verified: true,
  members: 40,
  min_members: 10,
  needs: [
    {
      number: 41,
      type: "departure",
      label: "Departure",
      subject_name: "Ada",
      left_at: "2026-11-12T10:00:00.000Z",
    },
  ],
  needs_total: 4,
};

beforeEach(() => {
  cleanup();
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path) => {
    const p = String(path);
    if (p === "/api/me/home/needs") return reply({ needs: CLAN });
    if (p === "/api/me/home/clan") return reply({ clan: CLAN });
    return reply({});
  });
});
afterEach(() => vi.restoreAllMocks());

test("the rest-of-the-list link closes the sheet, as each Action's does", async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
  };
  const onClose = vi.fn();
  const navigate = vi.fn();
  renderWithProviders(
    <BellSheet me={{}} onClose={onClose} navigate={navigate} />,
  );
  const more = await screen.findByRole("link", {
    name: /See \d+ more in Clan/,
    hidden: true,
  });
  fireEvent.click(more);
  expect(onClose).toHaveBeenCalledTimes(1);
});

// The bell's own read (2026-11-12): reactions as counts, never who;
// followers named by their verified player, else counted; answers to your
// feedback. Opening the sheet moves the seen marker once.
const BELL = {
  seen_at: null,
  players: 1,
  new: 3,
  reactions: {
    new: 1,
    items: [
      {
        item_id: "tl_0123456789abcdef0123",
        text: "Invented Owner won five in a row",
        at: "2026-11-12T10:00:00.000Z",
        battle_url: "https://elixir.example/battle/abc123",
        cheers: { on_fire: 2, royal: 1 },
        total: 3,
        new: true,
      },
    ],
  },
  followers: {
    count: 4,
    new: 2,
    no_player: 2,
    unnamed: 2,
    players: [
      {
        tag: "#0VQRR8U0",
        name: "Invented Fan",
        verified: true,
        followed_tag: "#0QRVVG22J",
        followed_name: "Invented Owner",
        new: true,
      },
      {
        tag: "#0Q2L8",
        name: "Invented Claimer",
        verified: false,
        followed_tag: "#0QRVVG22J",
        followed_name: "Invented Owner",
        new: true,
        can_follow_back: true,
      },
    ],
  },
  answers: {
    new: 1,
    items: [
      {
        id: 42,
        about: "The war tab is slow",
        status: "planned",
        responded_at: "2026-11-11T10:00:00.000Z",
        new: true,
      },
    ],
  },
};

test("the bell's sections: counts not cheerers, named and counted followers, answers; the marker moves once", async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
  };
  const calls = [];
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path);
    calls.push([init?.method ?? "GET", p]);
    if (p === "/api/me/bell") return reply(BELL);
    if (p === "/api/me/bell/seen")
      return reply({ seen_at: "2026-11-12T12:00:00.000Z" });
    if (p === "/api/me/home/needs") return reply({ needs: CLAN });
    if (p === "/api/me/home/clan") return reply({ clan: CLAN });
    return reply({});
  });
  renderWithProviders(<BellSheet me={{}} onClose={() => {}} />);
  // One inbox (#1009): Needs you first, then New; each row is its link.
  const fresh = await screen.findByRole("region", {
    name: "New",
    hidden: true,
  });
  const needs = screen.getByRole("region", { name: "Needs you", hidden: true });
  expect(
    needs.compareDocumentPosition(fresh) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(fresh.textContent).toContain("Invented Owner won five in a row");
  // Counts, never who; no explanatory line any more.
  expect(fresh.querySelector('[aria-label="On fire 2, Royal 1"]')).toBeTruthy();
  expect(document.body.textContent).not.toContain("never who cheered");
  const hrefs = [...fresh.querySelectorAll("a")].map((a) =>
    a.getAttribute("href"),
  );
  // Newest first across kinds; followers carry no time, so they follow.
  expect(hrefs).toEqual([
    "/battle/abc123",
    "/settings/feedback/42",
    "/home/player/0VQRR8U0",
    "/home/player/0Q2L8",
  ]);
  expect(fresh.textContent).toContain("Invented Fan follows you");
  // A claimed player is named, marked not verified, with no gold mark,
  // and offered Follow back as anyone else is (Jamie, 2026-11-14).
  const claimed = [...fresh.querySelectorAll(".kit-bell__item")].find((li) =>
    li.textContent.includes("Invented Claimer follows you"),
  );
  expect(claimed).toBeTruthy();
  expect(claimed.textContent).toContain("Not verified");
  expect(claimed.querySelector(".kit-verified")).toBeNull();
  expect(
    within(claimed).getByRole("button", { name: /Follow back/, hidden: true }),
  ).toBeTruthy();
  expect(fresh.textContent).toContain("Elixir answered your feedback");
  const earlier = screen.getByRole("region", { name: "Earlier", hidden: true });
  expect(earlier.textContent).toContain(
    "2 more followers with no player added yet",
  );
  expect(earlier.textContent).not.toContain("not listed here");
  // No separate Open buttons: Needs you's rows are links too.
  expect(needs.querySelectorAll("a.btn")).toHaveLength(0);
  expect(needs.querySelector("a").getAttribute("href")).toBe(
    "/clan/0QC8RCGY/actions/41",
  );
  // What was new when it opened stays marked while it is open.
  await waitFor(() =>
    expect(calls).toContainEqual(["PUT", "/api/me/bell/seen"]),
  );
  expect(document.querySelectorAll(".kit-bell__new").length).toBe(4);
  expect(calls.filter(([m]) => m === "PUT")).toHaveLength(1);
});

test("no verified player: the bell says how to get cheers and followers", async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  global.fetch = vi.fn(async (path) => {
    const p = String(path);
    if (p === "/api/me/bell")
      return reply({
        ...BELL,
        players: 0,
        new: 0,
        reactions: { items: [], new: 0 },
        followers: { count: 0, new: 0, unnamed: 0, players: [] },
        answers: { items: [], new: 0 },
      });
    if (p === "/api/me/home/needs") return reply({ needs: null });
    return reply({});
  });
  renderWithProviders(<BellSheet me={{}} onClose={() => {}} />);
  const verify = await screen.findByRole("link", {
    name: /^Verify your player/,
    hidden: true,
  });
  expect(verify.getAttribute("href")).toBe("/settings/players/verify");
});

test("a new follower's verified player has Follow back, the one confirmed Follow; one you follow has none", async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  const followers = {
    ...BELL.followers,
    unnamed: 0,
    players: [
      { ...BELL.followers.players[0], can_follow_back: true },
      {
        tag: "#0VJLCPJ0",
        name: "Invented Friend",
        followed_tag: "#0QRVVG22J",
        followed_name: "Invented Owner",
        new: false,
        can_follow_back: false,
      },
    ],
  };
  global.fetch = vi.fn(async (path) => {
    const p = String(path);
    if (p === "/api/me/bell") return reply({ ...BELL, followers });
    if (p === "/api/me/home/needs") return reply({ needs: null });
    return reply({});
  });
  renderWithProviders(<BellSheet me={{}} onClose={() => {}} />);
  const back = await screen.findAllByRole("button", {
    name: /Follow back/,
    hidden: true,
  });
  expect(back).toHaveLength(1);
  // Both names still open the player's page.
  const hrefs = [...document.querySelectorAll("dialog a")].map((a) =>
    a.getAttribute("href"),
  );
  expect(hrefs).toContain("/home/player/0VQRR8U0");
  expect(hrefs).toContain("/home/player/0VJLCPJ0");
});

const dialogs = () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
  };
};

const bellOnly = () =>
  vi.fn(async (path) => {
    const p = String(path);
    if (p === "/api/me/bell") return reply(BELL);
    if (p === "/api/me/bell/seen")
      return reply({ seen_at: "2026-11-12T12:00:00.000Z" });
    if (p === "/api/me/home/needs") return reply({ needs: null });
    return reply({});
  });

test("Escape closes the bell and focus goes back to the button that opened it (#1009)", async () => {
  dialogs();
  global.fetch = bellOnly();
  const trigger = document.createElement("button");
  trigger.className = "kit-bell";
  document.body.append(trigger);
  trigger.getClientRects = () => [{}];
  const onClose = vi.fn();
  renderWithProviders(
    <BellSheet me={{}} onClose={onClose} returnTo={trigger} />,
  );
  await screen.findByRole("region", { name: "New", hidden: true });
  // The title has focus first, so the name is read before the list.
  expect(document.activeElement?.id).toBe("bell-title");
  // The arrows go down the rows, Home and End to the ends.
  const dialog = document.querySelector("dialog");
  const rows = [...dialog.querySelectorAll("[data-bell-row]")];
  fireEvent.keyDown(dialog, { key: "ArrowDown" });
  expect(document.activeElement).toBe(rows[0]);
  fireEvent.keyDown(dialog, { key: "ArrowDown" });
  expect(document.activeElement).toBe(rows[1]);
  fireEvent.keyDown(dialog, { key: "End" });
  expect(document.activeElement).toBe(rows.at(-1));
  fireEvent.keyDown(dialog, { key: "Home" });
  expect(document.activeElement).toBe(rows[0]);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(onClose).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  trigger.remove();
});

test("back from a row: what was new is still New, but the row you opened; closing starts fresh (#1009)", async () => {
  dialogs();
  global.fetch = bellOnly();
  const first = renderWithProviders(<BellSheet me={{}} onClose={() => {}} />);
  const fresh = await screen.findByRole("region", {
    name: "New",
    hidden: true,
  });
  await waitFor(() => expect(fresh.querySelectorAll("a").length).toBe(4));
  // Leave through the follower's row.
  fireEvent.click(fresh.querySelector('a[href="/home/player/0VQRR8U0"]'));
  first.unmount();
  // The marker has moved: the read now says nothing is new but the answer.
  global.fetch = vi.fn(async (path) => {
    const p = String(path);
    if (p === "/api/me/bell")
      return reply({
        ...BELL,
        new: 1,
        reactions: {
          ...BELL.reactions,
          new: 0,
          items: BELL.reactions.items.map((r) => ({ ...r, new: false })),
        },
        followers: {
          ...BELL.followers,
          new: 0,
          players: BELL.followers.players.map((f) => ({ ...f, new: false })),
        },
      });
    if (p === "/api/me/home/needs") return reply({ needs: null });
    return reply({ seen_at: "2026-11-12T12:05:00.000Z" });
  });
  const second = renderWithProviders(<BellSheet me={{}} onClose={() => {}} />);
  const again = await screen.findByRole("region", {
    name: "New",
    hidden: true,
  });
  await waitFor(() =>
    expect(
      [...again.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toEqual([
      "/battle/abc123",
      "/settings/feedback/42",
      "/home/player/0Q2L8",
    ]),
  );
  // Closed by you: the next opening keeps nothing.
  fireEvent.click(screen.getByRole("button", { name: "Close", hidden: true }));
  second.unmount();
  renderWithProviders(<BellSheet me={{}} onClose={() => {}} />);
  const third = await screen.findByRole("region", {
    name: "New",
    hidden: true,
  });
  await waitFor(() =>
    expect(
      [...third.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toEqual(["/settings/feedback/42"]),
  );
});

// Codex on #1029: the badge's earlier read is cached, so a failed fresh
// read on opening used to hide its error behind those rows (or "All
// quiet"). The rows stay, a line says they may be out of date, Try again
// reads again, and the marker does not move over rows never refreshed.
function renderOverCache(ui, cached) {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: false },
  });
  client.setQueryData(["me", "bell"], cached);
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

function failingBell(calls) {
  let up = false;
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path);
    calls.push([init?.method ?? "GET", p]);
    if (p === "/api/me/bell")
      return up ? reply(BELL) : reply({ error: "down" }, 503);
    if (p === "/api/me/bell/seen")
      return reply({ seen_at: "2026-11-12T12:00:00.000Z" });
    if (p === "/api/me/home/needs") return reply({ needs: CLAN });
    if (p === "/api/me/home/clan") return reply({ clan: CLAN });
    return reply({});
  });
  return () => {
    up = true;
  };
}

test("a failed refresh keeps the cached rows, says so, and Try again reads again; the marker waits", async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
  };
  const calls = [];
  const recover = failingBell(calls);
  renderOverCache(<BellSheet me={{}} onClose={() => {}} />, BELL);
  const notice = await screen.findByText(
    "Couldn’t refresh just now, so this may be out of date.",
  );
  // The rows it had stay, under the line.
  const fresh = screen.getByRole("region", { name: "New", hidden: true });
  expect(fresh.textContent).toContain("Invented Owner won five in a row");
  expect(
    notice.compareDocumentPosition(fresh) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(calls.filter(([m]) => m === "PUT")).toHaveLength(0);
  recover();
  fireEvent.click(
    screen.getByRole("button", { name: "Try again", hidden: true }),
  );
  await waitFor(() =>
    expect(calls).toContainEqual(["PUT", "/api/me/bell/seen"]),
  );
  expect(
    screen.queryByText(
      "Couldn’t refresh just now, so this may be out of date.",
    ),
  ).toBeNull();
});

test("a failed refresh over an empty cached read is never All quiet", async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
  };
  const calls = [];
  failingBell(calls);
  global.fetch = ((inner) =>
    vi.fn(async (path, init) =>
      String(path) === "/api/me/home/needs"
        ? reply({ needs: { ok: true, state: "none" } })
        : inner(path, init),
    ))(global.fetch);
  renderOverCache(<BellSheet me={{}} onClose={() => {}} />, {
    seen_at: null,
    players: 1,
    new: 0,
    reactions: { new: 0, items: [] },
    followers: { count: 0, new: 0, unnamed: 0, players: [] },
    answers: { new: 0, items: [] },
    account: { new: 0, items: [] },
  });
  await screen.findByText(
    "Couldn’t refresh just now, so this may be out of date.",
  );
  expect(screen.queryByText("All quiet")).toBeNull();
});

test("My conversations reads only on selection and resumes the first unread reply without marking it read", async () => {
  const ref = {
    source: "game",
    item_id: "tl_0123456789abcdef0099",
    kind: "badge_earned",
    at: "2026-11-18T10:00:00Z",
    subject: { kind: "player", tag: "#0PGQ2UYL" },
  };
  const calls = [];
  const base = global.fetch;
  global.fetch = vi.fn(async (path, init) => {
    calls.push([init?.method ?? "GET", String(path)]);
    if (String(path) === "/api/me/conversations")
      return reply({
        items: [
          {
            item_id: ref.item_id,
            item_ref: ref,
            title: "<b>Writer</b> reached Knight Mastery",
            at: ref.at,
            unread: 2,
            first_unread_comment_id: "42",
            read_at: "2026-11-18T09:00:00Z",
          },
        ],
        next_before: null,
      });
    return base(path, init);
  });
  const close = vi.fn();
  renderWithProviders(
    <BellSheet me={{ features: { comments: true } }} onClose={close} />,
  );
  expect(calls.some(([, path]) => path.includes("conversations"))).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "My conversations", hidden: true }),
  );
  const thread = await screen.findByRole("link", {
    name: /Writer.*Knight Mastery.*2 new replies/,
    hidden: true,
  });
  expect(thread.textContent).toContain("<b>Writer</b>");
  expect(thread.querySelector("b")).toBeNull();
  const url = new URL(thread.getAttribute("href"), "https://example.test");
  expect(url.pathname).toBe(`/home/item/${ref.item_id}`);
  const target = readMemberItemPath(
    ref.item_id,
    Object.fromEntries(url.searchParams),
  );
  expect(target.entry.reply).toBe("42");
  expect(target.ref).toEqual(ref);
  expect(
    calls.filter(
      ([method, path]) => method !== "GET" && path.includes("conversation"),
    ),
  ).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Close", hidden: true }));
});
