import { describe, expect, test } from "vitest";
import {
  clanTabs,
  leads,
  eldersUp,
  membersPages,
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

describe("Clan's five tabs", () => {
  const FOUR = ["today", "members", "season", "awards"];

  test("every member has four, a leader and a co-leader have Run as well", () => {
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

  test("Today counts what is waiting for you, and only with an active policy", () => {
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
    expect(membersPages({ selected: null })).toEqual({ chips: [], side: [] });
  });

  test("a clan's own addresses are all under its tag", () => {
    expect(clanTabs(me("leader")).map((t) => t.href)).toEqual([
      `${BASE}/today`,
      `${BASE}/members`,
      `${BASE}/season`,
      `${BASE}/awards`,
      `${BASE}/run`,
    ]);
  });
});

describe("the pages inside Members", () => {
  const chips = (m) => membersPages(m).chips.map((c) => c.key);
  const side = (m) => membersPages(m).side.map((c) => c.key);

  test("who sees which", () => {
    expect(chips(me("member"))).toEqual(["roster", "standing", "map"]);
    expect(side(me("member"))).toEqual(["recruit"]);
    expect(chips(me("elder"))).toEqual(["roster", "standing", "map"]);
    expect(side(me("elder"))).toEqual(["recruit", "scout"]);
    expect(chips(me("leader"))).toEqual([
      "roster",
      "standing",
      "review",
      "map",
    ]);
    expect(side(me("coLeader"))).toEqual(["recruit", "scout"]);
  });

  test("the map goes when the clan turns it off or the player is not verified", () => {
    expect(chips(me("member", { social: { enabled: false } }))).not.toContain(
      "map",
    );
    const m = me("member");
    m.selected.verified = false;
    expect(chips(m)).not.toContain("map");
    expect(side(m)).toEqual(["recruit"]);
  });
});

describe("which tab and page a path is", () => {
  test("every page is on its tab", () => {
    for (const [path, tab] of [
      [`${BASE}/today`, "today"],
      [`${BASE}/today/decided`, "today"],
      [`${BASE}/actions/37`, "today"],
      [`${BASE}/members`, "members"],
      [`${BASE}/members/standing`, "members"],
      [`${BASE}/members/uq8lp2r9c`, "members"],
      [`${BASE}/season/136-2`, "season"],
      [`${BASE}/awards/135`, "awards"],
      [`${BASE}/run/about`, "run"],
    ])
      expect(tabOf(path)).toBe(tab);
    expect(tabOf("/clan/clans")).toBeNull();
    expect(tabOf(`${BASE}/nowhere`)).toBeNull();
  });

  test("the page never carries a tag or a number", () => {
    for (const [path, page] of [
      [`${BASE}/today`, "today"],
      [`${BASE}/actions/37`, "action"],
      [`${BASE}/members`, "roster"],
      [`${BASE}/members/standing`, "standing"],
      [`${BASE}/members/uq8lp2r9c`, "member"],
      [`${BASE}/season/136-2`, "season"],
      [`${BASE}/awards/135`, "awards"],
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
    expect(parseClanPath("/clan/clans")).toBeNull();
  });
});

describe("every Clan address that moved", () => {
  for (const [from, to] of [
    ["", "today"],
    ["/", "today"],
    ["/actions", "today"],
    ["/roster", "members"],
    ["/me", "members/me"],
    ["/week", "season"],
    ["/week/136-2", "season/136-2"],
    ["/standing", "members/standing"],
    ["/trophies", "awards"],
    ["/recruit", "members/recruit"],
    ["/map", "members/map"],
    ["/discord", "run/discord"],
    ["/manage", "today"],
    ["/manage/inbox", "today"],
    ["/manage/board", "members/review"],
    ["/manage/history", "today/decided"],
    ["/manage/policy", "run/about"],
    ["/manage/settings", "run/settings"],
    ["/manage/model", "run/model-voice"],
    ["/manage/scout", "members/scout"],
    ["/manage/awards", "awards"],
    ["/manage/gone", "today"],
  ])
    test(`${from || "(the clan)"} goes to ${to}`, () => {
      expect(clanMoved(`${BASE}${from}`)).toBe(`${BASE}/${to}`);
    });

  test("what did not move stays, and nothing else is asked", () => {
    for (const path of [
      `${BASE}/today`,
      `${BASE}/today/decided`,
      `${BASE}/actions/37`,
      `${BASE}/members`,
      `${BASE}/members/standing`,
      `${BASE}/season`,
      `${BASE}/awards`,
      `${BASE}/run`,
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
    ]) {
      const to = clanMoved(`${BASE}${from}`);
      expect(clanMoved(to)).toBeNull();
    }
  });
});
