import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { ActivityDiscordSetting } from "../src/views/ActivityDiscordSetting.jsx";
import { ActivityDiscord } from "../src/views/ActivityDiscord.jsx";
import { manageApi } from "../src/api.js";
import { railItems, railKey } from "../src/lib/rail.js";
import { parseClanPath } from "../src/App.jsx";

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
  editor_runs_per_day: 50,
  ...extra,
});

const ok = (data) => ({ ok: true, status: 200, data });

describe("the clan's activity in Discord", () => {
  test("the channel's last deliveries show each line as posted, marked when the clan's model wrote it", async () => {
    const base = view();
    vi.spyOn(manageApi, "activityDiscord").mockResolvedValue(
      ok({
        ...base,
        connection: {
          ...base.connection,
          deliveries: [
            {
              at: "2026-10-11T12:00:00Z",
              outcome: "posted",
              ref: "tl_0123456789abcdef0123",
              excerpt: "Ada steps up to Elder!",
              rewritten: true,
            },
            {
              at: "2026-10-11T11:00:00Z",
              outcome: "not_delivered",
              excerpt: "Ben joined",
              reason: "Discord kept asking Elixir to slow down.",
            },
          ],
          not_delivered: 1,
        },
      }),
    );
    renderWithProviders(<ActivityDiscordSetting clan={clan} />);
    const list = await screen.findByRole("list", { name: "Last deliveries" });
    const [first, second] = list.querySelectorAll("li");
    expect(first.textContent).toContain("by the clan’s model");
    expect(first.textContent).toContain("Ada steps up to Elder!");
    expect(second.textContent).toContain("Not delivered");
    expect(second.textContent).not.toContain("by the clan’s model");
    expect(screen.getByText(/1 not delivered in 30 days/)).toBeTruthy();
  });

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

  test("without the clan's key, the editor asks for one in Settings", async () => {
    vi.spyOn(manageApi, "activityDiscord").mockResolvedValue(ok(view()));
    const navigate = vi.fn();
    renderWithProviders(<ActivityDiscord clan={clan} navigate={navigate} />);
    expect(
      await screen.findByText(/add the clan’s Anthropic API key/),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/edit the channel/)).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Settings ›" }));
    expect(navigate).toHaveBeenCalledWith("/clan/2PQRJ8LV/manage/settings", {
      hash: "settings-model",
    });
  });

  test("with the key, the editor and the voice are saved", async () => {
    vi.spyOn(manageApi, "activityDiscord").mockResolvedValue(
      ok(
        view({
          model: {
            available: true,
            set: true,
            refused: false,
            name: "Claude Sonnet 5.5",
          },
        }),
      ),
    );
    const save = vi
      .spyOn(manageApi, "saveActivityDiscord")
      .mockResolvedValue(ok(view()));
    renderWithProviders(<ActivityDiscordSetting clan={clan} />);
    fireEvent.click(
      await screen.findByLabelText("Have the clan’s model edit the channel"),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("#2PQRJ8LV", { rewrite: true }),
    );
    expect(screen.getByText(/at most 50 runs a day/)).toBeTruthy();
    // What the editor may do, and what keeps Elixir's own words, as the
    // engine refuses it.
    expect(
      screen.getByText(/tells a few together, or skips one with a reason/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /drops or changes a name, carries a number or a name it was not given, says a time of day, carries a link or a mention, or runs long keeps/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Edited by Claude Sonnet 5\.5, the model Elixir Clan uses/,
      ),
    ).toBeTruthy();
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

  test("a leader previews the editor on the last few stories in the voice in the box: posts, stories told together, skips and refusals; a draft that outlasts its request is asked for again", async () => {
    vi.spyOn(manageApi, "activityDiscord").mockResolvedValue(
      ok(
        view({
          model: { available: true, set: true, refused: false, name: "X" },
        }),
      ),
    );
    const preview = vi
      .spyOn(manageApi, "previewActivityDiscord")
      .mockResolvedValueOnce(ok({ pending: "req-1" }))
      .mockResolvedValueOnce(
        ok({
          empty: false,
          model: "claude-sonnet-5-5",
          posts: [
            {
              key: "tl_1",
              kind: "member_joined",
              elixir: "Ada joined Example Clan.",
              post: "Welcome aboard, Ada and Cy!",
              with: ["tl_3"],
              told_in: null,
              skipped: null,
              refused: null,
            },
            {
              key: "tl_2",
              kind: "trophy_milestone",
              elixir: "Bo reached 9,000 trophies.",
              post: null,
              with: [],
              told_in: null,
              skipped: null,
              refused: "number_invented",
            },
            {
              key: "tl_3",
              kind: "member_joined",
              elixir: "Cy joined Example Clan.",
              post: null,
              with: [],
              told_in: "tl_1",
              skipped: null,
              refused: null,
            },
            {
              key: "tl_4",
              kind: "career_wins_step",
              elixir: "Eve passed 1,000 career wins.",
              post: null,
              with: [],
              told_in: null,
              skipped: "A small step.",
              refused: null,
            },
          ],
        }),
      );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderWithProviders(<ActivityDiscordSetting clan={clan} />);
      fireEvent.change(
        await screen.findByLabelText("How the posts should sound"),
        {
          target: { value: "Pirate talk" },
        },
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "Preview the last 5 in this voice",
        }),
      );
      await vi.advanceTimersByTimeAsync(3000);
      expect(
        await screen.findByText("Welcome aboard, Ada and Cy!"),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
    expect(preview).toHaveBeenNthCalledWith(
      1,
      "#2PQRJ8LV",
      "Pirate talk",
      null,
    );
    expect(preview).toHaveBeenNthCalledWith(
      2,
      "#2PQRJ8LV",
      "Pirate talk",
      "req-1",
    );
    expect(screen.getByText("Bo reached 9,000 trophies.")).toBeTruthy();
    expect(
      screen.getByText(/a number the record did not give it/),
    ).toBeTruthy();
    // Cy's story is told in Ada's post, not on its own.
    expect(
      screen.getByText(
        "Tells 2 stories. Elixir's versions: Ada joined Example Clan. · Cy joined Example Clan.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Skipped: A small step.")).toBeTruthy();
    expect(
      screen.getByText("Elixir’s version: Eve passed 1,000 career wins."),
    ).toBeTruthy();
    expect(
      screen.getByText(/Counts as one of the leaders’ drafts/),
    ).toBeTruthy();
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

describe("Social ▸ Discord in the rail", () => {
  const me = (role, extra = {}) => ({
    ok: true,
    selected: { clan_tag: "#2PQRJ8LV", role },
    clans: [{}],
    policy: { set: false },
    ...extra,
  });
  const items = (m) => railItems(m);

  test("a page of its own in the Social group, for leaders, with or without a policy", () => {
    for (const role of ["leader", "coLeader"]) {
      const rail = items(me(role));
      const at = rail.findIndex((r) => r.key === "discord");
      expect(at).toBeGreaterThan(-1);
      expect(rail[at].to).toBe("/clan/2PQRJ8LV/discord");
      // After Recruit, before Manage starts its own group.
      expect(rail[at - 1].key).toBe("recruit");
      expect(rail[at].group).toBeUndefined();
      expect(rail.slice(at + 1).find((r) => r.group)?.group).toBe("Manage");
    }
    expect(items(me("elder")).map((r) => r.key)).not.toContain("discord");
    expect(items(me("member")).map((r) => r.key)).not.toContain("discord");
    // Off with the map, Recruit opens the group and Discord stays in it.
    const off = items(me("leader", { social: { enabled: false } }));
    const recruit = off.findIndex((r) => r.key === "recruit");
    expect(off[recruit].group).toBe("Social");
    expect(off[recruit + 1].key).toBe("discord");
  });

  test("its address is the clan's, and Settings no longer holds it", () => {
    expect(railKey("/clan/2PQRJ8LV/discord")).toBe("discord");
    expect(parseClanPath("/clan/2PQRJ8LV/discord")).toEqual({
      tag: "#2PQRJ8LV",
      section: "discord",
      tab: null,
    });
  });

  test("the page wears its own head", async () => {
    vi.spyOn(manageApi, "activityDiscord").mockResolvedValue(ok(view()));
    renderWithProviders(<ActivityDiscord clan={clan} navigate={vi.fn()} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Discord" }),
    ).toBeTruthy();
    expect(await screen.findByText("Clan Wars")).toBeTruthy();
  });
});
