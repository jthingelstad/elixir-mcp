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
import { Run } from "../src/views/Run.jsx";
import { keys } from "../src/lib/queries.js";
import { manageApi } from "../src/api.js";
import {
  FIELDS,
  GROUPS,
  TABS,
  defaults,
  policyCapabilities,
} from "@elixir-mcp/clan-engine";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual()),
  useBlocker: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = { clan_tag: "#2PQRJ8LV", name: "Example Clan", role: "leader" };
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
const runLink = (name) =>
  within(screen.getByRole("navigation", { name: "Run" }))
    .getAllByRole("link")
    .find((a) => a.textContent.startsWith(name));
const open = (name) => fireEvent.click(runLink(name));
const saveButton = () =>
  within(document.querySelector(".clan-save")).getByRole("button", {
    name: "Save this clan's policy",
  });
const render = async (data = view) => {
  vi.spyOn(manageApi, "policy").mockResolvedValue({
    ok: true,
    status: 200,
    data,
  });
  const rendered = renderWithProviders(<Walk first="about" />);
  await screen.findByLabelText(/Clan War participation/);
  return rendered;
};

describe("policy: separated sections under Run", () => {
  test("the draft summary follows explicit intent, and scoring links to the question before presets without saving", async () => {
    const save = vi.spyOn(manageApi, "savePolicy");
    const { container } = await render();
    const summary = screen
      .getByText("Draft agreement", { exact: true })
      .closest("details");
    expect(
      within(summary).getByText(/Clan War participation: Not specified/),
    ).toBeTruthy();
    const intent = screen.getByLabelText(/Clan War participation/);
    const presetHeading = screen.getByRole("heading", {
      name: "Start from what the clan is for",
    });
    expect(
      intent.compareDocumentPosition(presetHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelectorAll("#f-war_intent").length).toBe(1);
    fireEvent.change(intent, { target: { value: "participating" } });
    expect(
      within(summary).getByText(
        /Clan War participation: We participate in Clan Wars/,
      ),
    ).toBeTruthy();
    open("Clan Wars");
    expect(screen.getByLabelText("Count Clan Wars").checked).toBe(false);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Set Clan War participation in About",
      }),
    );
    expect(screen.getByLabelText(/Clan War participation/).value).toBe(
      "participating",
    );
    fireEvent.change(screen.getByLabelText(/Clan War participation/), {
      target: { value: "not_participating" },
    });
    expect(
      within(summary).getByText(
        /Clan War participation: We do not participate in Clan Wars/,
      ),
    ).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });
  test("war intent starts unknown, survives presets and is saved independently of scoring", async () => {
    const save = vi
      .spyOn(manageApi, "savePolicy")
      .mockResolvedValue({ ok: true, status: 200, data: { version: 1 } });
    await render();
    const intent = () => screen.getByLabelText(/Clan War participation/);
    expect(intent().value).toBe("unknown");
    fireEvent.change(intent(), { target: { value: "not_participating" } });
    fireEvent.click(screen.getByRole("button", { name: /^A war clan/ }));
    expect(intent().value).toBe("not_participating");
    open("Clan Wars");
    expect(screen.getByLabelText("Count Clan Wars").checked).toBe(true);
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1].war_intent).toBe("not_participating");
    expect(save.mock.calls[0][1].war_enabled).toBe(true);
  });
  test("preview names a removal the record cannot read as held, and a member past the removal day as remove", async () => {
    vi.spyOn(manageApi, "previewPolicy").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        current: null,
        draft: {
          boundaries: [],
          band: null,
          members: [
            {
              player_tag: "#8QCV",
              name: "Unread",
              promotion: "none",
              demotion: "none",
              removal: "recommended",
              removal_judgment: "held",
              removal_triage: { status: "evidence_held" },
              actionable: { removal: false },
            },
            {
              player_tag: "#9QCV",
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
      },
    });
    await render();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview the last reviews" }),
    );
    expect(
      await screen.findByText("removal waiting on the record"),
    ).toBeTruthy();
    expect(screen.getByText("remove")).toBeTruthy();
  });
  test("the Inactivity section has no enforceability label, and the saved policy says removal is live", async () => {
    const values = {
      ...defaults(),
      elder_mode: "hand",
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
    const canDo = screen.getByRole("region", {
      name: "What this policy can do today",
    });
    expect(canDo.textContent).toMatch(/Remove inactive members: Live/);
    expect(canDo.textContent).toMatch(/Promote and demote Elders: Off/);
    open("Inactivity");
    expect(screen.queryByText("Not yet enforceable")).toBeNull();
    const atRisk = screen.getByLabelText(/^At risk/);
    expect(atRisk.value).toBe("7");
    expect(screen.getByLabelText(/^Removal action at/).value).toBe("10");
  });

  test("a changed setting says what the saved policy had, and versions mark the one in use", async () => {
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
    open("Inactivity");
    const atRisk = screen.getByLabelText(/^At risk/);
    expect(document.getElementById("at_risk_days").dataset.changed).toBe(
      undefined,
    );
    fireEvent.change(atRisk, { target: { value: "6" } });
    const field = document.getElementById("at_risk_days");
    expect(field.dataset.changed).toBe("true");
    expect(field.textContent).toMatch(/Was 7 /);
    expect(atRisk.getAttribute("aria-describedby")).toMatch(
      /f-at_risk_days-was/,
    );
    const bar = document.querySelector(".clan-save");
    expect(bar.dataset.live).toBe("true");
    expect(bar.textContent).toMatch(/1 setting changed: At risk/);
    const rows = [...document.querySelectorAll(".clan-versions__row")];
    expect(rows.map((r) => r.textContent.slice(0, 2))).toEqual(["v2", "v1"]);
    expect(rows[0].textContent).toMatch(/In use/);
    expect(rows[1].textContent).not.toMatch(/In use/);
  });

  test("an unsaved policy shows no can-do box", async () => {
    await render();
    expect(
      screen.queryByRole("region", { name: "What this policy can do today" }),
    ).toBeNull();
  });

  test("leaders prepare a small clan's policy without starting operational reviews", async () => {
    const save = vi
      .spyOn(manageApi, "savePolicy")
      .mockResolvedValue({ ok: true, status: 200, data: { version: 1 } });
    await render({ ...view, members: 1, big_enough: false });
    expect(
      screen.getByText(/Leaders can prepare and save its policy now/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Preview the last reviews" }).disabled,
    ).toBe(true);
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(clan.clan_tag, defaults(), null, 0),
    );
  });
  test("an edit invalidates a prior preview and minimums have their own section", async () => {
    vi.spyOn(manageApi, "previewPolicy").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        current: null,
        draft: { members: [], boundaries: [], band: null },
      },
    });
    await render();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview the last reviews" }),
    );
    await screen.findByText(/Nobody would read differently/);
    fireEvent.change(screen.getByLabelText(/How strict/), {
      target: { value: "strict" },
    });
    expect(screen.queryByText(/Nobody would read differently/)).toBeNull();
    expect(runLink("Minimums")).toBeTruthy();
  });
  test("one section at a time, each category switched on or off; a preset fills every section", async () => {
    const save = vi
      .spyOn(manageApi, "savePolicy")
      .mockResolvedValue({ ok: true, status: 200, data: { version: 1 } });
    await render();
    for (const name of ["About", "Clan Wars", "Elder", "Inactivity"])
      expect(runLink(name)).toBeTruthy();
    expect(runLink("Clan Wars").textContent).toMatch(/Off$/);
    // Nothing from another section is on the page.
    expect(screen.queryByLabelText(/War rate window/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^A war clan/ }));
    expect(runLink("Clan Wars").textContent).toMatch(/On$/);
    expect(screen.getByLabelText(/How strict/).value).toBe("strict");
    open("Clan Wars");
    expect(screen.getByLabelText("Count Clan Wars").checked).toBe(true);
    expect(screen.getByLabelText(/Minimum war decks/).value).toBe("24");
    expect(screen.queryByLabelText(/How strict/)).toBeNull();
    open("Elder");
    expect(screen.getByLabelText(/Elders are chosen/).value).toBe("categories");
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalled());
    const [, values] = save.mock.calls[0];
    expect(values.war_enabled).toBe(true);
    expect(values.donations_enabled).toBe(true);
    expect(values.removal_enabled).toBe(true);
    expect("goal_war" in values).toBe(false);
  });

  test("turning a section on shows its settings, filled from how strict the clan is", async () => {
    await render();
    open("Donations");
    expect(screen.queryByLabelText(/Minimum donations/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Count donations"));
    expect(screen.getByLabelText(/Minimum donations/).value).toBe("40");
    expect(screen.getByLabelText(/Donation window/).value).toBe("4");
    expect(runLink("Donations").textContent).toMatch(/changedOn$/);
    fireEvent.click(screen.getByLabelText("Count donations"));
    expect(screen.queryByLabelText(/Minimum donations/)).toBeNull();
  });

  test("a social clan chooses Elders by hand and counts nothing", async () => {
    await render();
    fireEvent.click(screen.getByRole("button", { name: /^A social clan/ }));
    expect(screen.getByLabelText(/Playing together/).checked).toBe(true);
    expect(runLink("Elder").textContent).toMatch(/by hand$/);
    open("Clan Wars");
    expect(screen.getByLabelText("Count Clan Wars").checked).toBe(false);
  });

  test("a refused save opens the section that holds the problem", async () => {
    vi.spyOn(manageApi, "savePolicy").mockResolvedValue({
      ok: false,
      status: 400,
      data: {
        error: "invalid_policy",
        errors: { at_risk_days: "At risk cannot come before getting quiet." },
      },
    });
    await render();
    fireEvent.click(screen.getByRole("button", { name: /^A war clan/ }));
    fireEvent.click(saveButton());
    expect(
      await screen.findByText("At risk cannot come before getting quiet."),
    ).toBeTruthy();
    expect(runLink("Inactivity").getAttribute("aria-current")).toBe("page");
  });
});

test("refetch preserves an edited draft; a newer version requires explicit discard", async () => {
  const { queryClient } = await render();
  fireEvent.change(screen.getByLabelText(/How strict/), {
    target: { value: "strict" },
  });
  await act(async () =>
    queryClient.setQueryData(keys.policy(clan.clan_tag), {
      ...view,
    }),
  );
  expect(screen.getByLabelText(/How strict/).value).toBe("strict");
  await act(async () =>
    queryClient.setQueryData(keys.policy(clan.clan_tag), {
      ...view,
      set: true,
      current: { ...view.current, version: 1 },
    }),
  );
  expect(screen.getByLabelText(/How strict/).value).toBe("strict");
  await waitFor(() =>
    expect(
      screen
        .getAllByRole("button", { name: "Save as new version" })
        .every((b) => b.disabled),
    ).toBe(true),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Load latest policy and discard my draft",
    }),
  );
  expect(screen.getByLabelText(/How strict/).value).toBe(
    view.current.values.posture,
  );
});
