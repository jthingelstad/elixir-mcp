import { afterEach, describe, expect, test } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import {
  landingAt,
  landingPath,
  landsOnActions,
  useLanding,
} from "../src/lib/landing.js";
import { railItems, railKey } from "../src/lib/rail.js";
import { parseClanPath } from "../src/App.jsx";

afterEach(cleanup);

// Jamie, 2026-10-20: "If there are actions to take, yes. Otherwise no."
const TAG = "#2PQRJ8LV";
const OTHER = "#GQ08RJPL";
const BASE = "/clan/2PQRJ8LV";

/** A signed-in person whose selected clan is TAG, holding `role` there,
 *  with `open_actions` waiting for them; OTHER is a second clan of theirs
 *  where they hold `otherRole`. */
const me = (
  role,
  open_actions,
  { verified = true, policy = true, otherRole = "member" } = {},
) => ({
  signed_in: true,
  ok: true,
  clans: [
    { clan_tag: TAG, role, verified },
    { clan_tag: OTHER, role: otherRole, verified: true },
  ],
  selected: { clan_tag: TAG, role, verified },
  policy: policy ? { set: true, active: true } : { set: false },
  open_actions,
});

describe("where arriving at a clan lands", () => {
  const CASES = [
    ["a leader with Actions waiting", me("leader", 2), "actions"],
    ["a leader with none", me("leader", 0), "roster"],
    ["a co-leader with Actions waiting", me("coLeader", 1), "actions"],
    ["a co-leader with none", me("coLeader", 0), "roster"],
    ["an elder with Actions waiting", me("elder", 3), "roster"],
    ["an elder with none", me("elder", 0), "roster"],
    // A member's own Actions (an away question) wait for them too.
    ["a member with an Action waiting", me("member", 1), "roster"],
    ["a member with none", me("member", 0), "roster"],
  ];
  for (const [who, m, lands] of CASES)
    test(`${who}: ${lands}`, () => {
      expect(landsOnActions(m)).toBe(lands === "actions");
      expect(landingPath(m)).toBe(
        lands === "actions" ? `${BASE}/actions` : BASE,
      );
      expect(landingAt(m, BASE)).toBe(lands);
      expect(landingAt(m, `${BASE}/`)).toBe(lands);
    });

  test("an unverified leader reads as a member, and lands on the roster", () => {
    // The gate makes an unverified player a member here; a stray role
    // on an unverified entry still does not lead.
    expect(landsOnActions(me("leader", 2, { verified: false }))).toBe(false);
    expect(landingAt(me("leader", 2, { verified: false }), BASE)).toBe(
      "roster",
    );
  });

  test("no active policy, no Actions: the roster, as the rail shows none", () => {
    const m = me("leader", 2, { policy: false });
    expect(landsOnActions(m)).toBe(false);
    expect(landingPath(m)).toBe(BASE);
  });

  test("an address that names a section always opens it", () => {
    const m = me("leader", 2);
    for (const path of [
      `${BASE}/roster`,
      `${BASE}/actions`,
      `${BASE}/actions/37`,
      `${BASE}/members/uq8lp2r9c`,
      `${BASE}/standing`,
      `${BASE}/manage/policy`,
      "/clan/clans",
      "/clan/you",
    ])
      expect(landingAt(m, path)).toBeNull();
    // A roster search names the roster.
    expect(landingAt(m, BASE, { search: true })).toBe("roster");
    // `/clan` itself is the gate's, which goes to landingPath.
    expect(landingAt(m, "/clan")).toBeNull();
  });

  test("a clan that is not one of yours is no landing", () => {
    expect(landingAt(me("leader", 2), "/clan/PYLQ2")).toBeNull();
  });

  test("signed out or refused, nothing is decided", () => {
    expect(landingAt({ signed_in: false }, BASE)).toBeNull();
    expect(landingAt({ signed_in: true, ok: false }, BASE)).toBeNull();
    expect(landingAt(null, BASE)).toBeNull();
    expect(landsOnActions({ signed_in: false })).toBe(false);
  });

  test("another of your clans: a leader there waits for it to be selected, anyone else reads the roster at once", () => {
    // open_actions is the selected clan's, not this one's.
    expect(
      landingAt(me("member", 2, { otherRole: "leader" }), "/clan/GQ08RJPL"),
    ).toBe("wait");
    expect(
      landingAt(me("member", 2, { otherRole: "coLeader" }), "/clan/GQ08RJPL"),
    ).toBe("wait");
    expect(
      landingAt(me("leader", 2, { otherRole: "elder" }), "/clan/GQ08RJPL"),
    ).toBe("roster");
    expect(landingPath(me("leader", 2), OTHER)).toBe("/clan/GQ08RJPL");
  });

  test("picking a clan goes straight to its landing from the select answer", () => {
    // The select answer is the session for the chosen clan.
    const chosen = {
      ...me("leader", 1),
      selected: { clan_tag: OTHER, role: "leader" },
    };
    expect(landingPath(chosen, OTHER)).toBe("/clan/GQ08RJPL/actions");
    expect(landingPath({ ...chosen, open_actions: 0 }, OTHER)).toBe(
      "/clan/GQ08RJPL",
    );
  });
});

describe("decided once per arrival", () => {
  test("a leader reading the roster is not moved when Actions arrive later", () => {
    const { result, rerender } = renderHook(
      ({ m, path }) => useLanding(m, path),
      { initialProps: { m: me("leader", 0), path: BASE } },
    );
    expect(result.current).toBe("roster");
    rerender({ m: me("leader", 3), path: BASE });
    expect(result.current).toBe("roster");
    // A new arrival decides afresh.
    rerender({ m: me("leader", 3), path: "/clan/2pqrj8lv" });
    expect(result.current).toBe("actions");
  });

  test("a leader waiting on the selection lands once it comes", () => {
    const pending = me("member", 0, { otherRole: "leader" });
    const { result, rerender } = renderHook(
      ({ m }) => useLanding(m, "/clan/GQ08RJPL"),
      { initialProps: { m: pending } },
    );
    expect(result.current).toBe("wait");
    rerender({
      m: {
        ...pending,
        selected: { clan_tag: OTHER, role: "leader", verified: true },
        open_actions: 2,
      },
    });
    expect(result.current).toBe("actions");
  });

  test("a roster search is the roster, and clearing it stays there", () => {
    // An old link to the clan's address with a search, for a leader
    // with Actions waiting.
    const { result, rerender } = renderHook(
      ({ search }) => useLanding(me("leader", 2), BASE, { search }),
      { initialProps: { search: true } },
    );
    expect(result.current).toBe("roster");
    rerender({ search: false });
    expect(result.current).toBe("roster");
  });
});

describe("the roster has an address of its own", () => {
  test("the rail's Roster names it, and it is the Roster item", () => {
    const roster = railItems(me("leader", 2)).find((r) => r.key === "clan");
    expect(roster).toMatchObject({ label: "Roster", to: `${BASE}/roster` });
    expect(railKey(`${BASE}/roster`)).toBe("clan");
    expect(railKey(`${BASE}/roster/`)).toBe("clan");
    expect(railKey(BASE)).toBe("clan");
    expect(railKey("/clan/clans/roster")).toBeNull();
  });

  test("it parses as the roster section", () => {
    expect(parseClanPath(`${BASE}/roster`)).toEqual({
      tag: TAG,
      section: "roster",
      tab: null,
    });
    expect(parseClanPath(BASE)?.section).toBe("roster");
  });
});
