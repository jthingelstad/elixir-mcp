import { describe, expect, test } from "vitest";
import {
  clanTabs,
  leads,
  eldersUp,
  pageOf,
  policyActive,
  tabOf,
  waitingFor,
} from "../../src/clan/lib/tabs.js";
import { defaultParseSearch } from "@tanstack/react-router";
import { parseClanPath, searchText } from "../../src/clan/App.jsx";

const BASE = "/clan/0QC8RCGY";
const me = (role, extra = {}) => ({
  ok: true,
  selected: { clan_tag: "#0QC8RCGY", role, verified: true },
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
      [`${BASE}/members/02qqpcyqq`, "members"],
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
      [`${BASE}/members/02qqpcyqq`, "member"],
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
      tag: "#0QC8RCGY",
      section: null,
      tab: null,
    });
    expect(parseClanPath(`${BASE}/run/model-voice`)).toEqual({
      tag: "#0QC8RCGY",
      section: "run",
      tab: "model-voice",
    });
    expect(parseClanPath(`${BASE}/discord`)).toBeNull();
    // The old tabs' addresses stopped working on 2026-11-13.
    expect(parseClanPath(`${BASE}/today`)).toBeNull();
    expect(parseClanPath(`${BASE}/season`)).toBeNull();
    expect(parseClanPath("/clan/clans")).toBeNull();
  });

  test("a query value reads back as the text typed, through the app's router", () => {
    // Clan moves on the app's one navigation, whose router reads a query
    // string as JSON where it can: a tag or a name that looks like a
    // number or a word of JSON is still the text.
    const read = (qs) => defaultParseSearch(qs);
    expect(searchText(read("?q=2089").q)).toBe("2089");
    expect(searchText(read("?find=true").find)).toBe("true");
    expect(searchText(read("?find=null").find)).toBe("null");
    expect(searchText(read("?q=0QC8RCGY").q)).toBe("0QC8RCGY");
    expect(searchText(read("?find=King%20Thing").find)).toBe("King Thing");
    expect(searchText(read("").find)).toBeNull();
  });
});
