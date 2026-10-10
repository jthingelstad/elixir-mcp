import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Model } from "../src/views/Model.jsx";
import { Recruit } from "../src/views/Recruit.jsx";
import { manageApi } from "../src/api.js";
import { railItems, railKey } from "../src/lib/rail.js";
import { PITCH_FIELDS } from "@elixir-mcp/clan-engine";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const leaderClan = {
  clan_tag: "#2PQRJ8LV",
  name: "Example Clan",
  role: "leader",
};
const TYPED = `sk-ant-api03-${"t".repeat(40)}`;

const status = (extra = {}) => ({
  clan_tag: "#2PQRJ8LV",
  purposes: { recruit_pitch: { label: "Recruiting pitch" } },
  per_day: 20,
  keep_days: 90,
  uses: {
    today: 2,
    month: { count: 5, input_tokens: 3500, output_tokens: 900 },
    recent: [
      {
        at: "2026-09-25T11:00:00Z",
        by: "#20QQL8CCRU",
        by_name: "Ada",
        purpose: "recruit_pitch",
        model: "claude-sonnet-5",
        ok: true,
        input_tokens: 700,
        output_tokens: 180,
      },
    ],
  },
  set: true,
  hint: "sk-ant-…WXYZ",
  set_by: "#20QQL8CCRU",
  set_by_name: "Ada",
  set_at: "2026-09-25T10:00:00Z",
  model: "claude-sonnet-5",
  models: [
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  ],
  refused_at: null,
  readable: true,
  owner_leads: true,
  usable: true,
  ...extra,
});

describe("the clan's model", () => {
  test("shows the key by its last four only, the model and the uses; a typed key leaves the page on submit", async () => {
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      status: 200,
      data: status(),
    });
    const set = vi
      .spyOn(manageApi, "setModelKey")
      .mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    renderWithProviders(<Model clan={leaderClan} />);
    expect(await screen.findByText("sk-ant-…WXYZ")).toBeTruthy();
    expect(screen.getByText("in use")).toBeTruthy();
    expect(screen.getByText(/messages on Actions: welcomes/)).toBeTruthy();
    expect(
      screen.getByText(/names, tags and private notes stay local/),
    ).toBeTruthy();
    expect(
      screen.getByText(/frozen return or recorded career detail/),
    ).toBeTruthy();
    expect(
      screen.getByText(/confirmed Kicked or Left classification/),
    ).toBeTruthy();
    expect(screen.getByText(/Nothing is posted automatically/)).toBeTruthy();
    expect(screen.getByText("2 of 20 uses")).toBeTruthy();
    expect(screen.getByLabelText("Model").value).toBe("claude-sonnet-5");
    expect(screen.getByText("Recruiting pitch")).toBeTruthy();
    const input = screen.getByPlaceholderText("sk-ant-…");
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: `  ${TYPED} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith("#2PQRJ8LV", TYPED));
    await waitFor(() => expect(input.value).toBe(""));
  });

  test("a clan that saved Haiku 4.5 sees it chosen, beside the key's other models", async () => {
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      status: 200,
      data: status({ model: "claude-haiku-4-5-20251001" }),
    });
    const choose = vi.spyOn(manageApi, "chooseModel");
    renderWithProviders(<Model clan={leaderClan} />);
    const select = await screen.findByLabelText("Model");
    expect(select.value).toBe("claude-haiku-4-5-20251001");
    expect([...select.options].map((o) => o.value)).toEqual([
      "claude-sonnet-5",
      "claude-haiku-5-5",
      "claude-haiku-4-5-20251001",
    ]);
    expect(choose).not.toHaveBeenCalled();
  });

  test("asks for a refresh after drawing when the list is due, and reloads when it changed", async () => {
    const read = vi
      .spyOn(manageApi, "model")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: status({ refresh_due: true, models_refreshed_at: null }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        data: status({ models_refreshed_at: "2026-10-08T20:00:00Z" }),
      });
    const refresh = vi
      .spyOn(manageApi, "refreshModels")
      .mockResolvedValue({ ok: true, status: 200, data: { refreshed: true } });
    renderWithProviders(<Model clan={leaderClan} />);
    expect(await screen.findByText("sk-ant-…WXYZ")).toBeTruthy();
    await waitFor(() => expect(refresh).toHaveBeenCalledWith("#2PQRJ8LV"));
    expect(await screen.findByText("From Anthropic, 2026-10-08")).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("a list that is not due is not refreshed, and a failed refresh leaves the page as it was", async () => {
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      status: 200,
      data: status(),
    });
    const refresh = vi.spyOn(manageApi, "refreshModels");
    renderWithProviders(<Model clan={leaderClan} />);
    expect(await screen.findByText("sk-ant-…WXYZ")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      status: 200,
      data: status({ refresh_due: true }),
    });
    const failing = vi
      .spyOn(manageApi, "refreshModels")
      .mockRejectedValue(new Error("network"));
    renderWithProviders(<Model clan={leaderClan} />);
    expect(await screen.findByText("sk-ant-…WXYZ")).toBeTruthy();
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Model").value).toBe("claude-sonnet-5");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a chosen model the key no longer offers stays chosen and is marked", async () => {
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      status: 200,
      data: status({
        model: "claude-haiku-4-5-20251001",
        models: [
          { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
          { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
        ],
      }),
    });
    const choose = vi.spyOn(manageApi, "chooseModel");
    renderWithProviders(<Model clan={leaderClan} />);
    const select = await screen.findByLabelText("Model");
    expect(select.value).toBe("claude-haiku-4-5-20251001");
    const gone = [...select.options].find(
      (o) => o.value === "claude-haiku-4-5-20251001",
    );
    expect(gone.disabled).toBe(true);
    expect(gone.textContent).toMatch(/not offered by this key now/);
    expect(screen.getByText(/is not one this key offers now/)).toBeTruthy();
    expect(choose).not.toHaveBeenCalled();
  });

  test("says why a key is not in use", async () => {
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      status: 200,
      data: status({ owner_leads: false, usable: false }),
    });
    renderWithProviders(<Model clan={leaderClan} />);
    expect(await screen.findByText("not in use")).toBeTruthy();
    expect(
      screen.getByText(/Ada added this key and no longer leads/),
    ).toBeTruthy();
    expect(screen.getByText("Replace it with a key of yours")).toBeTruthy();
  });

  test("a leader drafts the pitch with it; the words fill the editor, checks are shown, and what they had comes back", async () => {
    const pitch = {
      tagline: "Old tagline",
      about: "Old about.",
      points: ["Old point"],
      looking_for: "Old look.",
      website_url: "https://example.org",
      contact: "Request in game.",
    };
    vi.spyOn(manageApi, "recruit").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        clan_tag: "#2PQRJ8LV",
        can_edit: true,
        model: { set: true, refused: false, model: "claude-sonnet-5" },
        pitch,
        pitch_version: 1,
        fields: PITCH_FIELDS,
        facts: { name: "Example Clan", members: 40, open_slots: 10 },
        facts_read_at: "2026-09-25T11:00:00Z",
        pending: null,
        copy: null,
        suggested: null,
        problems: [],
        versions: [],
      },
    });
    const draft = vi.spyOn(manageApi, "draftPitch").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        draft: {
          ...pitch,
          tagline: "War first, friends always",
          points: ["Four decks every war day", "Top 3 here"],
        },
        errors: {},
        checks: [
          "Check before saving: 3 was not in anything the model was told about the clan.",
        ],
        model: "claude-sonnet-5",
      },
    });
    renderWithProviders(<Recruit clan={leaderClan} />);
    fireEvent.click(await screen.findByText("edit the pitch"));
    fireEvent.change(screen.getByLabelText("What should it stress?"), {
      target: { value: "war days" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft it" }));
    await waitFor(() =>
      expect(draft).toHaveBeenCalledWith("#2PQRJ8LV", "war days"),
    );
    expect(
      await screen.findByDisplayValue("War first, friends always"),
    ).toBeTruthy();
    expect(
      screen.getByText(/3 was not in anything the model was told/),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Put back what I had"));
    expect(await screen.findByDisplayValue("Old tagline")).toBeTruthy();
  });

  test("without a key, the editor points a leader to add one", async () => {
    vi.spyOn(manageApi, "recruit").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        clan_tag: "#2PQRJ8LV",
        can_edit: true,
        model: { set: false, refused: false, model: null },
        pitch: { tagline: "", about: "", points: [], looking_for: "" },
        pitch_version: 0,
        fields: PITCH_FIELDS,
        facts: null,
        pending: null,
        copy: null,
        suggested: null,
        problems: [],
        versions: [],
      },
    });
    const navigate = vi.fn();
    renderWithProviders(<Recruit clan={leaderClan} navigate={navigate} />);
    fireEvent.click(await screen.findByText("write the pitch"));
    fireEvent.click(screen.getByText("Add the clan's key"));
    expect(navigate).toHaveBeenCalledWith("/clan/2PQRJ8LV/manage/settings");
    expect(screen.queryByRole("button", { name: "Draft it" })).toBeNull();
  });

  test("the rail offers clan settings to leaders, with or without a policy, and to no one else", () => {
    const me = (role, policy) => ({
      ok: true,
      selected: { clan_tag: "#2PQRJ8LV", role },
      clans: [{}],
      policy,
    });
    const keys = (m) => railItems(m).map((r) => r.key);
    expect(keys(me("leader", { set: false }))).toContain("settings");
    expect(keys(me("coLeader", { set: true, active: true }))).toContain(
      "settings",
    );
    expect(keys(me("elder", { set: true, active: true }))).not.toContain(
      "settings",
    );
    expect(keys(me("member", { set: false }))).not.toContain("settings");
    expect(railKey("/clan/2PQRJ8LV/manage/settings")).toBe("settings");
    expect(railKey("/clan/2PQRJ8LV/manage/model")).toBe("settings");
  });
});

describe("the clan's model: spend and the monthly cap", () => {
  const spent = (extra = {}) =>
    status({
      prices_as_of: "2026-10-10",
      max_spend_cap_usd: 1000,
      spend_cap_usd: null,
      cap_reached: false,
      uses: {
        today: 2,
        month: {
          count: 5,
          input_tokens: 3500,
          output_tokens: 900,
          spend_usd: 0.016,
          spend_estimated: false,
        },
        recent: [
          {
            at: "2026-09-25T11:00:00Z",
            by: "#20QQL8CCRU",
            by_name: "Ada",
            purpose: "recruit_pitch",
            model: "claude-sonnet-5",
            ok: true,
            input_tokens: 700,
            output_tokens: 180,
            spend_usd: 0.0032,
          },
        ],
      },
      ...extra,
    });

  test("shows about what the month and each use cost, from list prices", async () => {
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      status: 200,
      data: spent(),
    });
    renderWithProviders(<Model clan={leaderClan} />);
    expect(
      await screen.findByText(
        /5 uses · 3,500 tokens in, 900 out · about \$0\.02/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/700 in · 180 out · about \$0\.0032/)).toBeTruthy();
    expect(screen.getByText(/list prices as of 2026-10-10/)).toBeTruthy();
    expect(screen.getByLabelText("Monthly cap").value).toBe("");
  });

  test("a leader sets, and removes, the monthly cap", async () => {
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      status: 200,
      data: spent(),
    });
    const setCap = vi
      .spyOn(manageApi, "setSpendCap")
      .mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    renderWithProviders(<Model clan={leaderClan} />);
    const input = await screen.findByLabelText("Monthly cap");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save cap" }));
    await waitFor(() => expect(setCap).toHaveBeenCalledWith("#2PQRJ8LV", "5"));
    cleanup();
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      status: 200,
      data: spent({ spend_cap_usd: 5 }),
    });
    renderWithProviders(<Model clan={leaderClan} />);
    expect(
      await screen.findByText(/about \$0\.02 of the \$5\.00 cap/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove cap" }));
    await waitFor(() => expect(setCap).toHaveBeenCalledWith("#2PQRJ8LV", null));
  });

  test("says so when the month has reached the cap, and shows a refused cap's reason", async () => {
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      status: 200,
      data: spent({ spend_cap_usd: 0.01, cap_reached: true }),
    });
    vi.spyOn(manageApi, "setSpendCap").mockResolvedValue({
      ok: false,
      status: 400,
      data: { message: "A cap is a dollar amount from $0.01 to $1000." },
    });
    renderWithProviders(<Model clan={leaderClan} />);
    expect(await screen.findByText(/has reached the \$0\.01 cap/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Monthly cap"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save cap" }));
    expect(await screen.findByText(/A cap is a dollar amount/)).toBeTruthy();
  });
});
