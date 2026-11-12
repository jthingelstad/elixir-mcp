import { describe, expect, test } from "vitest";
import {
  clanTabs,
  leads,
  eldersUp,
  pageOf,
  policyActive,
  tabOf,
  waitingFor,
} from "../src/lib/tabs.js";
import { clanMoved } from "../src/lib/moved.js";
import { parseClanPath } from "../src/App.jsx";

const BASE = "/clan/2PQRJ8LV";
const me = (role, extra = {}) => ({
  ok: true,
  selected: { clan_tag: "#2PQRJ8LV", role, verified: true },
  clans: [{}],
  policy: { set: true, active: true },
  open_actions: 0,
  ...extra,
});
const keys = (m) => clanTabs(m).map((t) => t.key);

describe("Clan as one view: six tabs", () => {
  const FOUR = ["feed", "standings", "war", "members", "policy"];

  test("every member has five, a leader and a co-leader have Run as well", () => {
    expect(keys(me("member"))).toEqual(FOUR);
    expect(keys(me("elder"))).toEqual(FOUR);
    expect(keys(me("leader"))).toEqual([...FOUR, "run"]);
    expect(keys(me("coLeader"))).toEqual([...FOUR, "run"]);
  });

  test("an unverified leader reads as a member", () => {
    const m = me("leader");
    m.selected.verified = false;
    expect(keys(m)).toEqual(FOUR);
    expect(leads(m.selected)).toBe(false);
    expect(eldersUp(m.selected)).toBe(false);
  });

  test("the tabs stay with no policy; Run is there to write one", () => {
    expect(keys(me("leader", { policy: { set: false } }))).toEqual([
      ...FOUR,
      "run",
    ]);
    expect(keys(me("member", { policy: { set: false } }))).toEqual(FOUR);
  });

  test("Feed counts what is waiting for you, and only with an active policy", () => {
    const today = (m) => clanTabs(m)[0];
    expect(today(me("leader", { open_actions: 3 }))).toMatchObject({
      count: 3,
      countLabel: "waiting for you",
    });
    expect(today(me("leader")).count).toBeNull();
    const parked = me("leader", {
      open_actions: 3,
      policy: { set: true, active: false },
    });
    expect(policyActive(parked)).toBe(false);
    expect(waitingFor(parked)).toBe(0);
    expect(today(parked).count).toBeNull();
  });

  test("no selected clan, no tabs", () => {
    expect(clanTabs({ selected: null })).toEqual([]);
  });

  test("a clan's own addresses are all under its tag", () => {
    expect(clanTabs(me("leader")).map((t) => t.href)).toEqual([
      `${BASE}/feed`,
      `${BASE}/standings`,
      `${BASE}/war`,
      `${BASE}/members`,
      `${BASE}/policy`,
      `${BASE}/run`,
    ]);
  });
});

describe("which tab and page a path is", () => {
  test("every page is on its tab", () => {
    for (const [path, tab] of [
      [`${BASE}/feed`, "feed"],
      [`${BASE}/actions/37`, "feed"],
      [`${BASE}/members`, "members"],
      [`${BASE}/members/standing`, "members"],
      [`${BASE}/members/uq8lp2r9c`, "members"],
      [`${BASE}/war/136-2`, "war"],
      [`${BASE}/standings/135`, "standings"],
      [`${BASE}/policy`, "policy"],
      [`${BASE}/run/about`, "run"],
      [`${BASE}/run/decided`, "run"],
    ])
      expect(tabOf(path)).toBe(tab);
    expect(tabOf("/clan/clans")).toBeNull();
    expect(tabOf(`${BASE}/nowhere`)).toBeNull();
  });

  test("the page never carries a tag or a number", () => {
    for (const [path, page] of [
      [`${BASE}/feed`, "feed"],
      [`${BASE}/actions/37`, "action"],
      [`${BASE}/members`, "roster"],
      [`${BASE}/members/standing`, "standing"],
      [`${BASE}/members/uq8lp2r9c`, "member"],
      [`${BASE}/war/136-2`, "war"],
      [`${BASE}/standings/135`, "standings"],
      [`${BASE}/policy`, "policy"],
      [`${BASE}/run`, "run"],
      [`${BASE}/run/about`, "run/about"],
      ["/clan/clans", "clans"],
    ])
      expect(pageOf(path)).toBe(page);
  });

  test("parseClanPath reads a clan's address and its pages", () => {
    expect(parseClanPath(BASE)).toEqual({
      tag: "#2PQRJ8LV",
      section: null,
      tab: null,
    });
    expect(parseClanPath(`${BASE}/run/model-voice`)).toEqual({
      tag: "#2PQRJ8LV",
      section: "run",
      tab: "model-voice",
    });
    expect(parseClanPath(`${BASE}/discord`)).toBeNull();
    // The five tabs' addresses are redirected before the page reads them.
    expect(parseClanPath(`${BASE}/today`)).toBeNull();
    expect(parseClanPath(`${BASE}/season`)).toBeNull();
    expect(parseClanPath("/clan/clans")).toBeNull();
  });
});

describe("every Clan address that moved", () => {
  for (const [from, to] of [
    ["", "feed"],
    ["/", "feed"],
    ["/actions", "feed"],
    ["/today", "feed"],
    ["/today/decided", "run/decided"],
    ["/today/anything", "feed"],
    ["/season", "war"],
    ["/season/2026-W45", "war/2026-W45"],
    ["/season/136", "war/136"],
    ["/awards", "standings"],
    ["/awards/135", "standings/135"],
    ["/roster", "members"],
    ["/me", "members/me"],
    ["/week", "war"],
    ["/week/136-2", "war/136-2"],
    ["/standing", "standings"],
    ["/trophies", "standings"],
    ["/recruit", "members/recruit"],
    ["/map", "members/map"],
    ["/discord", "run/discord"],
    ["/manage", "feed"],
    ["/manage/inbox", "feed"],
    ["/manage/board", "run/review"],
    ["/members/standing", "standings"],
    ["/members/review", "run/review"],
    ["/manage/history", "run/decided"],
    ["/manage/policy", "run/about"],
    ["/manage/settings", "run/settings"],
    ["/manage/model", "run/model-voice"],
    ["/manage/scout", "members/scout"],
    ["/manage/awards", "standings"],
    ["/manage/gone", "feed"],
  ])
    test(`${from || "(the clan)"} goes to ${to}`, () => {
      expect(clanMoved(`${BASE}${from}`)).toBe(`${BASE}/${to}`);
    });

  test("what did not move stays, and nothing else is asked", () => {
    for (const path of [
      `${BASE}/feed`,
      `${BASE}/actions/37`,
      `${BASE}/members`,
      `${BASE}/members/map`,
      `${BASE}/members/recruit`,
      `${BASE}/members/scout`,
      `${BASE}/members/uq8lp2r9c`,
      `${BASE}/war`,
      `${BASE}/war/136`,
      `${BASE}/standings`,
      `${BASE}/policy`,
      `${BASE}/run`,
      `${BASE}/run/decided`,
      "/clan",
      "/clan/clans",
      "/clan/you",
      "/clan/you/away",
      "/ladder/2PQRJ8LV",
      "/console",
    ])
      expect(clanMoved(path)).toBeNull();
  });

  test("a moved page is never moved again", () => {
    for (const from of [
      "/roster",
      "/manage/board",
      "/week/136-2",
      "/discord",
      "/today/decided",
      "/season/136",
      "/awards",
      "/manage/history",
      "/standing",
      "/members/standing",
      "/members/review",
    ]) {
      const to = clanMoved(`${BASE}${from}`);
      expect(clanMoved(to)).toBeNull();
    }
  });
});
