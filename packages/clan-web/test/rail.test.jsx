import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { railItems } from "../src/lib/rail.js";
import { Rail } from "../src/App.jsx";

afterEach(cleanup);

const TAG = "#2PQRJ8LV";
const me = (role, { policy = true, ...extra } = {}) => ({
  ok: true,
  signed_in: true,
  selected: {
    clan_tag: TAG,
    name: "Example Clan",
    role,
    verified: true,
  },
  clans: [{ clan_tag: TAG }],
  policy: policy ? { set: true, active: true } : { set: false },
  ...extra,
});

/** The heading each item is drawn under, read in document order the
 *  way a reader meets them. */
function headings() {
  const under = {};
  let heading = null;
  for (const el of document.querySelectorAll(".rail__group, .rail__item"))
    if (el.classList.contains("rail__group")) heading = el.textContent;
    else under[el.getAttribute("href")] = heading;
  return under;
}
const hrefOf = (m, key) => railItems(m).find((r) => r.key === key).to;
const render = (m) =>
  renderWithProviders(
    <Rail
      me={m}
      path={`/clan/${TAG.slice(1)}`}
      navigate={vi.fn()}
      narrow={false}
    />,
  );

describe("Scout is under Manage, for every role that has it", () => {
  // An elder in a clan with a policy once found Scout under Social: the
  // heading was the group of whichever item came first.
  const CASES = [
    ["elder", true],
    ["elder", false],
    ["leader", true],
    ["leader", false],
  ];
  for (const [role, policy] of CASES)
    test(`${role}, ${policy ? "with" : "without"} an active policy`, () => {
      const m = me(role, { policy });
      const items = railItems(m);
      expect(items.find((r) => r.key === "scout").group).toBe("Manage");
      // Every Social and Manage item names its own group.
      for (const r of items)
        if (["map", "recruit", "discord"].includes(r.key))
          expect(r.group).toBe("Social");
        else if (
          ["board", "history", "policy", "settings", "scout"].includes(r.key)
        )
          expect(r.group).toBe("Manage");
      render(m);
      const under = headings();
      expect(under[hrefOf(m, "scout")]).toBe("Manage");
      expect(under[hrefOf(m, "recruit")]).toBe("Social");
      expect(under[hrefOf(m, "clan")]).toBeNull();
      // One heading per group, never twice.
      const drawn = [...document.querySelectorAll(".rail__group")].map(
        (g) => g.textContent,
      );
      expect(new Set(drawn).size).toBe(drawn.length);
      expect(drawn.filter((h) => h === "Manage")).toHaveLength(1);
    });
});

describe("Actions waiting are attention", () => {
  test("a count of Actions waiting marks the folded rail; none marks nothing", () => {
    const items = railItems(me("leader", { open_actions: 2 }));
    expect(items.find((r) => r.key === "actions")).toMatchObject({
      meta: "2",
      attention: "2 waiting for you",
    });
    const none = railItems(me("leader", { open_actions: 0 }));
    expect(none.find((r) => r.key === "actions").attention).toBeUndefined();
    // No policy, no Actions, nothing waiting.
    expect(
      railItems(me("leader", { policy: false, open_actions: 2 })).some(
        (r) => r.attention,
      ),
    ).toBe(false);
  });

  test("narrow and folded, the row carries the mark; on the Actions page it does not", () => {
    const m = me("member", { open_actions: 3 });
    const { rerender } = renderWithProviders(
      <Rail me={m} path={`/clan/${TAG.slice(1)}`} navigate={vi.fn()} narrow />,
    );
    expect(
      screen.getByRole("img", { name: "Actions: 3 waiting for you" }),
    ).toBeTruthy();
    rerender(
      <Rail
        me={m}
        path={`/clan/${TAG.slice(1)}/actions`}
        navigate={vi.fn()}
        narrow
      />,
    );
    expect(screen.queryByRole("img", { name: /waiting for you/ })).toBeNull();
    // Opened, the list carries the count on the item and no row mark.
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.queryByRole("img", { name: /waiting for you/ })).toBeNull();
  });
});
