import { afterEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { renderWithProviders } from "./helpers.jsx";
import { Run } from "../../src/clan/views/Run.jsx";
import { keys } from "../../src/clan/lib/queries.js";
import { api, manageApi } from "../../src/clan/api.js";
import {
  FIELDS,
  GROUPS,
  TABS,
  defaults,
  policyCapabilities,
  policyFromGoals,
} from "@elixir-mcp/clan-engine";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual()),
  useBlocker: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ok = (data) => ({ ok: true, status: 200, data });
const clan = { clan_tag: "#0QC8RCGY", name: "Example Clan", role: "leader" };
const view = {
  can_edit: true,
  set: false,
  members: 24,
  min_members: 10,
  big_enough: true,
  current: { set: false, values: defaults(), version: 0 },
  tabs: TABS,
  groups: GROUPS,
  fields: FIELDS,
  versions: [],
};
const roster = {
  name: "Example Clan",
  member_count: 47,
  role_counts: { leader: 1, coLeader: 2, elder: 15, member: 29 },
  type: "inviteOnly",
  required_trophies: 5000,
  description: "Friendly and active.",
  members: [],
};

/** Run, walking its sections as the router would. */
function Walk({ first }) {
  const [section, setSection] = useState(first);
  return (
    <Run
      clan={clan}
      section={section}
      navigate={(to) => setSection(to.split("/run/")[1] ?? null)}
    />
  );
}
const question = (key) => document.getElementById(`rules-${key}`);
const bar = () => screen.getByRole("region", { name: "Save rules" });
const saveButton = () =>
  within(bar()).getByRole("button", { name: "Save rules" });
const sw = (name) => screen.getByRole("switch", { name });
const number = (name) => screen.getByRole("spinbutton", { name });
const pick = (name) => screen.getByRole("button", { name });
const render = async (data = view) => {
  vi.spyOn(manageApi, "policy").mockResolvedValue(ok(data));
  vi.spyOn(api, "roster").mockResolvedValue(ok(roster));
  const rendered = renderWithProviders(<Walk first="rules" />);
  await screen.findByRole("heading", { name: /What is your clan about/ });
  return rendered;
};

describe("Rules: six questions under Run", () => {
  test("one Run item holds the rules, as six numbered questions", async () => {
    await render();
    const nav = screen.getByRole("navigation", { name: "Run" });
    const link = within(nav)
      .getAllByRole("link")
      .find((a) => a.textContent.startsWith("Rules"));
    expect(link.getAttribute("href")).toBe("/clan/0QC8RCGY/run/rules");
    expect(link.textContent).toMatch(/not set$/);
    for (const name of ["About", "Clan Wars", "Elder", "Inactivity"])
      expect(
        within(nav)
          .getAllByRole("link")
          .some((a) => a.textContent.startsWith(name)),
      ).toBe(false);
    const titles = [...document.querySelectorAll(".rules-q__head")].map(
      (h) => h.textContent,
    );
    expect(titles).toEqual([
      "1What is your clan about?",
      "2What should members do each week?",
      "3Who becomes Elder?",
      "4When do quiet members get kicked?",
      "5Welcomes and goodbyes",
      "6What does the clan see?",
    ]);
    expect(screen.getByRole("heading", { name: "Quick start" })).toBeTruthy();
  });

  test("each weekly goal is drawn once, with every category on", async () => {
    await render();
    for (const name of [
      "War decks",
      "Ranked battles",
      "Cards donated",
      "Trophies",
    ]) {
      if (sw(name).getAttribute("aria-checked") !== "true")
        fireEvent.click(sw(name));
      expect(
        screen.getAllByRole("spinbutton", { name: `${name} goal` }).length,
      ).toBe(1);
    }
  });

  test("war intent starts Not saying, survives a quick start and is saved with the rest", async () => {
    const save = vi
      .spyOn(manageApi, "savePolicy")
      .mockResolvedValue(ok({ version: 1 }));
    await render();
    expect(pick("Not saying").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(pick("We don't war"));
    fireEvent.click(screen.getByRole("button", { name: /^A war clan/ }));
    expect(pick("We don't war").getAttribute("aria-pressed")).toBe("true");
    expect(sw("War decks").getAttribute("aria-checked")).toBe("true");
    expect(number("War decks goal").value).toBe("24");
    expect(screen.getByText(/A war clan filled every question/)).toBeTruthy();
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalled());
    const [, values] = save.mock.calls[0];
    expect(values.war_intent).toBe("not_participating");
    expect(values.war_enabled).toBe(true);
    expect(values.donations_enabled).toBe(true);
    expect(values.removal_enabled).toBe(true);
    expect("goal_war" in values).toBe(false);
  });

  test("the clan list card is drawn from the draft, public part only", async () => {
    await render();
    const card = screen
      .getByRole("heading", { name: "What players see in the clan list" })
      .closest("section");
    expect(within(card).getByText("Clan Wars not said")).toBeTruthy();
    expect(await within(card).findByText("Friendly and active.")).toBeTruthy();
    expect(within(card).getByText("47 of 50")).toBeTruthy();
    fireEvent.click(pick("We war every week"));
    fireEvent.click(pick(/^Hardcore/));
    expect(within(card).getByText("Plays Clan Wars")).toBeTruthy();
    expect(within(card).getByText("Hardcore")).toBeTruthy();
    fireEvent.click(sw("Suggest kicking quiet members"));
    expect(card.textContent).toMatch(/A removal comes after \d+ days/);
    // Never a minimum, a note or who saved it.
    expect(card.textContent).not.toMatch(/war decks/i);
  });

  test("turning a measure on fills its goal from how serious the clan is; off hides it", async () => {
    await render();
    expect(
      screen.queryByRole("spinbutton", { name: "Cards donated goal" }),
    ).toBeNull();
    fireEvent.click(sw("Cards donated"));
    expect(number("Cards donated goal").value).toBe("40");
    fireEvent.click(
      screen.getByRole("button", { name: "More cards donated goal" }),
    );
    expect(number("Cards donated goal").value).toBe("50");
    fireEvent.click(sw("Cards donated"));
    expect(
      screen.queryByRole("spinbutton", { name: "Cards donated goal" }),
    ).toBeNull();
  });

  test("a social clan picks Elders by hand and counts nothing", async () => {
    await render();
    fireEvent.click(screen.getByRole("button", { name: /^A social clan/ }));
    expect(sw("We like to play together").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(pick(/^We pick by hand/).getAttribute("aria-pressed")).toBe("true");
    expect(sw("War decks").getAttribute("aria-checked")).toBe("false");
  });

  test("Elder seats are counted from the roster, and the Rules check fixes a full band in one tap", async () => {
    await render({
      ...view,
      set: true,
      current: {
        set: true,
        version: 3,
        values: policyFromGoals(["war", "donations"], "standard"),
      },
    });
    const elder = question("elder");
    await waitFor(() =>
      expect(elder.textContent).toMatch(
        /Room for 14 Elders\. You have 15, so the seats are full\./,
      ),
    );
    const check = screen
      .getByRole("heading", { name: "Rules check" })
      .closest("section");
    expect(check.textContent).toMatch(/room for 14 and you have 15/);
    fireEvent.click(
      within(check).getByRole("button", { name: "Make room for 16 (33%)" }),
    );
    expect(number("Elder seats").value).toBe("33");
    expect(elder.textContent).toMatch(
      /Room for 16 Elders\. You have 15, so 1 seat is open\./,
    );
    expect(check.textContent).toMatch(/Everything works/);
  });

  test("a measure that counts for nothing is named, and its fix turns it off", async () => {
    const values = {
      ...policyFromGoals(["war"], "standard"),
      band_ceiling_share: 0.5,
      trophies_enabled: true,
      trophies_min: 0,
      elder_weight_trophies: 0,
    };
    await render({
      ...view,
      set: true,
      current: { set: true, version: 3, values },
    });
    const check = screen
      .getByRole("heading", { name: "Rules check" })
      .closest("section");
    expect(check.textContent).toMatch(/Trophies are on but do nothing/);
    fireEvent.click(
      within(check).getByRole("button", { name: "Turn trophies off" }),
    );
    expect(sw("Trophies").getAttribute("aria-checked")).toBe("false");
    expect(check.textContent).toMatch(/Everything works/);
  });

  test("one Elder share moves the others, and the split bar says so", async () => {
    await render({
      ...view,
      set: true,
      current: {
        set: true,
        version: 3,
        values: {
          ...policyFromGoals(["war", "donations"], "standard"),
          band_ceiling_share: 0.5,
        },
      },
    });
    fireEvent.change(number("War decks share"), { target: { value: "40" } });
    expect(number("Cards donated share").value).toBe("60");
    expect(
      screen.getByRole("img", {
        name: "What makes a best player?: War decks 40%, Cards donated 60%",
      }),
    ).toBeTruthy();
  });

  test("an invalid answer is shown once, at its question, and the check points there", async () => {
    await render({
      ...view,
      set: true,
      current: {
        set: true,
        version: 2,
        values: { ...defaults(), removal_enabled: true },
      },
    });
    fireEvent.change(number("Warning after"), { target: { value: "2" } });
    const quiet = question("quiet");
    expect(quiet.dataset.wrong).toBe("true");
    expect(within(quiet).getAllByRole("alert")).toHaveLength(1);
    const check = screen
      .getByRole("heading", { name: "Rules check" })
      .closest("section");
    expect(
      within(check).getByRole("button", { name: "Go to question 4" }),
    ).toBeTruthy();
  });

  test("a refused save marks its question and takes the leader there", async () => {
    vi.spyOn(manageApi, "savePolicy").mockResolvedValue({
      ok: false,
      status: 400,
      data: {
        error: "invalid_policy",
        errors: { at_risk_days: "At risk cannot come before getting quiet." },
      },
    });
    await render();
    const scroll = vi.fn();
    fireEvent.click(screen.getByRole("button", { name: /^A war clan/ }));
    question("quiet").scrollIntoView = scroll;
    fireEvent.click(saveButton());
    expect(
      await within(question("quiet")).findByText(
        "At risk cannot come before getting quiet.",
      ),
    ).toBeTruthy();
    expect(scroll).toHaveBeenCalled();
    expect(bar().textContent).toMatch(/Fix the answers marked in red/);
  });

  test("the save bar counts the changes, lists them on tap, and Undo all puts them back", async () => {
    const values = {
      ...defaults(),
      removal_enabled: true,
      at_risk_days: 7,
      confirm_days: 10,
    };
    await render({
      ...view,
      set: true,
      current: { set: true, values, version: 2 },
      versions: [
        { version: 1, saved_at: "2026-10-01T12:00:00Z", note: "First" },
        { version: 2, saved_at: "2026-11-01T12:00:00Z", note: null },
      ],
    });
    expect(bar().textContent).toMatch(/No changes/);
    fireEvent.change(number("Warning after"), { target: { value: "6" } });
    const step = number("Warning after").closest("li");
    expect(step.textContent).toMatch(/Was 7/);
    const count = within(bar()).getByRole("button", {
      name: "You changed 1 thing.",
    });
    expect(count.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(count);
    expect(bar().textContent).toMatch(/Warning after: 7 to 6/);
    fireEvent.click(within(bar()).getByRole("button", { name: "Undo all" }));
    expect(number("Warning after").value).toBe("7");
    expect(bar().textContent).toMatch(/No changes/);
    const rows = [...document.querySelectorAll(".clan-versions__row")];
    expect(rows.map((r) => r.textContent.slice(0, 2))).toEqual(["v2", "v1"]);
    expect(rows[0].textContent).toMatch(/In use/);
  });

  test("saved rules say what they can do today; unsaved rules do not", async () => {
    const values = {
      ...defaults(),
      removal_enabled: true,
      at_risk_days: 7,
      confirm_days: 10,
    };
    await render({
      ...view,
      set: true,
      current: { set: true, values, version: 2 },
      can_do: policyCapabilities(values, { members: 24 }),
    });
    const canDo = screen
      .getByText("What these rules can do today")
      .closest("details");
    expect(canDo.textContent).toMatch(/Remove inactive members: Live/);
    expect(canDo.textContent).toMatch(/Promote and demote Elders: Off/);
    expect(number("Kick after").value).toBe("10");
    cleanup();
    await render();
    expect(screen.queryByText("What these rules can do today")).toBeNull();
  });

  test("preview names a removal the record cannot read as held, and an edit drops it", async () => {
    vi.spyOn(manageApi, "previewPolicy").mockResolvedValue(
      ok({
        current: null,
        draft: {
          boundaries: [],
          band: null,
          members: [
            {
              player_tag: "#0RJL",
              name: "Unread",
              promotion: "none",
              demotion: "none",
              removal: "recommended",
              removal_judgment: "held",
              removal_triage: { status: "evidence_held" },
              actionable: { removal: false },
            },
            {
              player_tag: "#0VG9",
              name: "Idle",
              promotion: "none",
              demotion: "none",
              removal: "recommended",
              removal_judgment: "ready",
              removal_triage: { status: "eligible" },
              actionable: { removal: true },
            },
          ],
        },
      }),
    );
    await render();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview the last reviews" }),
    );
    expect(
      await screen.findByText("removal waiting on the record"),
    ).toBeTruthy();
    expect(screen.getByText("remove")).toBeTruthy();
    fireEvent.click(pick(/^Hardcore/));
    expect(screen.queryByText("removal waiting on the record")).toBeNull();
  });

  test("leaders set a small clan's rules without starting reviews", async () => {
    const save = vi
      .spyOn(manageApi, "savePolicy")
      .mockResolvedValue(ok({ version: 1 }));
    await render({ ...view, members: 1, big_enough: false });
    expect(screen.getByText(/You can set its rules now/)).toBeTruthy();
    expect(bar().textContent).toMatch(/Clan management waits for 10 members/);
    expect(
      screen.getByRole("button", { name: "Preview the last reviews" }).disabled,
    ).toBe(true);
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(clan.clan_tag, defaults(), null, 0),
    );
  });
});

test("refetch keeps an edited draft; newer rules need an explicit discard", async () => {
  const { queryClient } = await render();
  fireEvent.click(pick(/^Hardcore/));
  await act(async () =>
    queryClient.setQueryData(keys.policy(clan.clan_tag), { ...view }),
  );
  expect(pick(/^Hardcore/).getAttribute("aria-pressed")).toBe("true");
  await act(async () =>
    queryClient.setQueryData(keys.policy(clan.clan_tag), {
      ...view,
      set: true,
      current: { ...view.current, version: 1 },
    }),
  );
  expect(pick(/^Hardcore/).getAttribute("aria-pressed")).toBe("true");
  await waitFor(() => expect(saveButton().disabled).toBe(true));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Load latest rules and discard my draft",
    }),
  );
  expect(pick(/^Steady/).getAttribute("aria-pressed")).toBe("true");
});
