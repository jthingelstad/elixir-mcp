import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Directory } from "../src/views/Directory.jsx";
import {
  NO_FILTERS,
  crestOf,
  fits,
  tileHref,
  visible,
} from "../src/lib/directory.js";
import { isClanSegment, tagOf } from "../src/lib/base.js";
import { Refused } from "../src/views/Refused.jsx";
import { Clans } from "../src/views/Clans.jsx";

afterEach(cleanup);

// Invented clans. The order is the server's: by name, then tag.
const tile = (over = {}) => ({
  clan_tag: "#2PQRJ8LV",
  name: "Alpha Example",
  type: "open",
  description: "Friendly, war on weekends.",
  members: 41,
  required_trophies: 5000,
  yours: false,
  ...over,
  policy: {
    war_intent: "participating",
    posture: "standard",
    together: false,
    counted: ["war", "donations"],
    removal_day: 14,
    saved_at: "2026-11-01T00:00:00.000Z",
    ...over.policy,
  },
});
const CLANS = [
  tile(),
  tile({
    clan_tag: "#PYLQ2",
    name: "Beta Example",
    members: 50,
    required_trophies: 3000,
    description: null,
    policy: {
      war_intent: "not_participating",
      posture: "relaxed",
      together: true,
      counted: [],
      removal_day: null,
    },
  }),
  tile({
    clan_tag: "#8QCV",
    name: "gamma Example",
    type: "inviteOnly",
    description: "Every week counts.",
    members: null,
    required_trophies: null,
    yours: true,
    policy: { posture: "strict", removal_day: 30, war_intent: "unknown" },
  }),
];
const tags = (list) => list.map((c) => c.clan_tag);
const f = (over) => ({ ...NO_FILTERS, ...over });

describe("the filters", () => {
  test("no filter keeps every clan, in the server's order", () => {
    expect(tags(visible(CLANS, NO_FILTERS))).toEqual([
      "#2PQRJ8LV",
      "#PYLQ2",
      "#8QCV",
    ]);
  });
  test("search reads name, tag and description, any case", () => {
    expect(tags(visible(CLANS, f({ q: "BETA" })))).toEqual(["#PYLQ2"]);
    expect(tags(visible(CLANS, f({ q: "#8qcv" })))).toEqual(["#8QCV"]);
    expect(tags(visible(CLANS, f({ q: "weekends" })))).toEqual(["#2PQRJ8LV"]);
  });
  test("Clan Wars and how strict are the policy's own words", () => {
    expect(tags(visible(CLANS, f({ war: "participating" })))).toEqual([
      "#2PQRJ8LV",
    ]);
    // Not said is neither yes nor no.
    expect(tags(visible(CLANS, f({ war: "not_participating" })))).toEqual([
      "#PYLQ2",
    ]);
    expect(tags(visible(CLANS, f({ posture: "strict" })))).toEqual(["#8QCV"]);
  });
  test("removal: no rule, or a day at least that far", () => {
    expect(tags(visible(CLANS, f({ removal: "none" })))).toEqual(["#PYLQ2"]);
    expect(tags(visible(CLANS, f({ removal: "14" })))).toEqual([
      "#2PQRJ8LV",
      "#8QCV",
    ]);
    expect(tags(visible(CLANS, f({ removal: "30" })))).toEqual(["#8QCV"]);
  });
  test("room needs a recorded size under fifty", () => {
    expect(tags(visible(CLANS, f({ room: "room" })))).toEqual(["#2PQRJ8LV"]);
  });
  test("your trophies keep the clans you can join; unknown is not a yes", () => {
    expect(tags(visible(CLANS, f({ trophies: "4000" })))).toEqual(["#PYLQ2"]);
    expect(tags(visible(CLANS, f({ trophies: "9000" })))).toEqual([
      "#2PQRJ8LV",
      "#PYLQ2",
    ]);
    // A field that says nothing filters nothing.
    expect(fits(CLANS[2], f({ trophies: "" }))).toBe(true);
  });
});

describe("a tile", () => {
  test("your clan opens in Clan; any other has no page, so no link", () => {
    expect(tileHref(CLANS[2])).toBe("/clan/8QCV");
    expect(tileHref(CLANS[0])).toBe(null);
  });
  test("the crest is the name's letters, else the tag's", () => {
    expect(crestOf(CLANS[0])).toBe("AE");
    expect(crestOf({ clan_tag: "#PYLQ2", name: null })).toBe("PY");
  });
  test("directory is the app's page, never a clan tag", () => {
    expect(isClanSegment("directory")).toBe(false);
    expect(tagOf("directory")).toBe(null);
  });
});

describe("the page", () => {
  const ready = { data: { clans: CLANS, truncated: false } };
  test("tiles in order, each saying its facts, and no ranking", () => {
    render(<Directory state={ready} />);
    const names = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(names).toEqual(["Alpha Example", "Beta Example", "gamma Example"]);
    expect(screen.getByText("3 listed clans, by name")).toBeTruthy();
    expect(screen.getByText(/Nothing here is a rating/)).toBeTruthy();
    expect(screen.getByText("41 of 50")).toBeTruthy();
    expect(screen.getByText("Open, 5,000 trophies")).toBeTruthy();
    expect(screen.getAllByText("Clan Wars, Donations")).toHaveLength(2);
    expect(
      screen.getByText("A removal comes after 14 days with no battle"),
    ).toBeTruthy();
    expect(
      screen.getByText("No removal rule", { selector: "dd" }),
    ).toBeTruthy();
    expect(screen.getByText("Clan Wars not said")).toBeTruthy();
    // gamma's size is not recorded; its type is, and its trophies are not.
    expect(screen.getAllByText("Not recorded")).toHaveLength(1);
    expect(screen.getByText("Invite only", { selector: "dd" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "gamma Example" }).getAttribute("href"),
    ).toBe("/clan/8QCV");
  });
  test("a filter counts what fits, and an empty fit clears", () => {
    render(<Directory state={ready} />);
    const strict = screen.getByRole("group", { name: "How strict" });
    fireEvent.click(strict.querySelector("button:last-child"));
    expect(screen.getByText(/^1 of 3 listed clans fit/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "beta" },
    });
    expect(screen.getByText("No clan fits all of that")).toBeTruthy();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Clear the filters" })[0],
    );
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(3);
  });
  test("a clan's address opens it searched for, and its name links nowhere", () => {
    render(<Directory state={ready} query="PYLQ2" />);
    expect(screen.getByLabelText("Search").value).toBe("PYLQ2");
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Beta Example"]);
    expect(screen.queryByRole("link", { name: "Beta Example" })).toBe(null);
  });
  test("the trophies field keeps digits only", () => {
    render(<Directory state={ready} />);
    const box = screen.getByLabelText("Your trophies");
    fireEvent.change(box, { target: { value: "4,000" } });
    expect(box.value).toBe("4000");
    expect(screen.getByText(/^1 of 3 listed clans fit/)).toBeTruthy();
  });
  test("no clan yet, a failed read, and the bound are each said", () => {
    const { rerender } = render(
      <Directory state={{ data: { clans: [], truncated: false } }} />,
    );
    expect(screen.getByText("No clan has saved its rules yet")).toBeTruthy();
    rerender(<Directory state={{ error: "failed" }} onRetry={() => {}} />);
    expect(screen.getByRole("alert").textContent).toMatch(/did not load/);
    rerender(<Directory state={{ data: { clans: CLANS, truncated: true } }} />);
    expect(screen.getByText(/first 3 clans by name/)).toBeTruthy();
  });
  test("a refused or signed-out read is said, never left loading", () => {
    const onSignedOut = vi.fn();
    const { rerender } = render(
      <Directory
        state={{ forbidden: "not_a_person" }}
        onSignedOut={onSignedOut}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/approved account/);
    expect(screen.queryByText(/Reading the directory/)).toBeNull();
    expect(onSignedOut).not.toHaveBeenCalled();
    rerender(
      <Directory state={{ signedOut: true }} onSignedOut={onSignedOut} />,
    );
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Reading the directory/)).toBeNull();
  });
});

describe("the doors to it", () => {
  test("someone with no clan is pointed at the directory", () => {
    render(<Refused reason="no_clan" me={{ signed_in: true }} />);
    expect(
      screen.getByRole("link", { name: "Clan directory" }).getAttribute("href"),
    ).toBe("/clan/directory");
  });
  test("the chooser carries it beside your clans", () => {
    render(<Clans me={{ clans: [], identities: [] }} onSelect={() => {}} />);
    expect(
      screen.getByRole("link", { name: "Clan directory" }).getAttribute("href"),
    ).toBe("/clan/directory");
  });
});
