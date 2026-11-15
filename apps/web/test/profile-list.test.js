/**
 * Home's profile list (#1015) as words: the steps from `owner.profile`
 * alone, the follow step's three states told apart, and the list gone
 * for good once complete or dismissed. Invented names only.
 */
import { describe, expect, test } from "vitest";
import {
  EXTRAS,
  followLine,
  profileView,
  stampName,
} from "../src/home/profile-list.js";

const IDS = [
  "add_player",
  "verify_player",
  "picture",
  "follow_active",
  "digest",
  "map",
];
const profile = (states, extra = {}) => ({
  version: 2,
  complete: false,
  completed_at: null,
  older_welcome_finished: false,
  dismissed_at: null,
  follows: { following: 0, active: 0, unknown: 0 },
  steps: IDS.map((id, i) => ({ id, state: states[i], latched: false })),
  ...extra,
});
const ctx = { playerName: "Invented One", digest: null };

describe("The profile list", () => {
  test("six steps in order, each naming the Stamp it earns", () => {
    const v = profileView(
      profile(["done", "todo", "todo", "todo", "todo", "todo"]),
      ctx,
    );
    expect(v.steps.map((s) => s.title)).toEqual([
      "Add your player",
      "Verify it’s you",
      "Pick your picture",
      "Follow someone who plays",
      "Choose your email",
      "Your place on the clan map",
    ]);
    expect(v.steps.map((s) => s.stamp)).toEqual([
      null,
      stampName("player_verified"),
      stampName("looking_good"),
      null,
      null,
      stampName("on_the_map"),
    ]);
    expect([v.done, v.total, v.older, v.dismissable]).toEqual([
      1,
      6,
      false,
      false,
    ]);
    expect(v.allSet).toBe(stampName("all_set"));
    expect(v.next.id).toBe("verify_player");
    expect(v.next.go).toEqual({
      to: "/settings/players/verify",
      label: "Verify",
      name: "Verify Invented One",
    });
    expect(v.steps[0].line).toBe("Invented One, your main player.");
    expect(v.steps[0].go).toBeNull();
  });

  test("the map step opens its picker right there and offers Not now", () => {
    const v = profileView(
      profile(["done", "done", "done", "done", "done", "todo"]),
      ctx,
    );
    expect(v.next.id).toBe("map");
    expect(v.next.notNow).toBe(true);
    expect(v.next.place).toBe(true);
    // No clan page: the place is the person's.
    expect(v.next.go).toBeNull();
  });

  test("before a verified player the map step waits on verifying", () => {
    const v = profileView(
      profile(["done", "todo", "done", "done", "done", "todo"]),
      ctx,
    );
    const map = v.steps.find((s) => s.id === "map");
    expect(map.place).toBe(false);
    expect(map.line).toBe(
      "First verify your player. A place belongs to a verified player.",
    );
    expect(map.go).toEqual({
      to: "/settings/players/verify",
      label: "Verify",
      name: "Verify your player first",
    });
    expect(map.notNow).toBe(true);
  });

  test("the place route's answer, not the verify latch, decides the picker", () => {
    // A verified alt with an unverified main: the route allows a place.
    const alt = profileView(
      profile(["done", "todo", "done", "done", "done", "todo"]),
      { ...ctx, placeAllowed: true },
    );
    expect(alt.steps.find((s) => s.id === "map").place).toBe(true);
    // Verification lost after the latch: the route refuses, so no picker.
    const lost = profileView(
      profile(["done", "done", "done", "done", "done", "todo"]),
      { ...ctx, placeAllowed: false },
    );
    const map = lost.steps.find((s) => s.id === "map");
    expect(map.place).toBe(false);
    expect(map.go?.to).toBe("/settings/players/verify");
  });

  test("a step Elixir cannot tell yet comes after every step to do", () => {
    const v = profileView(
      profile(["done", "done", "done", "unknown", "todo", "done"]),
      ctx,
    );
    expect(v.next.id).toBe("digest");
    const w = profileView(
      profile(["done", "done", "done", "unknown", "done", "done"], {
        follows: { following: 2, active: 0, unknown: 1 },
      }),
      ctx,
    );
    expect(w.next.id).toBe("follow_active");
    expect(w.next.state).toBe("unknown");
  });

  test("after the older welcome: only what is left, and it can be hidden", () => {
    const v = profileView(
      profile(["done", "done", "todo", "done", "done", "todo"], {
        older_welcome_finished: true,
      }),
      ctx,
    );
    expect(v.steps.map((s) => s.id)).toEqual(["picture", "map"]);
    expect([v.done, v.total, v.older, v.dismissable]).toEqual([
      4,
      6,
      true,
      true,
    ]);
  });

  test("nothing to show: no read, another version, complete, dismissed", () => {
    const steps = ["todo", "todo", "todo", "todo", "todo", "todo"];
    expect(profileView(null, ctx)).toBeNull();
    expect(profileView(profile(steps, { version: 1 }), ctx)).toBeNull();
    expect(profileView(profile(steps, { complete: true }), ctx)).toBeNull();
    expect(
      profileView(
        profile(steps, { dismissed_at: "2026-11-14T12:00:00.000Z" }),
        ctx,
      ),
    ).toBeNull();
  });

  test("the extras are offered, never counted", () => {
    expect(EXTRAS.map((x) => x.id)).toEqual(["full_roster", "linked"]);
    const v = profileView(
      profile(["done", "done", "done", "done", "done", "todo"]),
      ctx,
    );
    expect(v.total).toBe(6);
    expect(v.steps.some((s) => s.id === "full_roster")).toBe(false);
  });
});

describe("The follow step never claims more than Elixir knows", () => {
  test("nobody followed, one quiet, several quiet, catching up", () => {
    expect(followLine("todo", { following: 0 })).toBe(
      "Follow one player who’s played in the last 7 days. Their battles fill your feed.",
    );
    expect(followLine("todo", { following: 1 })).toBe(
      "The player you follow hasn’t played in the last 7 days. Follow someone who has.",
    );
    expect(followLine("todo", { following: 3 })).toBe(
      "The players you follow haven’t played in the last 7 days. Follow someone who has.",
    );
    expect(followLine("unknown", { following: 2 })).toBe(
      "Elixir is still catching up on their battles. This step is done once it sees one from the last 7 days.",
    );
    expect(followLine("done", { following: 2 })).toBe(
      "You follow someone who played this week.",
    );
  });
  test("unknown is never said to be a quiet week", () => {
    expect(followLine("unknown", null)).toBeNull();
    expect(followLine("unknown", { following: 1 })).not.toMatch(/hasn’t/);
  });
});
