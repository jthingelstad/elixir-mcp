/**
 * The Timeline's rhythm (2026-11-17): a short session is one line, short
 * sessions in a row are one group that opens in place, a close friend's
 * sessions never fold and carry the owner's star, and moments carry their
 * art. Invented names and tags only.
 */
import { test, expect, vi, afterEach } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import {
  feedRows,
  groupSaid,
  momentSaid,
  shortSession,
  smallMoment,
} from "../src/home/logic.js";
import { FeedRows, momentHead } from "../src/home/FeedItem.jsx";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

afterEach(cleanup);

const session = (id, tag, name, facts = {}, extra = {}) => ({
  id,
  kind: "battle_session",
  at: "2026-11-17T20:00:00Z",
  subjects: [{ kind: "player", tag, name }],
  groups: ["friends"],
  text: `${name} played.`,
  facts: {
    player_tag: tag,
    name,
    battles: 1,
    won: 1,
    lost: 0,
    trophy_net: 30,
    by_mode: { ladder: 1 },
    started_at: "2026-11-17T19:50:00Z",
    ended_at: "2026-11-17T20:00:00Z",
    ...facts,
  },
  evidence: { kind: "session", version: "1" },
  cheers: {},
  my_cheer: null,
  ...extra,
});
const row = (it, newLine = false) => ({ it, isNew: newLine, newLine });

test("a short session: one or two battles, no close friend, no comment, nothing but a result", () => {
  expect(shortSession(session("a", "#0QPPRRC9", "Pip"))).toBe(true);
  expect(
    shortSession(session("a", "#0QPPRRC9", "Pip", { battles: 2, won: 1 })),
  ).toBe(true);
  expect(shortSession(session("a", "#0QPPRRC9", "Pip", { battles: 3 }))).toBe(
    false,
  );
  expect(
    shortSession(
      session("a", "#0QPPRRC9", "Pip", {}, { groups: ["friends", "close"] }),
    ),
  ).toBe(false);
  expect(
    shortSession(
      session("a", "#0QPPRRC9", "Pip", {}, { comments: { count: 1 } }),
    ),
  ).toBe(false);
  expect(
    shortSession({ ...session("a", "#0QPPRRC9", "Pip"), kind: "badge_earned" }),
  ).toBe(false);
});

test("feedRows keeps the order, folds a run, and never folds across the New line", () => {
  const a = session("a", "#0QPPRRC9", "Pip");
  const b = session("b", "#0YCLUPC9", "Ash");
  const c = session("c", "#0V8R2CRC", "Elm");
  const big = session("big", "#0QPPRRC9", "Pip", { battles: 9, won: 5 });
  const rows = feedRows([row(a), row(b, true), row(c), row(big)]);
  expect(rows.map((r) => r.type)).toEqual(["group", "line", "item"]);
  expect(rows[0].rows.map((r) => r.it.id)).toEqual(["a", "b"]);
  expect(rows[0].newLine).toBe(true);
  expect(rows[1].it.id).toBe("c");
});

test("groupSaid says whose, how many, won and lost, as facts", () => {
  const one = groupSaid([
    session("a", "#0QPPRRC9", "Pip"),
    session("b", "#0QPPRRC9", "Pip", { won: 0, lost: 1 }),
  ]);
  expect(one.title).toBe("Pip played 2 short sessions");
  expect(one.record).toBe("2 battles · 1 won · 1 lost");
  const many = groupSaid([
    session("a", "#0QPPRRC9", "Pip"),
    session("b", "#0YCLUPC9", "Ash"),
    session("c", "#0V8R2CRC", "Elm"),
    session("d", "#02QCR2LP", "Bram"),
  ]);
  expect(many.title).toBe("4 short sessions from Pip, Ash and 2 others");
});

test("a group opens in place, and each session in it keeps its own cheer", () => {
  const items = [
    session("a", "#0QPPRRC9", "Pip", {}, { cheers: { on_fire: 2 } }),
    session("b", "#0YCLUPC9", "Ash"),
  ];
  renderWithProviders(<FeedRows rows={items.map((it) => row(it))} />);
  const toggle = screen.getByRole("button", { name: /2 short sessions/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.textContent).toMatch(/2 cheers/);
  expect(screen.queryByRole("button", { name: "Cheer" })).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const body = document.getElementById(toggle.getAttribute("aria-controls"));
  expect(within(body).getAllByRole("button", { name: "Cheer" })).toHaveLength(
    2,
  );
  expect(within(body).getAllByRole("article")).toHaveLength(2);
});

test("a close friend's one battle keeps its card, with the owner's star", () => {
  const it = session(
    "a",
    "#0QG0JPUC",
    "Moss",
    {},
    { groups: ["friends", "close"] },
  );
  renderWithProviders(<FeedRows rows={[row(it)]} />);
  expect(document.querySelector(".kit-feed__item--line")).toBeNull();
  expect(screen.getByTitle("Close friend. Only you see this.")).toBeTruthy();
});

test("a lone short session is one line that opens its page", () => {
  renderWithProviders(
    <FeedRows rows={[row(session("a", "#0QPPRRC9", "Pip"))]} />,
  );
  const line = document.querySelector(".kit-feed__item--line");
  expect(line).toBeTruthy();
  expect(line.textContent).toMatch(/Won a Trophy Road battle/);
  expect(line.textContent).toMatch(/\+30 trophies/);
  expect(
    within(line).getByRole("link", { name: /Open Pip’s session/ }),
  ).toBeTruthy();
});

test("moments say their head from their facts, and only then", () => {
  expect(
    momentHead({ kind: "best_trophies_band", facts: { best: 7512 } }),
  ).toEqual({ kicker: "New best", title: "7,512 trophies" });
  expect(
    momentHead({
      kind: "arena_changed",
      facts: { from: 15, to: 14, to_name: "Lower" },
    }),
  ).toBeNull();
  expect(
    momentHead({
      kind: "card_form_unlocked",
      facts: { card: "Knight", card_id: 26000000, form: "evolution" },
    }),
  ).toEqual({ kicker: "New Evo", title: "Knight" });
  expect(
    momentHead({
      kind: "badge_earned",
      facts: { badge: "MasteryKnight" },
      moment_card: { id: 26000000, name: "Knight" },
    }),
  ).toEqual({ kicker: "Card Mastery", title: "Knight" });
  expect(
    momentHead({ kind: "badge_earned", facts: { badge: "Classic12Wins" } }),
  ).toBeNull();
});

test("a new best reads as the day's headline; an Arena move down does not", () => {
  const moment = (kind, facts) => ({
    id: kind,
    kind,
    at: "2026-11-17T20:00:00Z",
    subjects: [{ kind: "player", tag: "#0QPPRRC9", name: "Pip" }],
    groups: ["friends"],
    text: "Pip moved.",
    facts,
  });
  renderWithProviders(
    <FeedRows
      rows={[
        row(moment("best_trophies_band", { best: 7512, band: 7500 })),
        row(
          moment("arena_changed", { from: 15, to: 14, to_name: "Lower Arena" }),
        ),
      ]}
    />,
  );
  const items = document.querySelectorAll(".kit-feed__item");
  expect(items[0].className).toMatch(/kit-feed__item--headline/);
  expect(items[1].className).not.toMatch(/kit-feed__item--headline/);
});

const small = (id, kind, tag, name, text, facts = {}, extra = {}) => ({
  id,
  kind,
  at: "2026-11-17T20:00:00Z",
  subjects: [{ kind: "player", tag, name }],
  groups: ["friends"],
  text,
  facts: { player_tag: tag, name, ...facts },
  cheers: {},
  my_cheer: null,
  ...extra,
});

test("2026-11-17: small moments are lines, and several in a row are one group", () => {
  const maxed = small(
    "m1",
    "card_maxed",
    "#0QPPRRC9",
    "Pip",
    "Pip maxed Hog Rider.",
    {
      card: "Hog Rider",
      card_id: 26000021,
    },
  );
  const king = small(
    "m2",
    "king_tower_leveled",
    "#0YCLUPC9",
    "Ash",
    "Ash reached King Tower level 15.",
    {
      level: 15,
    },
  );
  expect(smallMoment(maxed)).toBe(true);
  // A headline keeps its card; so does a clan's item or a close friend's.
  expect(
    smallMoment(small("h", "best_trophies_band", "#0QPPRRC9", "Pip", "x")),
  ).toBe(false);
  expect(
    smallMoment({
      ...maxed,
      subjects: [...maxed.subjects, { kind: "clan", tag: "#0PYLQ2" }],
    }),
  ).toBe(false);
  expect(smallMoment({ ...maxed, groups: ["friends", "close"] })).toBe(false);
  // The row already names the player.
  expect(momentSaid(maxed, "Pip")).toBe("Maxed Hog Rider.");
  expect(
    momentSaid({ text: "Pip's best challenge run is now 9 wins." }, "Pip"),
  ).toBe("Best challenge run is now 9 wins.");
  // A run of moments is one group; a session between them ends it, and a
  // moment never folds with a session.
  const s = session("s", "#0QPPRRC9", "Pip");
  expect(
    feedRows([row(maxed), row(king), row(s), row(maxed)]).map((r) => r.type),
  ).toEqual(["moments", "line", "moment"]);

  renderWithProviders(<FeedRows rows={[row(maxed), row(king)]} />);
  const toggle = screen.getByRole("button", {
    name: /2 moments from Pip and Ash/,
  });
  fireEvent.click(toggle);
  const body = document.getElementById(toggle.getAttribute("aria-controls"));
  expect(within(body).getAllByRole("article")).toHaveLength(2);
  expect(body.textContent).toMatch(/Maxed Hog Rider\./);
  expect(body.textContent).toMatch(/Reached King Tower level 15\./);
});

test("2026-11-17: the profile moments' heads", () => {
  expect(
    momentHead({ kind: "card_maxed", facts: { card: "Hog Rider" } }),
  ).toEqual({ kicker: "Maxed", title: "Hog Rider" });
  expect(
    momentHead({ kind: "king_tower_leveled", facts: { level: 15 } }),
  ).toEqual({ kicker: "King Tower", title: "Level 15" });
  expect(
    momentHead({
      kind: "badge_earned",
      facts: { badge: "MasteryHogRider", badges: [{}, {}], badge_count: 4 },
    }),
  ).toEqual({ kicker: "Card Mastery", title: "4 cards" });
  expect(
    momentHead({
      kind: "badge_earned",
      facts: { badge: "YearsPlayed", level: 5 },
    }),
  ).toEqual({ kicker: "Years played", title: "5 years" });
});

test("0289: a deck switch's head names its mode and its deck; it is never a small moment", () => {
  expect(
    momentHead({
      kind: "deck_switched",
      facts: { mode: "ranked", deck: "Hog Rider cycle" },
    }),
  ).toEqual({ kicker: "New deck in Ranked", title: "Hog Rider cycle" });
  expect(
    momentHead({ kind: "deck_switched", facts: { mode: "ladder" } }),
  ).toBeNull();
  expect(smallMoment({ kind: "deck_switched", facts: {}, subjects: [] })).toBe(
    false,
  );
});
