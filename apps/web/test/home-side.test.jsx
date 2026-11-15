/**
 * Home's side and profile list: the digest chosen in place with the same
 * write Settings makes, the profile list (#1015) from the passport read
 * with its next step on top, and the race's place on the clan card while a
 * war day runs. Invented names only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { HomePanels } from "../src/home/Today.jsx";
import { digestChoice, digestWhen } from "../src/home/logic.js";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const PLAYER = { player_tag: "#00JQ20", name: "Invented One", verified: true };
const CLAN = {
  ok: true,
  state: "member",
  clan_tag: "#0QC8RCGY",
  name: "Ada's Clan",
  role: "member",
  race_now: {
    season_id: 140,
    section_index: 1,
    is_colosseum: false,
    day_kind: "war",
    war_day: 2,
    finished: false,
    place: 2,
    fame: 8400,
  },
  needs: [],
  needs_total: 0,
};

const PLACE = {
  country: "CA",
  country_name: "Canada",
  region: "08",
  region_name: "Ontario",
  city: null,
  city_name: null,
  precision: "region",
};

const IDS = [
  "add_player",
  "verify_player",
  "picture",
  "follow_active",
  "digest",
  "map",
];
const passport = (states, extra = {}) => ({
  owner: {
    profile: {
      version: 2,
      complete: false,
      completed_at: null,
      older_welcome_finished: false,
      dismissed_at: null,
      follows: { following: 1, active: 0, unknown: 0 },
      steps: IDS.map((id, i) => ({ id, state: states[i], latched: false })),
      ...extra,
    },
    stamps: [],
  },
});

let writes;
let owner;
beforeEach(() => {
  writes = [];
  owner = passport(["done", "done", "todo", "todo", "done", "todo"]);
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path).split("?")[0];
    if (init?.method === "PUT" && p === "/api/clan/me/place") {
      writes.push([p, JSON.parse(init.body)]);
      // The server's hook latches the map step once the save succeeds.
      owner = passport(["done", "done", "done", "done", "done", "done"], {
        complete: true,
      });
      return reply({ place: PLACE });
    }
    if (p === "/api/clan/me/place") return reply({ place: null });
    if (init?.method === "PUT") {
      writes.push([p, JSON.parse(init.body)]);
      return reply({ kind: "tracking_report" });
    }
    if (p === "/api/me/passport") return reply(owner);
    if (init?.method === "POST" && p === "/api/me/passport/map") {
      writes.push([p, JSON.parse(init.body)]);
      const after = passport(["done", "done", "todo", "todo", "done", "done"]);
      return reply({ ...after, granted: [], more: false });
    }
    if (init?.method === "POST" && p === "/api/me/passport/dismiss") {
      writes.push([p, JSON.parse(init.body)]);
      const after = passport(["done", "done", "todo", "todo", "done", "todo"], {
        older_welcome_finished: true,
        dismissed_at: "2026-11-14T12:00:00.000Z",
      });
      return reply(after);
    }
    if (p === "/api/me/home/clan") return reply({ clan: CLAN });
    if (p === "/api/me/home/needs") return reply({ needs: CLAN });
    return reply({});
  });
});
afterEach(() => cleanup());

const first = (setup) => ({ player: PLAYER, setup });

test("the digest's lit choice is the person's own, else weekly", () => {
  expect(digestChoice(null)).toBe("weekly");
  expect(digestChoice({ enabled: true, cadence: "daily" })).toBe("daily");
  expect(digestChoice({ enabled: false, cadence: "daily" })).toBe("off");
  expect(digestWhen("weekly")).toBe("once a week");
});

test("choosing the digest on Home makes Settings' write, Off included", async () => {
  renderWithProviders(
    <HomePanels
      first={first({ following: 2, digest: null })}
      player={PLAYER}
      feed={null}
    />,
  );
  const group = await screen.findByRole("group", {
    name: "How often your digest comes",
  });
  const weekly = screen.getByRole("button", { name: "Weekly" });
  expect(weekly.getAttribute("aria-pressed")).toBe("true");
  expect(group.closest("section").textContent).toContain("once a week");
  // The lit default saves too: that is how a person chooses it.
  fireEvent.click(weekly);
  await waitFor(() => expect(writes).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Off" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes).toEqual([
    [
      "/api/me/email",
      { kind: "tracking_report", cadence: "weekly", enabled: true },
    ],
    ["/api/me/email", { kind: "tracking_report", enabled: false }],
  ]);
  expect(screen.getByText(/Your feed is still here/)).toBeTruthy();
});

test("the profile list puts its next step on top, the six folded under it", async () => {
  renderWithProviders(
    <HomePanels
      first={first({ following: 1, digest: { enabled: false } })}
      player={PLAYER}
      feed={null}
    />,
  );
  const head = await screen.findByRole("heading", {
    name: "Your profile, 3 of 6 done",
  });
  expect(head.querySelector(".kit-profile__count").textContent).toBe(
    "3 of 6 done",
  );
  const next = document.querySelector(".kit-profile__next");
  expect(next.dataset.step).toBe("picture");
  const choose = screen.getAllByRole("link", { name: "Choose your picture" });
  expect(choose[0].getAttribute("href")).toBe("/settings/profile");
  const rows = [...document.querySelectorAll(".kit-profile__row")];
  expect(rows.map((r) => r.querySelector("h3").textContent)).toEqual([
    "Add your player Done.",
    "Verify it’s you Done.",
    "Pick your picture To do.",
    "Follow someone who plays To do.",
    "Choose your email Done.",
    "Your place on the clan map To do.",
  ]);
  expect(document.querySelector(".kit-profile").textContent).toContain(
    "The player you follow hasn’t played in the last 7 days.",
  );
  expect(screen.getByText("Your digest is off.")).toBeTruthy();
  // Only after the older welcome can it be put away.
  expect(
    screen.queryByRole("button", { name: "Hide your profile list" }),
  ).toBeNull();
});

test("the map's Not now finishes the step with the server's answer", async () => {
  owner = passport(["done", "done", "done", "done", "done", "todo"]);
  renderWithProviders(
    <HomePanels
      first={first({ following: 1, digest: { enabled: true } })}
      player={PLAYER}
      feed={null}
    />,
  );
  // The next step's Not now (the folded row has its own too).
  const [now] = await screen.findAllByRole("button", { name: "Not now" });
  expect(now.closest(".kit-profile__next")).toBeTruthy();
  fireEvent.click(now);
  await waitFor(() =>
    expect(writes).toEqual([["/api/me/passport/map", { choice: "not_now" }]]),
  );
  await screen.findByRole("heading", { name: "Your profile, 5 of 6 done" });
  expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
});

test("the map step sets the place on Home itself: no clan page, Cancel returns focus", async () => {
  owner = passport(["done", "done", "done", "done", "done", "todo"]);
  renderWithProviders(
    <HomePanels
      first={first({ following: 1, digest: { enabled: true } })}
      player={PLAYER}
      feed={null}
    />,
  );
  const next = await screen.findByRole("heading", {
    name: "Your place on the clan map",
  });
  const step = next.closest(".kit-profile__next");
  // A button that opens the picker here, never a link to a clan's map.
  expect(step.querySelector("a[href*='/clan']")).toBeNull();
  const open = within(step).getByRole("button", { name: "Set a place" });
  fireEvent.click(open);
  const country = await within(step).findByLabelText("Country");
  await waitFor(() => expect(document.activeElement).toBe(country));
  expect(within(step).getByText(/your clan’s verified members/)).toBeTruthy();
  // Escape is Cancel, and focus goes back to the button.
  fireEvent.keyDown(country, { key: "Escape" });
  await waitFor(() =>
    expect(document.activeElement?.textContent).toBe("Set a place"),
  );
  fireEvent.click(within(step).getByRole("button", { name: "Set a place" }));
  const again = await within(step).findByLabelText("Country");
  await waitFor(() =>
    expect(again.querySelectorAll("option").length).toBeGreaterThan(200),
  );
  fireEvent.change(again, { target: { value: "CA" } });
  const region = await within(step).findByLabelText("State or region");
  fireEvent.change(region, { target: { value: "08" } });
  fireEvent.click(within(step).getByRole("button", { name: "Add me" }));
  await waitFor(() =>
    expect(writes).toEqual([
      [
        "/api/clan/me/place",
        { country: "CA", region: "08", city: null, player_map: true },
      ],
    ]),
  );
  // The passport reads again: all six done.
  await screen.findByText("Your profile is done");
});

test("after the older welcome: only what is left, and Hide puts it away", async () => {
  owner = passport(["done", "done", "todo", "todo", "done", "todo"], {
    older_welcome_finished: true,
  });
  renderWithProviders(
    <HomePanels
      first={first({ following: 1, digest: { enabled: true } })}
      player={PLAYER}
      feed={null}
    />,
  );
  await screen.findByText(
    "You finished your welcome. Here’s what’s left for the All Set Stamp.",
  );
  expect(document.querySelectorAll(".kit-profile__row")).toHaveLength(3);
  fireEvent.click(
    screen.getByRole("button", { name: "Hide your profile list" }),
  );
  await waitFor(() =>
    expect(document.querySelector(".kit-profile")).toBeNull(),
  );
  expect(writes).toEqual([["/api/me/passport/dismiss", {}]]);
});

test("the clan card draws the race's place while a war day runs", async () => {
  renderWithProviders(
    <HomePanels
      first={first({ following: 2, digest: { enabled: true } })}
      player={PLAYER}
      feed={null}
    />,
  );
  const bar = await screen.findByRole("img", { name: "Second of five clans" });
  expect(bar.className).toContain("kit-racebar--p2");
});
