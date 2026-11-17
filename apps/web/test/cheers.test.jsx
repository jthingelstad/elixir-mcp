/**
 * Cheers on a feed item and the RSS link panel (#765). The six cheers are
 * the ruling's set (Jamie, 2026-11-12: "Yes, six cheers (Recommended)"),
 * pinned here to the database's own list; one per person per item, the
 * same one again takes it back, and the item shows counts, never who.
 * Invented players only.
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
  cheerCounts,
  cheeredBy,
  nextCheer,
  withMyCheer,
} from "../src/home/cheer-set.js";
import { useQuery } from "@tanstack/react-query";
import { Cheers, LONG_PRESS_MS, cheerWords } from "../src/home/Cheers.jsx";
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

test("the six cheers are the database's six, in the canvas's order", () => {
  const sql = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../db/migrations/0243_cheers_and_feed_link.sql",
    ),
    "utf8",
  );
  const listed = /cheer in \(([^)]*)\)/.exec(sql)[1];
  const keys = [...listed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  expect(CHEERS.map((c) => c.key)).toEqual(keys);
  expect(CHEERS.map((c) => c.label)).toEqual([
    "Well played",
    "On fire",
    "Royal",
    "Wow",
    "Ha",
    "Grind",
  ]);
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
async function feedWith(item) {
  const r = renderWithProviders(<FeedHarness />);
  act(() =>
    r.queryClient.setQueryData(HOME_FEED_KEY, {
      pages: [{ timeline: [item] }],
      pageParams: [null],
    }),
  );
  await screen.findByRole("button", { name: "Cheer" });
  return r;
}
const FRESH = { ...ITEM, cheers: { royal: 1 }, my_cheer: null };
const cheerButton = () => screen.getByRole("button", { name: "Cheer" });
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
  const button = await screen.findByRole("button", { name: "Cheer" });
  expect(button.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(button);
  // Shown before the server answers.
  await waitFor(() =>
    expect(cheerButton().getAttribute("aria-pressed")).toBe("true"),
  );
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].path).toBe("/api/me/cheers");
  expect(calls[0].method).toBe("PUT");
  expect(calls[0].body).toEqual({
    item_id: ITEM.id,
    cheer: "well_played",
    subjects: ["#0GVJ9V", "#0VJ2QV"],
  });
  await waitFor(() => expect(screen.getByText("You and 1 other")).toBeTruthy());
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

test("a cheer of another kind is one tap on Cheer away from being taken back", async () => {
  answering();
  await feedWith({ ...ITEM });
  // Yours is On fire: Cheer is pressed and wears its glyph.
  expect(cheerButton().getAttribute("aria-pressed")).toBe("true");
  expect(cheerButton().querySelector("svg.lucide-flame")).toBeTruthy();
  fireEvent.click(cheerButton());
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].body.cheer).toBeNull();
});

test("choosing another kind: the six open inline and one tap switches", async () => {
  answering();
  await feedWith(FRESH);
  const more = screen.getByRole("button", { name: "Choose a cheer" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(more);
  expect(more.getAttribute("aria-expanded")).toBe("true");
  const group = screen.getByRole("group", { name: "Cheer with" });
  expect(more.getAttribute("aria-controls")).toBe(group.id);
  expect(group.querySelectorAll("button")).toHaveLength(6);
  fireEvent.click(screen.getByRole("button", { name: "Grind" }));
  expect(screen.queryByRole("group", { name: "Cheer with" })).toBeNull();
  await waitFor(() =>
    expect(
      cheerButton().querySelector("svg.lucide-biceps-flexed"),
    ).toBeTruthy(),
  );
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].body.cheer).toBe("grind");
});

test("the keyboard reaches the kinds: arrows move, Enter chooses, Escape closes", async () => {
  answering();
  await feedWith({ ...ITEM });
  const more = screen.getByRole("button", { name: "Choose a cheer" });
  more.focus();
  // A keyboard press on a button is a click with no pointer detail.
  fireEvent.click(more, { detail: 0 });
  // Focus lands on yours (On fire).
  await waitFor(() =>
    expect(document.activeElement.textContent).toBe("On fire"),
  );
  expect(screen.getByRole("group", { name: "Cheer with" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
  expect(document.activeElement.textContent).toBe("Royal");
  fireEvent.keyDown(document.activeElement, { key: "ArrowLeft" });
  fireEvent.keyDown(document.activeElement, { key: "ArrowLeft" });
  expect(document.activeElement.textContent).toBe("Well played");
  fireEvent.keyDown(document.activeElement, { key: "End" });
  expect(document.activeElement.textContent).toBe("Grind");
  fireEvent.keyDown(document.activeElement, { key: "Escape" });
  expect(screen.queryByRole("group", { name: "Cheer with" })).toBeNull();
  expect(document.activeElement).toBe(more);
  expect(calls).toHaveLength(0);
  fireEvent.click(more, { detail: 0 });
  await waitFor(() =>
    expect(document.activeElement.textContent).toBe("On fire"),
  );
  fireEvent.keyDown(document.activeElement, {
    key: "ArrowRight",
  });
  fireEvent.click(document.activeElement, { detail: 0 });
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].body.cheer).toBe("royal");
  await waitFor(() => expect(document.activeElement).toBe(cheerButton()));
});

test("a scroll that starts on Cheer never cheers, and a long press opens the kinds", async () => {
  answering();
  await feedWith(FRESH);
  const button = cheerButton();
  // A finger lands on Cheer and the page scrolls: the browser cancels the
  // pointer and sends no click.
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
  expect(screen.queryByRole("group", { name: "Cheer with" })).toBeNull();
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
  expect(screen.queryByText("You")).toBeNull();
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

test("a line's compact Cheer carries the total, and no counts by kind", () => {
  global.fetch = vi.fn(async () => reply({}));
  renderWithProviders(<Cheers it={ITEM} compact />);
  expect(cheerButton().textContent).toBe("3");
  expect(document.querySelector(".kit-cheers__counts")).toBeNull();
  expect(cheerWords(ITEM.cheers, ITEM.my_cheer)).toBe(
    "On fire 2, Royal 1. You and 2 others. Yours: On fire",
  );
});

test("each kind has one glyph, a Lucide one, drawn the same wherever it shows", () => {
  const glyphs = CHEERS.map((c) => c.icon);
  expect(new Set(glyphs).size).toBe(CHEERS.length);
  expect(Object.fromEntries(CHEERS.map((c) => [c.key, c.icon]))).toEqual({
    well_played: "thumbs-up",
    on_fire: "flame",
    royal: "crown",
    wow: "sparkles",
    ha: "laugh",
    grind: "biceps-flexed",
  });
  for (const c of CHEERS) {
    cleanup();
    renderWithProviders(<CheerGlyph kind={c.key} />);
    const svg = document.querySelector("svg");
    expect(svg.getAttribute("class")).toContain(`lucide-${c.icon}`);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  }
  // The feed's counts and the kinds row draw a kind with the same glyph.
  cleanup();
  global.fetch = vi.fn(async () => reply({}));
  renderWithProviders(<Cheers it={ITEM} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose a cheer" }));
  const count = document.querySelectorAll(".kit-cheers__count svg");
  expect([...count].map((s) => s.getAttribute("class"))).toEqual([
    expect.stringContaining("lucide-flame"),
    expect.stringContaining("lucide-crown"),
  ]);
  const kinds = screen.getByRole("group", { name: "Cheer with" });
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
