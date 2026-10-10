import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { ActivityDiscordSetting } from "../src/views/ActivityDiscordSetting.jsx";
import { manageApi } from "../src/api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = { clan_tag: "#2PQRJ8LV", name: "Example Clan", role: "leader" };
const HOOK = `https://discord.com/api/webhooks/1/${"a".repeat(68)}`;

const view = (extra = {}) => ({
  clan_tag: "#2PQRJ8LV",
  connection: {
    enabled: true,
    webhook: "discord.com/api/webhooks/1…aaaa",
    enabled_at: "2026-10-10T12:00:00Z",
    disabled_reason: null,
    categories: { milestones: false },
    rewrite: false,
    voice: "",
    set_by: "#20QQL8CCRU",
    set_by_name: "Ada",
    updated_at: "2026-10-10T12:00:00Z",
    delivery: null,
  },
  policy: {
    ready: true,
    defaults: { members: true, milestones: true, war: false },
    ruled_out: {
      war: "The clan's policy says it does not take part in Clan Wars, so there is no war to post.",
    },
  },
  categories: [
    { key: "members", label: "Members", why: "Who joins and who departs." },
    { key: "milestones", label: "Milestones", why: "Badges and bests." },
    { key: "war", label: "Clan Wars", why: "The week." },
  ],
  in_effect: { members: true, milestones: false, war: false },
  model: { available: true, set: false, refused: false },
  voice_max: 400,
  rewrites_per_day: 50,
  ...extra,
});

const ok = (data) => ({ ok: true, status: 200, data });

describe("the clan's activity in Discord", () => {
  test("connecting sends the address once and clears it from the page", async () => {
    vi.spyOn(manageApi, "activityDiscord").mockResolvedValue(
      ok(view({ connection: null })),
    );
    const save = vi
      .spyOn(manageApi, "saveActivityDiscord")
      .mockResolvedValue(ok(view()));
    renderWithProviders(<ActivityDiscordSetting clan={clan} />);
    const input = await screen.findByLabelText("Connect a webhook");
    expect(input.type).toBe("password");
    expect(screen.queryByText("What is posted")).toBeNull();
    fireEvent.change(input, { target: { value: ` ${HOOK} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("#2PQRJ8LV", { url: HOOK }),
    );
    expect(input.value).toBe("");
  });

  test("categories show the policy's word: a ruled-out one is locked with its reason, a switched one can go back to the default", async () => {
    vi.spyOn(manageApi, "activityDiscord").mockResolvedValue(ok(view()));
    const save = vi
      .spyOn(manageApi, "saveActivityDiscord")
      .mockResolvedValue(ok(view()));
    renderWithProviders(<ActivityDiscordSetting clan={clan} />);
    const war = await screen.findByLabelText("Clan Wars");
    expect(war.disabled).toBe(true);
    expect(screen.getByText(/does not take part in Clan Wars/)).toBeTruthy();
    expect(screen.getByLabelText("Members").checked).toBe(true);
    expect(screen.getByLabelText("Milestones").checked).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: /Use the policy’s default \(on\)/ }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("#2PQRJ8LV", {
        categories: { milestones: null },
      }),
    );
    fireEvent.click(screen.getByLabelText("Members"));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("#2PQRJ8LV", {
        categories: { members: false },
      }),
    );
  });

  test("without the clan's key, the rewrite asks for one in Settings", async () => {
    vi.spyOn(manageApi, "activityDiscord").mockResolvedValue(ok(view()));
    renderWithProviders(<ActivityDiscordSetting clan={clan} />);
    expect(
      await screen.findByText(/add the clan’s Anthropic API key/),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/Rewrite each post/)).toBeNull();
  });

  test("with the key, the rewrite and the voice are saved", async () => {
    vi.spyOn(manageApi, "activityDiscord").mockResolvedValue(
      ok(view({ model: { available: true, set: true, refused: false } })),
    );
    const save = vi
      .spyOn(manageApi, "saveActivityDiscord")
      .mockResolvedValue(ok(view()));
    renderWithProviders(<ActivityDiscordSetting clan={clan} />);
    fireEvent.click(await screen.findByLabelText(/Rewrite each post/));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("#2PQRJ8LV", { rewrite: true }),
    );
    expect(screen.getByText(/at most 50 times a day/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("How the posts should sound"), {
      target: { value: "Short and loud" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save the voice" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("#2PQRJ8LV", {
        voice: "Short and loud",
      }),
    );
  });

  test("a webhook Discord stopped accepting says so", async () => {
    const base = view();
    vi.spyOn(manageApi, "activityDiscord").mockResolvedValue(
      ok({
        ...base,
        connection: {
          ...base.connection,
          enabled: false,
          disabled_reason: "webhook_gone",
        },
      }),
    );
    renderWithProviders(<ActivityDiscordSetting clan={clan} />);
    expect(
      await screen.findByText(/Discord stopped accepting this webhook/),
    ).toBeTruthy();
    expect(screen.getByText("not posting")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume posting" })).toBeNull();
  });
});
