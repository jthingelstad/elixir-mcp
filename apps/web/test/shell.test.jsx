import { expect, test } from "vitest";
import { barAccount } from "../src/shell/Shell.jsx";

const keys = (me) => barAccount(me, () => {}).links.map((l) => l.key);

test("the avatar menu: Play Drop always, Admin only for staff", () => {
  expect(keys({ claims: [] })).toContain("drop");
  expect(keys({ claims: [] })).not.toContain("admin");
  expect(keys({ claims: [], is_admin: true })).toContain("admin");
});

test("the menu's players are your own: a friend or a watch is not one", () => {
  const account = barAccount(
    {
      claims: [
        { player_tag: "#A", name: "Ada", is_primary: true },
        { player_tag: "#B", name: "Alt", relationship: "alt" },
        { player_tag: "#C", name: "Friend", relationship: "friend" },
        { player_tag: "#D", name: "Watch", relationship: "watching" },
      ],
    },
    () => {},
  );
  expect(account.name).toBe("Ada");
  expect(account.players.map((p) => [p.key, p.note])).toEqual([
    ["#A", "Your main player"],
    ["#B", "Also you"],
  ]);
  expect(account.links.map((l) => l.key)).not.toContain("add");
});

test("no player: the menu offers to add one", () => {
  expect(keys({ claims: [] })).toContain("add");
  expect(barAccount({ claims: [] }, () => {}).name).toBe("Your account");
});
