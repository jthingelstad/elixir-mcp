/**
 * Cheers on a feed item and the RSS link panel (#765). The cheers are the
 * ruling's six (Jamie, 2026-11-12: "Yes, six cheers (Recommended)") and,
 * since 2026-11-17, fourteen more ("Reactions are glyphs alone; a larger
 * set"), pinned here to the database's own list; one per person per item,
 * the same one again takes it back, and the item shows counts, never who.
 * The control shows glyphs alone: every one has its name. Invented players
 * only.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import {
  CHEERS,
  LEAD,
  cheerCounts,
  cheerOf,
  cheeredBy,
  foldCounts,
  nextCheer,
  withMyCheer,
} from "../src/home/cheer-set.js";
import { reactionRow } from "../src/shell/bell-logic.js";
import { useQuery } from "@tanstack/react-query";
import {
  Cheers,
  GRID_COLUMNS,
  LONG_PRESS_MS,
  cheerButtonName,
  cheerWords,
} from "../src/home/Cheers.jsx";
import { CheerGlyph } from "../src/home/CheerGlyph.jsx";
import { RssLinkPanel } from "../src/views/account/RssLink.jsx";
import { ScopeProvider } from "../src/lib/scope.js";
import { HOME_FEED_KEY, pageCheersKey } from "../src/lib/queries.js";

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let calls;
beforeEach(() => {
  cleanup();
  calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const ITEM = {
  id: "tl_0123456789abcdef0123",
  subject_tag: "#0GVJ9V",
  subjects: [{ kind: "player", tag: "#0VJ2QV" }],
  cheers: { on_fire: 2, royal: 1 },
  my_cheer: "on_fire",
};

test("the cheers are the database's twenty, the first six as they always were", () => {
  const sql = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../db/migrations/0291_cheer_kinds_twenty.sql",
    ),
    "utf8",
  );
  const listed = /cheer in \(([^)]*)\)/.exec(sql)[1];
  const keys = [...listed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  expect(CHEERS.map((c) => c.key)).toEqual(keys);
  expect(CHEERS).toHaveLength(20);
  expect(LEAD).toBe(6);
  // The six of 0243, unchanged: ids, names and order.
  expect(CHEERS.slice(0, 6).map((c) => [c.key, c.label])).toEqual([
    ["well_played", "Well played"],
    ["on_fire", "On fire"],
    ["royal", "Royal"],
    ["wow", "Wow"],
    ["ha", "Ha"],
    ["grind", "Grind"],
  ]);
  // Every kind has a short name, and no two share a name or a glyph.
  for (const c of CHEERS) expect(c.label).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
  expect(new Set(CHEERS.map((c) => c.label)).size).toBe(CHEERS.length);
  expect(new Set(CHEERS.map((c) => c.icon)).size).toBe(CHEERS.length);
});

test("counts in words never say who", () => {
  expect(cheeredBy({}, null)).toBe("");
  expect(cheeredBy({ wow: 1 }, null)).toBe("1 person");
  expect(cheeredBy({ wow: 2, ha: 1 }, null)).toBe("3 people");
  expect(cheeredBy({ wow: 1 }, "wow")).toBe("You");
  expect(cheeredBy({ wow: 1, ha: 1 }, "wow")).toBe("You and 1 other");
  expect(cheeredBy({ wow: 3 }, "wow")).toBe("You and 2 others");
  expect(cheerCounts({ grind: 1, wow: 2 }).map((c) => c.key)).toEqual([
    "wow",
    "grind",
  ]);
});

test("one cheer per person: another changes it, the same takes it back", () => {
  expect(nextCheer("wow", "wow")).toBeNull();
  expect(nextCheer("wow", "ha")).toBe("ha");
  expect(nextCheer(null, "ha")).toBe("ha");
  const changed = withMyCheer(ITEM, "royal");
  expect(changed.cheers).toEqual({ on_fire: 1, royal: 2 });
  expect(changed.my_cheer).toBe("royal");
  const gone = withMyCheer({ ...ITEM, cheers: { on_fire: 1 } }, null);
  expect(gone.cheers).toEqual({});
  expect(gone.my_cheer).toBeNull();
});

test("a cheer on a player page reaches Home's copy and every page's copy (Codex on #792)", async () => {
  global.fetch = vi.fn(async () =>
    reply({
      item_id: ITEM.id,
      cheers: { on_fire: 1, royal: 2 },
      my_cheer: "royal",
    }),
  );
  const page = pageCheersKey({ player: "#0GVJ9V" });
  const battle = pageCheersKey({ battle: "abcdef012345" });
  const other = { ...ITEM, id: "tl_ffffffffffffffffffff" };
  const { queryClient } = renderWithProviders(
    <Cheers it={ITEM} where={{ key: page, list: "items" }} />,
  );
  queryClient.setQueryData(page, { items: [ITEM], subjects: ["#0GVJ9V"] });
  queryClient.setQueryData(battle, { items: [ITEM, other] });
  // Home's feed is pages (G1): a cheer reaches the item on whichever page.
  queryClient.setQueryData(HOME_FEED_KEY, {
    pages: [{ timeline: [other] }, { timeline: [ITEM] }],
    pageParams: [null, "c1"],
  });
  fireEvent.click(screen.getByRole("button", { name: "Choose a cheer" }));
  fireEvent.click(screen.getByRole("button", { name: "Royal" }));
  const want = { cheers: { on_fire: 1, royal: 2 }, my_cheer: "royal" };
  await waitFor(() =>
    expect(
      queryClient.getQueryData(HOME_FEED_KEY).pages[1].timeline[0],
    ).toMatchObject(want),
  );
  expect(queryClient.getQueryData(page).items[0]).toMatchObject(want);
  expect(queryClient.getQueryData(battle).items[0]).toMatchObject(want);
  // Another item keeps its own.
  expect(queryClient.getQueryData(battle).items[1]).toEqual(other);
  expect(queryClient.getQueryData(HOME_FEED_KEY).pages[0].timeline[0]).toEqual(
    other,
  );
});

test("the RSS link shows once after it is made, then only that it is on", async () => {
  let on = false;
  global.fetch = vi.fn(async (path, init = {}) => {
    calls.push({ path: String(path), method: init.method ?? "GET" });
    if (init.method === "POST") {
      on = true;
      return reply({
        on: true,
        url: "https://elixir.poapkings.com/api/rss/abcdefghijklmnopqrstuvwxyz012345.xml",
        created_at: "2026-11-12T15:00:00.000Z",
      });
    }
    return reply(
      on
        ? { on: true, created_at: "2026-11-12T15:00:00.000Z" }
        : { on: false, created_at: null },
    );
  });
  renderWithProviders(<RssLinkPanel />);
  await screen.findByText("Off: no link reads your timeline.");
  fireEvent.click(screen.getByRole("button", { name: "Make my link" }));
  await screen.findByText(/abcdefghijklmnopqrstuvwxyz012345\.xml$/);
  expect(screen.getByText(/keeps only a fingerprint/)).toBeTruthy();
  await screen.findByRole("button", { name: "Reset link" });
  expect(screen.getByRole("button", { name: "Turn off" })).toBeTruthy();
  expect(calls.some((c) => c.method === "POST")).toBe(true);
});

/** The item as the Timeline draws it: from Home's cached feed, so the
 *  optimistic copy, the server's answer and a rollback all show. */
function FeedHarness() {
  const { data } = useQuery({
    queryKey: HOME_FEED_KEY,
    queryFn: () => new Promise(() => {}),
    staleTime: Infinity,
  });
  const it = data?.pages?.[0]?.timeline?.[0];
  return it ? <Cheers it={it} /> : null;
}
const CHEER_NAME = /^Cheer(ed)?: /;
async function feedWith(item) {
  const r = renderWithProviders(<FeedHarness />);
  act(() =>
    r.queryClient.setQueryData(HOME_FEED_KEY, {
      pages: [{ timeline: [item] }],
      pageParams: [null],
    }),
  );
  await screen.findByRole("button", { name: CHEER_NAME });
  return r;
}
const FRESH = { ...ITEM, cheers: { royal: 1 }, my_cheer: null };
const cheerButton = () => screen.getByRole("button", { name: CHEER_NAME });
const toggle = () => screen.getByRole("button", { name: "Choose a cheer" });
const lead = () => screen.queryByRole("group", { name: "Cheer with" });
const grid = () => screen.queryByRole("group", { name: "All cheers" });
const focused = () => document.activeElement.getAttribute("aria-label");
/** A server that answers each write with the counts it would hold. */
function answering() {
  global.fetch = vi.fn(async (path, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push({ path: String(path), method: init.method, body });
    const after = withMyCheer(FRESH, body.cheer);
    return reply({
      item_id: ITEM.id,
      cheers: after.cheers,
      my_cheer: after.my_cheer,
    });
  });
}

test("one tap cheers at once with the default, and a second tap takes it back", async () => {
  answering();
  await feedWith(FRESH);
  const button = cheerButton();
  expect(button.getAttribute("aria-label")).toBe("Cheer: Well played");
  expect(button.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(button);
  // Shown before the server answers.
  await waitFor(() =>
    expect(cheerButton().getAttribute("aria-pressed")).toBe("true"),
  );
  expect(cheerButton().getAttribute("aria-label")).toBe("Cheered: Well played");
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].path).toBe("/api/me/cheers");
  expect(calls[0].method).toBe("PUT");
  expect(calls[0].body).toEqual({
    item_id: ITEM.id,
    cheer: "well_played",
    subjects: ["#0GVJ9V", "#0VJ2QV"],
  });
  // The button carries its kind's count; the description says the rest.
  await waitFor(() => expect(cheerButton().textContent).toBe("1"));
  expect(
    document.getElementById(cheerButton().getAttribute("aria-describedby"))
      .textContent,
  ).toBe("Well played 1, Royal 1. You and 1 other. Yours: Well played");
  fireEvent.click(cheerButton());
  await waitFor(() =>
    expect(cheerButton().getAttribute("aria-pressed")).toBe("false"),
  );
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1].body.cheer).toBeNull();
});

test("a cheer of another kind is one tap on the button away from being taken back", async () => {
  answering();
  await feedWith({ ...ITEM });
  // Yours is On fire: the button is pressed and wears its glyph and count.
  expect(cheerButton().getAttribute("aria-pressed")).toBe("true");
  expect(cheerButton().getAttribute("aria-label")).toBe("Cheered: On fire");
  expect(cheerButton().querySelector("svg.lucide-flame")).toBeTruthy();
  expect(cheerButton().textContent).toBe("2");
  fireEvent.click(cheerButton());
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].body.cheer).toBeNull();
});

test("six reactions first, More grows the popover to all twenty, one tap switches", async () => {
  answering();
  await feedWith(FRESH);
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle());
  expect(toggle().getAttribute("aria-expanded")).toBe("true");
  const group = lead();
  expect(toggle().getAttribute("aria-controls")).toBe(group.id);
  const names = [...group.querySelectorAll("button")].map((b) =>
    b.getAttribute("aria-label"),
  );
  expect(names).toEqual([
    ...CHEERS.slice(0, 6).map((c) => c.label),
    "More reactions",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "More reactions" }));
  expect(lead()).toBeNull();
  const all = grid();
  expect(
    [...all.querySelectorAll("button")].map((b) =>
      b.getAttribute("aria-label"),
    ),
  ).toEqual(CHEERS.map((c) => c.label));
  // The first one the six did not show takes focus.
  await waitFor(() => expect(focused()).toBe(CHEERS[LEAD].label));
  fireEvent.click(screen.getByRole("button", { name: "High five" }));
  expect(grid()).toBeNull();
  await waitFor(() =>
    expect(cheerButton().querySelector("svg.lucide-hand")).toBeTruthy(),
  );
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].body.cheer).toBe("high_five");
});

test("yours, or your last from past the six, waits just before More", async () => {
  answering();
  localStorage.removeItem("elixir.cheer.recent");
  const r = await feedWith({
    ...FRESH,
    my_cheer: "lucky",
    cheers: { lucky: 1 },
  });
  fireEvent.click(toggle());
  let names = [...lead().querySelectorAll("button")].map((b) =>
    b.getAttribute("aria-label"),
  );
  expect(names.slice(6)).toEqual(["Lucky", "More reactions"]);
  expect(
    screen.getByRole("button", { name: "Lucky" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(toggle());
  r.unmount();
  // Choosing one from the grid remembers it for this device.
  await feedWith(FRESH);
  fireEvent.click(toggle());
  expect(lead().querySelectorAll("button")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "More reactions" }));
  fireEvent.click(screen.getByRole("button", { name: "Ice cold" }));
  expect(localStorage.getItem("elixir.cheer.recent")).toBe("ice_cold");
  await waitFor(() => expect(calls).toHaveLength(1));
  fireEvent.click(toggle());
  names = [...lead().querySelectorAll("button")].map((b) =>
    b.getAttribute("aria-label"),
  );
  expect(names.slice(6)).toEqual(["Ice cold", "More reactions"]);
  localStorage.removeItem("elixir.cheer.recent");
});

test("the keyboard: arrows move, Enter chooses, Escape steps back then closes", async () => {
  answering();
  await feedWith({ ...ITEM });
  const more = toggle();
  more.focus();
  // A keyboard press on a button is a click with no pointer detail.
  fireEvent.click(more, { detail: 0 });
  // Focus lands on yours (On fire).
  await waitFor(() => expect(focused()).toBe("On fire"));
  fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
  expect(focused()).toBe("Royal");
  fireEvent.keyDown(document.activeElement, { key: "ArrowLeft" });
  fireEvent.keyDown(document.activeElement, { key: "ArrowLeft" });
  expect(focused()).toBe("Well played");
  fireEvent.keyDown(document.activeElement, { key: "End" });
  expect(focused()).toBe("More reactions");
  fireEvent.keyDown(document.activeElement, { key: "Home" });
  expect(focused()).toBe("Well played");
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(lead()).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(toggle()));
  expect(calls).toHaveLength(0);

  // More from the keyboard, then the grid in two dimensions.
  fireEvent.click(toggle(), { detail: 0 });
  await waitFor(() => expect(focused()).toBe("On fire"));
  fireEvent.keyDown(document.activeElement, { key: "End" });
  fireEvent.click(document.activeElement, { detail: 0 });
  await waitFor(() => expect(focused()).toBe(CHEERS[LEAD].label));
  const at = (i) => CHEERS[i].label;
  // Index 6 is row 2, column 2 of five.
  fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
  expect(focused()).toBe(at(LEAD + GRID_COLUMNS));
  fireEvent.keyDown(document.activeElement, { key: "ArrowUp" });
  fireEvent.keyDown(document.activeElement, { key: "ArrowUp" });
  expect(focused()).toBe(at(1));
  // Up from the top row wraps to the bottom of the column.
  fireEvent.keyDown(document.activeElement, { key: "ArrowUp" });
  expect(focused()).toBe(at(16));
  fireEvent.keyDown(document.activeElement, { key: "ArrowDown" });
  expect(focused()).toBe(at(1));
  fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
  expect(focused()).toBe(at(2));
  fireEvent.keyDown(document.activeElement, { key: "End" });
  expect(focused()).toBe(at(19));
  // Escape steps back to the six, on More; again closes, on the smile.
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(grid()).toBeNull();
  expect(lead()).toBeTruthy();
  await waitFor(() => expect(focused()).toBe("More reactions"));
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(lead()).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(toggle()));

  fireEvent.click(toggle(), { detail: 0 });
  await waitFor(() => expect(focused()).toBe("On fire"));
  fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
  fireEvent.click(document.activeElement, { detail: 0 });
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].body.cheer).toBe("royal");
  await waitFor(() => expect(document.activeElement).toBe(cheerButton()));
});

test("a scroll that starts on the button never cheers, and a long press opens the kinds", async () => {
  answering();
  await feedWith(FRESH);
  const button = cheerButton();
  // A finger lands on the button and the page scrolls: the browser
  // cancels the pointer and sends no click.
  fireEvent.pointerDown(button, {
    pointerType: "touch",
    clientX: 10,
    clientY: 10,
  });
  fireEvent.pointerMove(button, {
    pointerType: "touch",
    clientX: 10,
    clientY: 60,
  });
  fireEvent.pointerCancel(button, { pointerType: "touch" });
  await new Promise((r) => setTimeout(r, LONG_PRESS_MS + 50));
  expect(lead()).toBeNull();
  expect(calls).toHaveLength(0);
  expect(button.getAttribute("aria-pressed")).toBe("false");

  // A finger that rests: the kinds open, and the click that ends the press
  // is not a cheer.
  fireEvent.pointerDown(button, {
    pointerType: "touch",
    clientX: 10,
    clientY: 10,
  });
  await screen.findByRole("group", { name: "Cheer with" }, { timeout: 2000 });
  fireEvent.pointerUp(button, { pointerType: "touch" });
  fireEvent.click(button);
  expect(calls).toHaveLength(0);
  expect(button.getAttribute("aria-pressed")).toBe("false");

  // Resting on a kind shows its name, and lifting the finger is no cheer.
  const wow = screen.getByRole("button", { name: "Wow" });
  fireEvent.pointerDown(wow, { pointerType: "touch", clientX: 5, clientY: 5 });
  await waitFor(
    () =>
      expect(document.querySelector(".kit-cheers__tip")?.textContent).toBe(
        "Wow",
      ),
    { timeout: 2000 },
  );
  fireEvent.pointerUp(wow, { pointerType: "touch" });
  fireEvent.click(wow);
  expect(calls).toHaveLength(0);
  // A plain tap on it then cheers.
  fireEvent.click(wow);
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].body.cheer).toBe("wow");
});

test("a glyph's name shows on hover and keyboard focus, and the popover closes on a tap away", async () => {
  answering();
  await feedWith(FRESH);
  const tip = () => document.querySelector(".kit-cheers__tip");
  fireEvent.mouseEnter(cheerButton());
  expect(tip().textContent).toBe("Cheer: Well played");
  expect(tip().getAttribute("aria-hidden")).toBe("true");
  fireEvent.mouseLeave(cheerButton());
  expect(tip()).toBeNull();
  fireEvent.click(toggle());
  const flame = screen.getByRole("button", { name: "On fire" });
  // Keyboard focus (focus-visible) shows the name; jsdom matches it on focus.
  act(() => flame.focus());
  expect(tip().textContent).toBe("On fire");
  act(() => flame.blur());
  expect(tip()).toBeNull();
  fireEvent.pointerDown(document.body);
  expect(lead()).toBeNull();
});

test("no word beside a reaction: the control's visible text is numbers alone", async () => {
  answering();
  const busy = {
    ...ITEM,
    cheers: { on_fire: 4, royal: 3, wow: 2, ha: 2, grind: 1, lucky: 1 },
    my_cheer: "grind",
  };
  await feedWith(busy);
  const visible = () => {
    const root = document.querySelector(".kit-cheers").cloneNode(true);
    // Words for screen readers, and the tooltip a focused glyph shows, are
    // not words beside a reaction.
    root
      .querySelectorAll(".sr-only, .kit-cheers__tip")
      .forEach((n) => n.remove());
    return root.textContent;
  };
  expect(visible()).toMatch(/^[\d+\s]*$/);
  fireEvent.click(toggle());
  expect(visible()).toMatch(/^[\d+\s]*$/);
  fireEvent.click(screen.getByRole("button", { name: "More reactions" }));
  expect(visible()).toMatch(/^[\d+\s]*$/);
  // Every control in it is named, glyph-only as it is.
  for (const b of document.querySelectorAll(".kit-cheers button"))
    expect(b.getAttribute("aria-label")).toMatch(/\S/);
  expect(
    document.querySelectorAll(".kit-cheers button[aria-label]").length,
  ).toBe(22);
});

test("a busy item folds its counts: the top three, yours, then +N", async () => {
  // Folding, in the set's order on ties, yours always kept.
  const cheers = { on_fire: 4, royal: 3, wow: 2, ha: 2, grind: 1, lucky: 1 };
  const plain = foldCounts(cheers);
  expect(plain.shown.map((c) => [c.key, c.count])).toEqual([
    ["on_fire", 4],
    ["royal", 3],
    ["wow", 2],
  ]);
  expect(plain.rest).toBe(4);
  const withMine = foldCounts(cheers, { mine: "lucky" });
  expect(withMine.shown.map((c) => c.key)).toEqual([
    "on_fire",
    "royal",
    "wow",
    "lucky",
  ]);
  expect(withMine.rest).toBe(3);
  // The button's own kind is left out of the fold.
  const button = foldCounts(cheers, { mine: "grind", except: "grind" });
  expect(button.shown.map((c) => c.key)).toEqual(["on_fire", "royal", "wow"]);
  expect(button.rest).toBe(3);
  // Drawn: the button is Grind 1, then three kinds and +3.
  global.fetch = vi.fn(async () => reply({}));
  renderWithProviders(<Cheers it={{ ...ITEM, cheers, my_cheer: "grind" }} />);
  expect(cheerButton().textContent).toBe("1");
  const counts = [...document.querySelectorAll(".kit-cheers__count")];
  expect(counts.map((c) => c.textContent)).toEqual(["4", "3", "2"]);
  expect(
    counts.map((c) => c.querySelector("svg").getAttribute("class")),
  ).toEqual([
    expect.stringContaining("lucide-flame"),
    expect.stringContaining("lucide-gem"),
    expect.stringContaining("lucide-sparkles"),
  ]);
  expect(document.querySelector(".kit-cheers__rest").textContent).toBe("+3");
});

test("a stored kind this page does not know is drawn safely and counted", async () => {
  answering();
  const odd = {
    ...ITEM,
    cheers: { mystery_kind: 3, wow: 1 },
    my_cheer: "mystery_kind",
  };
  await feedWith(odd);
  // The button shows the default glyph, pressed, and a tap takes it back.
  expect(cheerButton().getAttribute("aria-pressed")).toBe("true");
  expect(cheerButton().querySelector("svg.lucide-thumbs-up")).toBeTruthy();
  expect(cheerOf("mystery_kind").key).toBe("well_played");
  // Counted in the fold, never drawn with a wrong glyph.
  expect(foldCounts(odd.cheers).rest).toBe(3);
  expect(cheeredBy(odd.cheers, odd.my_cheer)).toBe("You and 3 others");
  fireEvent.click(cheerButton());
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].body.cheer).toBeNull();
});

test("a write that fails rolls back and says so quietly", async () => {
  global.fetch = vi.fn(async () =>
    reply({ error: "rate_limited", message: "Too many" }, 429),
  );
  await feedWith(FRESH);
  fireEvent.click(cheerButton());
  expect((await screen.findByRole("status")).textContent).toBe(
    "Your cheer was not saved. Try again.",
  );
  expect(cheerButton().getAttribute("aria-pressed")).toBe("false");
  expect(cheerButton().textContent).toBe("");
});

test("taps during a write show at once and are sent in order after it", async () => {
  const answers = [];
  global.fetch = vi.fn((path, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push({ body });
    const after = withMyCheer(FRESH, body.cheer);
    return new Promise((resolve) =>
      answers.push(() =>
        resolve(
          reply({
            item_id: ITEM.id,
            cheers: after.cheers,
            my_cheer: after.my_cheer,
          }),
        ),
      ),
    );
  });
  await feedWith(FRESH);
  fireEvent.click(cheerButton());
  await waitFor(() => expect(calls).toHaveLength(1));
  // Taken back before the first write answers: shown now, held back.
  fireEvent.click(cheerButton());
  await waitFor(() =>
    expect(cheerButton().getAttribute("aria-pressed")).toBe("false"),
  );
  expect(cheerButton().disabled).toBe(false);
  expect(calls).toHaveLength(1);
  answers[0]();
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls.map((c) => c.body.cheer)).toEqual(["well_played", null]);
  // The first answer does not redraw over the newer tap.
  expect(cheerButton().getAttribute("aria-pressed")).toBe("false");
  answers[1]();
  await waitFor(() =>
    expect(cheerButton().getAttribute("aria-pressed")).toBe("false"),
  );
});

test("a take-back still goes when the item leaves the page before the cheer answers", async () => {
  const answers = [];
  global.fetch = vi.fn((path, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push({ body });
    const after = withMyCheer(FRESH, body.cheer);
    return new Promise((resolve) =>
      answers.push(() =>
        resolve(
          reply({
            item_id: ITEM.id,
            cheers: after.cheers,
            my_cheer: after.my_cheer,
          }),
        ),
      ),
    );
  });
  const r = await feedWith(FRESH);
  fireEvent.click(cheerButton());
  await waitFor(() => expect(calls).toHaveLength(1));
  fireEvent.click(cheerButton());
  await waitFor(() =>
    expect(cheerButton().getAttribute("aria-pressed")).toBe("false"),
  );
  // A group folded, a page left: the item is gone before the answer.
  r.unmount();
  answers[0]();
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls.map((c) => c.body.cheer)).toEqual(["well_played", null]);
  answers[1]();
  await waitFor(() =>
    expect(
      r.queryClient.getQueryData(HOME_FEED_KEY).pages[0].timeline[0].my_cheer,
    ).toBeNull(),
  );
});

test("a refused take-back goes back to what the server last confirmed", async () => {
  // The cheer answers only once the take-back is queued behind it.
  let answerFirst;
  global.fetch = vi.fn((path, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push({ body });
    if (calls.length === 2)
      return Promise.resolve(
        reply({ error: "rate_limited", message: "Too many" }, 429),
      );
    const after = withMyCheer(FRESH, body.cheer);
    return new Promise((resolve) => {
      answerFirst = () =>
        resolve(
          reply({
            item_id: ITEM.id,
            cheers: after.cheers,
            my_cheer: after.my_cheer,
          }),
        );
    });
  });
  const r = await feedWith(FRESH);
  // A player page's copy of the same item, cached from an earlier visit.
  const page = ["me", "cheers", "player", "#0GVJ9V"];
  r.queryClient.setQueryData(page, {
    items: [{ id: ITEM.id, cheers: FRESH.cheers, my_cheer: null }],
  });
  fireEvent.click(cheerButton());
  await waitFor(() => expect(calls).toHaveLength(1));
  fireEvent.click(cheerButton());
  await waitFor(() =>
    expect(cheerButton().getAttribute("aria-pressed")).toBe("false"),
  );
  answerFirst();
  expect(await screen.findByRole("status")).toBeTruthy();
  expect(cheerButton().getAttribute("aria-pressed")).toBe("true");
  expect(calls.map((c) => c.body.cheer)).toEqual(["well_played", null]);
  // The other copy shows what the server confirmed too.
  expect(r.queryClient.getQueryData(page).items[0].my_cheer).toBe(
    "well_played",
  );
});

test("on an agent's pages the counts show and nothing can be pressed", () => {
  global.fetch = vi.fn(async () => reply({}));
  renderWithProviders(
    <ScopeProvider value="ag_example">
      <Cheers it={ITEM} />
    </ScopeProvider>,
  );
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(
    screen.getByRole("img", { name: "On fire 2, Royal 1. 3 people" }),
  ).toBeTruthy();
});

test("a line's compact Cheer carries its kind's count and folds the rest into +N", () => {
  global.fetch = vi.fn(async () => reply({}));
  renderWithProviders(<Cheers it={ITEM} compact />);
  expect(cheerButton().textContent).toBe("2");
  expect(document.querySelector(".kit-cheers__counts")).toBeNull();
  expect(document.querySelector(".kit-cheers__rest").textContent).toBe("+1");
  expect(cheerWords(ITEM.cheers, ITEM.my_cheer)).toBe(
    "On fire 2, Royal 1. You and 2 others. Yours: On fire",
  );
  expect(cheerButtonName("royal")).toBe("Cheered: Royal");
  expect(cheerButtonName(null)).toBe("Cheer: Well played");
});

test("each kind has one glyph, a Lucide one, drawn the same wherever it shows", () => {
  const glyphs = CHEERS.map((c) => c.icon);
  expect(new Set(glyphs).size).toBe(CHEERS.length);
  expect(Object.fromEntries(CHEERS.map((c) => [c.key, c.icon]))).toEqual({
    well_played: "thumbs-up",
    on_fire: "flame",
    royal: "gem",
    wow: "sparkles",
    ha: "laugh",
    grind: "biceps-flexed",
    love_it: "heart",
    good_game: "handshake",
    congrats: "party-popper",
    clutch: "zap",
    high_five: "hand",
    champion: "medal",
    nailed_it: "target",
    climbing: "rocket",
    big_brain: "brain",
    ice_cold: "snowflake",
    close_one: "hourglass",
    lucky: "clover",
    fun_to_watch: "popcorn",
    getting_better: "sprout",
  });
  // None is a glyph that already means something else (glyphs.md).
  for (const taken of [
    "star",
    "bell",
    "crown",
    "trophy",
    "swords",
    "shield",
    "castle",
    "eye",
    "award",
  ])
    expect(glyphs).not.toContain(taken);
  for (const c of CHEERS) {
    cleanup();
    renderWithProviders(<CheerGlyph kind={c.key} />);
    const svg = document.querySelector("svg");
    expect(svg.getAttribute("class")).toContain(`lucide-${c.icon}`);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  }
  // Every kind renders in the counts, in the grid and in the bell's words.
  for (const c of CHEERS) {
    cleanup();
    global.fetch = vi.fn(async () => reply({}));
    renderWithProviders(
      <Cheers
        it={{
          ...ITEM,
          cheers: { [c.key]: 2, wow: c.key === "wow" ? 2 : 1 },
          my_cheer: null,
        }}
      />,
    );
    const drawn = [
      cheerButton(),
      ...document.querySelectorAll(".kit-cheers__count"),
    ].map((n) => n.querySelector("svg").getAttribute("class"));
    expect(drawn.some((k) => k.includes(`lucide-${c.icon}`))).toBe(true);
    const row = reactionRow({ item_id: ITEM.id, cheers: { [c.key]: 2 } });
    expect(row.words).toBe(`${c.label} 2`);
  }
  cleanup();
  global.fetch = vi.fn(async () => reply({}));
  renderWithProviders(<Cheers it={ITEM} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose a cheer" }));
  fireEvent.click(screen.getByRole("button", { name: "More reactions" }));
  const kinds = screen.getByRole("group", { name: "All cheers" });
  const drawnKinds = [...kinds.querySelectorAll("svg")];
  expect(drawnKinds).toHaveLength(glyphs.length);
  drawnKinds.forEach((s, i) =>
    expect(s.getAttribute("class")).toContain(`lucide-${glyphs[i]}`),
  );
});

test("no surface draws a cheer kind but through CheerGlyph", () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src",
  );
  const drawn = ["home/Cheers.jsx", "shell/Bell.jsx"];
  for (const f of drawn)
    expect(readFileSync(path.join(root, f), "utf8")).toContain("<CheerGlyph");
  // The emoji the six once wore are gone from the app.
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(d, e.name))
        : /\.(jsx?|tsx?)$/.test(e.name)
          ? [path.join(d, e.name)]
          : [],
    );
  for (const f of walk(root))
    expect(
      /[\u{1F44F}\u{1F525}\u{1F451}\u{1F62E}\u{1F602}\u{1F4AA}]/u.test(
        readFileSync(f, "utf8"),
      ),
      f,
    ).toBe(false);
});
