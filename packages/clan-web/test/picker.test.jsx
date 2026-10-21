import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { railItems } from "../src/lib/rail.js";
import { Rail } from "../src/App.jsx";

/**
 * The Clan picker. Jamie, 2026-10-20: "the "Clans" picker in the left
 * rail should go away and it should be a "Clan Picker" that is at the
 * top of the rail similar to what Console has for switching accounts
 * and Ladder has for switching players."
 */
afterEach(cleanup);

const EXAMPLE = {
  clan_tag: "#2PQRJ8LV",
  name: "Example Clan",
  role: "leader",
  role_label: "Leader",
  acting_as: "#20QQL8CCRU",
  acting_as_name: "Ada",
  verified: true,
};
const SECOND = {
  clan_tag: "#GQ08RJPL",
  name: "Second Clan",
  role: "member",
  role_label: "Member",
  acting_as: "#VLQV8C8RP",
  acting_as_name: "Ada's alt",
  verified: true,
};
const me = (extra = {}) => ({
  ok: true,
  signed_in: true,
  clans: [EXAMPLE, SECOND],
  selected: EXAMPLE,
  open_actions: 2,
  policy: { set: true, active: true },
  ...extra,
});

const draw = (m, props = {}) =>
  renderWithProviders(
    <Rail
      me={m}
      path="/clan/2PQRJ8LV/roster"
      navigate={props.navigate ?? vi.fn()}
      narrow={false}
      select={props.select ?? vi.fn()}
      selecting={false}
      {...props}
    />,
  );

const head = () => screen.getByRole("button", { name: /Example Clan/ });

describe("the Clan picker at the head of the rail", () => {
  test("the face: the clan, its tag, your role; open, your clans and the chooser", () => {
    draw(me());
    const face = head();
    expect(face.getAttribute("title")).toBe("Example Clan: switch clan");
    expect(face.querySelector(".mono")?.textContent).toBe("#2PQRJ8LV");
    expect(within(face).getByText("Leader").className).toContain("chip");
    expect(within(face).queryByText("unverified")).toBeNull();
    fireEvent.click(face);
    const list = document.getElementById("rail-clans");
    const entries = [...list.querySelectorAll("a.rail__switch-item")];
    expect(entries.map((a) => a.textContent)).toEqual([
      expect.stringMatching(/Example Clan.*#2PQRJ8LV.*Ada.*Leader/),
      expect.stringMatching(/Second Clan.*#GQ08RJPL.*Ada's alt.*Member/),
      "All your clans…",
    ]);
    expect(entries[0].getAttribute("aria-current")).toBe("true");
    // Real addresses, each the clan's landing: Actions for the leader
    // with two waiting; the other clan's own address, which decides.
    expect(entries.map((a) => a.getAttribute("href"))).toEqual([
      "/clan/2PQRJ8LV/actions",
      "/clan/GQ08RJPL",
      "/clan/clans",
    ]);
  });

  test("picking another clan remembers it first, as the chooser does; the current one just goes", () => {
    const navigate = vi.fn();
    const select = vi.fn(() => Promise.resolve());
    draw(me(), { navigate, select });
    fireEvent.click(head());
    fireEvent.click(screen.getByRole("link", { name: /Second Clan/ }));
    expect(select).toHaveBeenCalledWith("#GQ08RJPL");
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(head());
    fireEvent.click(screen.getByRole("link", { name: /Example Clan/ }));
    expect(select).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/clan/2PQRJ8LV/actions");
    fireEvent.click(head());
    fireEvent.click(screen.getByRole("link", { name: "All your clans…" }));
    expect(navigate).toHaveBeenLastCalledWith("/clan/clans");
  });

  test("while a pick is being remembered, the face says which clan is opening", () => {
    let done;
    const select = vi.fn(() => new Promise((r) => (done = r)));
    const m = me();
    const { rerender } = draw(m, { select });
    fireEvent.click(head());
    fireEvent.click(screen.getByRole("link", { name: /Second Clan/ }));
    rerender(
      <Rail
        me={m}
        path="/clan/2PQRJ8LV/roster"
        navigate={vi.fn()}
        narrow={false}
        select={select}
        selecting
      />,
    );
    expect(head().textContent).toContain("Opening Second Clan…");
    done();
  });

  test("an unverified player's clan says so on the face", () => {
    const unverified = { ...EXAMPLE, verified: false };
    draw(me({ clans: [unverified, SECOND], selected: unverified }));
    expect(within(head()).getByText("unverified").className).toContain(
      "chip--warn",
    );
  });

  test("one clan: the same tile with nothing to open", () => {
    draw(me({ clans: [EXAMPLE] }));
    expect(screen.queryByRole("button", { name: /Example Clan/ })).toBeNull();
    const tile = document.querySelector("div.rail__switch-head");
    expect(tile.textContent).toContain("Example Clan");
    expect(tile.textContent).toContain("#2PQRJ8LV");
  });

  test("no Clans item and no identity block; your players stay in the rail", () => {
    draw(me());
    expect(railItems(me()).some((r) => r.key === "clans")).toBe(false);
    expect(screen.queryByRole("link", { name: /^Clans$/ })).toBeNull();
    expect(document.querySelector(".rail__identity")).toBeNull();
    expect(
      screen.getByRole("link", { name: /^Players/ }).getAttribute("href"),
    ).toBe("/clan/you");
  });

  test("the chooser and no clan selected keep the plain head", () => {
    const { rerender } = draw(me(), { path: "/clan/clans" });
    expect(document.querySelector(".rail__switch")).toBeNull();
    expect(screen.getByText("Example Clan")).toBeTruthy();
    expect(screen.getByText("#2PQRJ8LV")).toBeTruthy();
    rerender(
      <Rail
        me={me({ selected: null })}
        path="/clan/you"
        navigate={vi.fn()}
        narrow={false}
        select={vi.fn()}
        selecting={false}
      />,
    );
    expect(document.querySelector(".rail__switch")).toBeNull();
    expect(screen.getByText("Elixir Clan")).toBeTruthy();
  });

  test("narrow: the picker stays beside the folded row, which no longer repeats the clan", () => {
    draw(me(), { narrow: true });
    expect(screen.queryByRole("navigation")).toBeNull();
    const face = head();
    const toggle = document.querySelector(".rail__toggle");
    expect(face.closest(".rail__switch--head").nextElementSibling).toBe(toggle);
    expect(toggle.textContent).toContain("Roster");
    expect(toggle.textContent).not.toContain("Example Clan");
    fireEvent.click(face);
    expect(screen.getByRole("link", { name: /Second Clan/ })).toBeTruthy();
  });
});
