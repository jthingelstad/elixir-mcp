import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { api } from "../src/api.js";
import { useSelectClan } from "../src/lib/select.js";
import { Rail } from "../src/App.jsx";

/**
 * One clan selection at a time. Codex on #610, 2026-10-20: "When a clan
 * selection is still awaiting `api.select()` or navigation, the switcher
 * remains enabled and can be reopened to start another selection. If
 * the two requests resolve out of order, each callback updates `me` and
 * navigates, so the earlier click can overwrite the later choice and
 * leave the user in the wrong clan."
 */
vi.mock("../src/api.js", () => ({ api: { select: vi.fn() } }));

afterEach(cleanup);

const clan = (clan_tag, name, role = "member") => ({
  clan_tag,
  name,
  role,
  role_label: role === "leader" ? "Leader" : "Member",
  acting_as: "#20QQL8CCRU",
  acting_as_name: "Ada",
  verified: true,
});
const EXAMPLE = clan("#2PQRJ8LV", "Example Clan", "leader");
const SECOND = clan("#GQ08RJPL", "Second Clan");
const THIRD = clan("#9QJ0YJPU", "Third Clan");
const me = (selected = EXAMPLE) => ({
  ok: true,
  signed_in: true,
  clans: [EXAMPLE, SECOND, THIRD],
  selected,
  open_actions: 0,
});
const byTag = { [SECOND.clan_tag]: SECOND, [THIRD.clan_tag]: THIRD };

/** api.select held per tag until the test lets it answer. */
let answer;
beforeEach(() => {
  answer = {};
  vi.mocked(api.select).mockReset();
  vi.mocked(api.select).mockImplementation(
    (tag) =>
      new Promise((resolve) => {
        answer[tag] = () => resolve({ ok: true, data: me(byTag[tag]) });
      }),
  );
});

describe("selecting a clan", () => {
  test("a second selection while the first is pending is ignored, so the first can never land over it", async () => {
    const navigate = vi.fn(async () => {});
    const setMe = vi.fn();
    const { result } = renderHook(() => useSelectClan({ navigate, setMe }));

    let first;
    act(() => {
      first = result.current.select(SECOND.clan_tag);
    });
    expect(result.current.selecting).toBe(true);
    let second;
    act(() => {
      second = result.current.select(THIRD.clan_tag);
    });
    // The second never starts, so nothing can answer out of order.
    expect(api.select).toHaveBeenCalledTimes(1);
    expect(api.select).toHaveBeenCalledWith(SECOND.clan_tag);
    expect(answer[THIRD.clan_tag]).toBeUndefined();
    await act(() => second);
    expect(setMe).not.toHaveBeenCalled();

    await act(async () => {
      answer[SECOND.clan_tag]();
      await first;
    });
    expect(setMe.mock.calls).toEqual([[me(SECOND)]]);
    expect(navigate.mock.calls).toEqual([["/clan/GQ08RJPL"]]);
    expect(result.current.selecting).toBe(false);

    // Once it lands, the next selection runs.
    let third;
    act(() => {
      third = result.current.select(THIRD.clan_tag);
    });
    await act(async () => {
      answer[THIRD.clan_tag]();
      await third;
    });
    expect(navigate.mock.calls.at(-1)).toEqual(["/clan/9QJ0YJPU"]);
  });

  test("the Clan picker is busy while a pick is pending: the list closes and will not open again until it lands", async () => {
    const navigate = vi.fn(async () => {});
    function Shell() {
      const { select, selecting } = useSelectClan({
        navigate,
        setMe: vi.fn(),
      });
      return (
        <Rail
          me={me()}
          path="/clan/2PQRJ8LV/roster"
          navigate={navigate}
          narrow={false}
          select={select}
          selecting={selecting}
        />
      );
    }
    renderWithProviders(<Shell />);
    const head = () => screen.getByRole("button", { name: /Example Clan/ });
    const list = () => document.getElementById("rail-clans");

    fireEvent.click(head());
    fireEvent.click(screen.getByRole("link", { name: /Second Clan/ }));
    expect(api.select).toHaveBeenCalledTimes(1);
    expect(head().textContent).toContain("Opening Second Clan…");
    expect(head().closest(".rail__switch").getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(head().getAttribute("aria-disabled")).toBe("true");

    // Reopening does nothing while the first pick is pending.
    fireEvent.click(head());
    expect(list()).toBeNull();
    expect(head().getAttribute("aria-expanded")).toBe("false");
    expect(api.select).toHaveBeenCalledTimes(1);

    await act(async () => answer[SECOND.clan_tag]());
    await waitFor(() =>
      expect(head().closest(".rail__switch").getAttribute("aria-busy")).toBe(
        null,
      ),
    );
    expect(navigate.mock.calls).toEqual([["/clan/GQ08RJPL"]]);
    expect(head().getAttribute("aria-disabled")).toBe(null);
    fireEvent.click(head());
    expect(list()).not.toBeNull();
  });
});
