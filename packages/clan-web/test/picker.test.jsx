import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { ClanPicker } from "../src/components/ClanPicker.jsx";

/**
 * The Clan picker after the 2026-11-05 ruling: a plain select beside the
 * clan's name, only with two or more clans.
 */
afterEach(cleanup);

const EXAMPLE = {
  clan_tag: "#0QC8RCGY",
  name: "Example Clan",
  role: "leader",
  role_label: "Leader",
  verified: true,
};
const SECOND = {
  clan_tag: "#0JR0LRU0",
  name: "Second Clan",
  role: "member",
  role_label: "Member",
  verified: false,
};
const me = (extra = {}) => ({
  clans: [EXAMPLE, SECOND],
  selected: EXAMPLE,
  ...extra,
});
const draw = (m, props = {}) =>
  renderWithProviders(
    <ClanPicker
      me={m}
      navigate={props.navigate ?? vi.fn()}
      select={props.select ?? vi.fn()}
      selecting={props.selecting ?? false}
    />,
  );
const box = () => screen.getByLabelText("Clan");

describe("the Clan picker", () => {
  test("one clan: nothing to pick", () => {
    draw(me({ clans: [EXAMPLE] }));
    expect(screen.queryByLabelText("Clan")).toBeNull();
  });

  test("two clans: each with your role, and the chooser last", () => {
    draw(me());
    const options = within(box()).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Example Clan, Leader",
      "Second Clan, Member, unverified",
      "All your clans…",
    ]);
    expect(box().value).toBe("#0QC8RCGY");
  });

  test("picking another clan remembers it; picking this one does nothing", () => {
    const select = vi.fn(() => Promise.resolve());
    draw(me(), { select });
    fireEvent.change(box(), { target: { value: "#0JR0LRU0" } });
    expect(select).toHaveBeenCalledWith("#0JR0LRU0");
  });

  test("the chooser is an address, and remembers nothing", () => {
    const navigate = vi.fn();
    const select = vi.fn();
    draw(me(), { navigate, select });
    fireEvent.change(box(), { target: { value: "__all__" } });
    expect(navigate).toHaveBeenCalledWith("/clan/clans");
    expect(select).not.toHaveBeenCalled();
  });

  test("busy while a selection is pending", () => {
    draw(me(), { selecting: true });
    expect(box().disabled).toBe(true);
  });
});
