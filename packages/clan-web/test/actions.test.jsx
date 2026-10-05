import { afterEach, describe, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { ActionDetail, Actions } from "../src/views/Actions.jsx";
import { keys } from "../src/lib/queries.js";
import { manageApi } from "../src/api.js";
import { ActionCard } from "../src/components/ActionCard.jsx";
import { ZoneProvider } from "@elixir-mcp/ui";
import { actionDelivery } from "@elixir-mcp/clan-engine";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

const clan = { clan_tag: "#2PQRJ8LV", name: "Example Clan", role: "leader" };
const removal = {
  card_id: "a1",
  type: "removal",
  label: "Remove from the clan",
  status: "proposed",
  can_act: true,
  audience: { kind: "leaders" },
  player_tag: "#8QCV",
  player_name: "Sleepy",
  role_at_raise: "member",
  raised_at: "2026-09-12T20:00:00Z",
  policy_version: 1,
  copy: "Sleepy was removed for inactivity (20 days without a battle).",
  evidence: {
    as_of: "2026-09-12T19:58:00Z",
    rationale: {
      headline: "20 battle-free days: at risk at 5, an action at 8.",
    },
    facts: [],
  },
  log: [
    {
      entry_id: "e1",
      kind: "raised",
      at: "2026-09-12T20:00:00Z",
      by: { system: "elixir-clan" },
      text: "20 battle-free days: at risk at 5, an action at 8.",
      detail: {
        policy_version: 1,
        clauses: ["at_risk_days", "confirm_days"],
        facts: ["Last battle: 20 days ago (record)"],
        prior: [
          {
            card_id: "a0",
            status: "declined",
            raised_at: "2026-09-01T00:00:00Z",
            closed_at: "2026-09-02T00:00:00Z",
            reason: "knows_the_member",
          },
        ],
      },
    },
  ],
};
/** The same action, as its own page answers it. */
const one = (extra = {}) => {
  const { data } = view(extra);
  return {
    ok: true,
    status: 200,
    data: {
      clan_tag: data.clan_tag,
      action: { number: 37, ...data.open[0] },
      decline_reasons: data.decline_reasons,
      ...(data.model ? { model: data.model } : {}),
    },
  };
};
const view = (extra = {}) => ({
  ok: true,
  status: 200,
  data: {
    clan_tag: "#2PQRJ8LV",
    as_of: "2026-09-12T19:58:00Z",
    freshness_seconds: 60,
    policy_version: 1,
    open: [removal],
    recent: [],
    decline_reasons: ["not_now", "knows_the_member", "other"],
    ...extra,
  },
});

describe("actions", () => {
  test("a withdrawn removal warning is stacked, uses the reader's timezone and offers no new decline or decision", () => {
    const decide = vi.spyOn(manageApi, "decideAction");
    renderWithProviders(
      <ZoneProvider zone="America/Chicago">
        <ActionCard
          clan={clan}
          who={{ role: "leader" }}
          reasons={[]}
          model={{ set: true }}
          action={{
            ...removal,
            status: "withdrawn",
            can_act: false,
            can_complete: false,
            can_reopen: true,
            removal_safety: {
              status: "held",
              checked_at: "2026-10-04T08:00:00Z",
              reason:
                "Profile observations are missing inside the measured window.",
              latest_activity_interval: {
                counter_increase: 1,
                observed_from: "2026-10-02T01:00:00Z",
                observed_to: "2026-10-03T02:00:00Z",
                no_battles_captured: true,
              },
            },
          }}
        />
      </ZoneProvider>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.classList.contains("flex-col")).toBe(true);
    expect(alert.textContent).toContain("2026-10-04 03:00 CDT");
    expect(alert.textContent).toContain("2026-10-01 20:00 CDT");
    expect(alert.textContent).toContain("This Action is closed");
    expect(alert.textContent).not.toMatch(/may still explicitly decline/);
    expect(alert.querySelectorAll("time")).toHaveLength(3);
    for (const name of [
      "Complete",
      "Decline",
      "Reopen action",
      "Draft in our voice",
    ])
      expect(screen.queryByRole("button", { name, exact: true })).toBeNull();
    expect(screen.queryByLabelText("Chat message")).toBeNull();
    expect(
      screen.getAllByText("20 battle-free days: at risk at 5, an action at 8."),
    ).toHaveLength(1);
    expect(screen.getByText(/Log · 1 entry/)).toBeTruthy();
    expect(screen.getByText("2026-09-12 15:00 CDT")).toBeTruthy();
    expect(decide).not.toHaveBeenCalled();
  });
  test("held removal evidence is prominent; stale copy, drafts, completion and reopening are withheld while explicit decline stays available", async () => {
    const decide = vi
      .spyOn(manageApi, "decideAction")
      .mockResolvedValue({ ok: true, data: {} });
    const draft = vi.spyOn(manageApi, "draftLeaderMessage");
    const reopen = vi.spyOn(manageApi, "reopenAction");
    renderWithProviders(
      <ActionCard
        action={{
          ...removal,
          can_complete: false,
          can_reopen: true,
          removal_safety: {
            status: "held",
            reason:
              "Time after the latest profile counter observation is unmeasured.",
            checked_at: "2026-10-04T08:00:00Z",
            latest_activity_interval: {
              counter_increase: 1,
              observed_from: "2026-10-02T01:00:00Z",
              observed_to: "2026-10-03T02:00:00Z",
              no_battles_captured: true,
            },
          },
        }}
        clan={clan}
        who={{ role: "leader" }}
        reasons={["not_now", "evidence_wrong"]}
        model={{ set: true }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(
      /inactivity is not established/,
    );
    expect(screen.getByRole("alert").textContent).toMatch(
      /counter increased by 1/,
    );
    expect(screen.getByRole("alert").textContent).toMatch(
      /No battles from that interval were captured/,
    );
    expect(screen.queryByLabelText("Chat message")).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Draft in our voice" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen action" })).toBeNull();
    expect(screen.getByRole("button", { name: "Complete" }).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.change(screen.getByLabelText("Why decline"), {
      target: { value: "evidence_wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(clan.clan_tag, "a1", {
        status: "declined",
        reason: "evidence_wrong",
        note: null,
      }),
    );
    expect(draft).not.toHaveBeenCalled();
    expect(reopen).not.toHaveBeenCalled();
  });

  test("a current safety change with unchanged frozen Action context discards edited words and an in-flight draft", async () => {
    let resolve;
    vi.spyOn(manageApi, "draftLeaderMessage").mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const props = {
      clan,
      who: { role: "leader" },
      reasons: [],
      model: { set: true },
    };
    const action = {
      ...removal,
      draft_context_version: "same-frozen-evidence",
      removal_safety: { status: "ready", evidence_version: "old-proof" },
    };
    const rendered = renderWithProviders(
      <ActionCard {...props} action={action} />,
    );
    fireEvent.change(screen.getByLabelText("Chat message"), {
      target: { value: "Edited unsafe words" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft in our voice" }));
    rendered.rerender(
      <ActionCard
        {...props}
        action={{
          ...action,
          removal_safety: {
            status: "held",
            evidence_version: "new-proof",
            reason: "New play was observed.",
          },
          can_complete: false,
        }}
      />,
    );
    await act(async () =>
      resolve({ ok: true, data: { line: "Late unsafe draft", model: "fake" } }),
    );
    expect(screen.queryByLabelText("Chat message")).toBeNull();
    expect(screen.queryByDisplayValue("Late unsafe draft")).toBeNull();
    expect(screen.queryByText("Put back what I had")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(
      /New play was observed/,
    );
  });
  test("an action shows what raised it, its earlier history, and can be completed and commented on", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(one());
    const decide = vi
      .spyOn(manageApi, "decideAction")
      .mockResolvedValue({ ok: true, status: 200, data: {} });
    const comment = vi
      .spyOn(manageApi, "commentAction")
      .mockResolvedValue({ ok: true, status: 200, data: {} });
    renderWithProviders(
      <ActionDetail
        number={37}
        clan={clan}
        who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
      />,
    );
    expect(await screen.findByText(/Log · 1 entry/)).toBeTruthy();
    expect(screen.getByText("Action #37")).toBeTruthy();
    expect(screen.getByText("‹ All actions")).toBeTruthy();
    expect(
      screen.getByText(/Earlier: declined 2026-09-02 \(knows the member\)/),
    ).toBeTruthy();
    expect(
      screen.getByText(/policy v1: at_risk_days, confirm_days/),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "Messaged them first." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(comment).toHaveBeenCalledWith(
        "#2PQRJ8LV",
        "a1",
        "Messaged them first.",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("#2PQRJ8LV", "a1", {
        status: "done",
        reason: null,
        note: null,
      }),
    );
    expect(document.body.textContent).not.toMatch(/\bcard\b/i);
  });

  test("a member's own away question offers to mark away or say no", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({
        open: [
          {
            ...removal,
            card_id: "a2",
            type: "away",
            label: "Going to be away?",
            audience: { kind: "member", player_tag: "#8QCV" },
            copy: null,
            evidence: { days_idle: 6.2, away_max_days: 30 },
            log: [],
          },
        ],
      }),
    );
    const navigate = vi.fn();
    renderWithProviders(
      <ActionDetail
        number={37}
        clan={{ ...clan, role: "member" }}
        who={{ player_tag: "#8QCV", role: "member" }}
        navigate={navigate}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/The recorded activity clock is 6 days/),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("link", { name: "Mark me away" }));
    expect(navigate).toHaveBeenCalledWith("/clan/you/away");
    expect(screen.getByRole("button", { name: "I’m not away" })).toBeTruthy();
  });

  test("the list is one line per action, numbered; a line opens that action's own page", async () => {
    vi.spyOn(manageApi, "actions").mockResolvedValue(
      view({
        open: [
          { ...removal, number: 37 },
          {
            ...removal,
            card_id: "d1",
            number: 12,
            type: "departure",
            label: "Say how they left",
            player_name: "Gone",
            log: [
              ...removal.log,
              {
                entry_id: "c1",
                kind: "comment",
                at: "2026-09-12T21:00:00Z",
                by: { tag: "#20QQL8CCRU", name: "Ada", role: "leader" },
                text: "I think they left.",
              },
            ],
          },
        ],
        recent: [
          {
            ...removal,
            card_id: "x1",
            number: 5,
            status: "done",
            label: "Promote to Elder",
            player_name: "Rising",
          },
        ],
      }),
    );
    const navigate = vi.fn();
    renderWithProviders(
      <Actions
        clan={clan}
        who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
        navigate={navigate}
      />,
    );
    // Each list is its own panel, headed by its name and its count.
    const waiting = await screen.findByRole("region", {
      name: "Waiting for you",
    });
    expect(waiting.textContent).toMatch(/^Waiting for you2/);
    expect(
      screen.queryByRole("region", { name: "Closed in the last 30 days" }),
    ).toBeNull();
    const openLinks = screen
      .getAllByRole("link")
      .filter((l) => /\/actions\/\d+$/.test(l.getAttribute("href")));
    expect(openLinks.map((l) => l.getAttribute("href"))).toEqual([
      "/clan/2PQRJ8LV/actions/12",
      "/clan/2PQRJ8LV/actions/37",
    ]);
    expect(openLinks[0].textContent).toMatch(
      /#12.*Say how they left.*Gone.*1 comment/,
    );
    fireEvent.click(openLinks[1]);
    expect(navigate).toHaveBeenCalledWith("/clan/2PQRJ8LV/actions/37");
    fireEvent.change(screen.getByRole("combobox", { name: "Show" }), {
      target: { value: "closed" },
    });
    expect(
      screen.getByRole("region", { name: "Closed in the last 30 days" })
        .textContent,
    ).toMatch(/^Closed in the last 30 days1/);
    expect(
      screen.queryByRole("region", { name: "Waiting for you" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "History ›" })).toBeTruthy();
    const links = screen
      .getAllByRole("link")
      .filter((l) =>
        /\/actions\/\d+\?show=closed$/.test(l.getAttribute("href")),
      );
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(
      "/clan/2PQRJ8LV/actions/5?show=closed",
    );
    expect(links[0].textContent).toMatch(/#5.*Promote to Elder.*Completed/);
    // The list decides nothing: that is on the action's page.
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
  });

  test("an action that is not yours, or not there, says there is no such action here", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue({
      ok: false,
      status: 404,
      data: { error: "no_action" },
    });
    renderWithProviders(
      <ActionDetail
        number={99}
        clan={clan}
        who={{ player_tag: "#X", role: "member" }}
      />,
    );
    expect(await screen.findByText("No action #99 here")).toBeTruthy();
  });

  test("an action's page offers its address to send to someone", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(one());
    const write = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText: write } });
    renderWithProviders(
      <ActionDetail
        number={37}
        clan={clan}
        who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Copy link/ }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        `${window.location.origin}/clan/2PQRJ8LV/actions/37`,
      ),
    );
  });

  test("nothing waiting says so", async () => {
    vi.spyOn(manageApi, "actions").mockResolvedValue(view({ open: [] }));
    renderWithProviders(
      <Actions clan={clan} who={{ player_tag: "#X", role: "member" }} />,
    );
    await waitFor(() =>
      expect(screen.getByText("Nothing waiting for you")).toBeTruthy(),
    );
    // History is the leaders'; a member is not pointed at it.
    expect(screen.queryByRole("link", { name: "History ›" })).toBeNull();
  });
});

describe("clan leader messages", () => {
  const announcement = {
    ...removal,
    card_id: "rules",
    number: 46,
    type: "rules_announcement",
    label: "Tell the clan how it runs",
    channel: "leader_message",
    copy: null,
    message: { title: "Our rules", body: "Review our clan rules." },
    evidence: { version: 4 },
    log: [],
  };

  test("chat-first copy preserves independent edited buffers across channel switching, refetch and reload", async () => {
    const card = {
      ...announcement,
      delivery: actionDelivery(announcement, { fresh: true }),
    };
    vi.spyOn(manageApi, "action").mockResolvedValue(one({ open: [card] }));
    const decide = vi.spyOn(manageApi, "decideAction");
    const props = {
      number: 46,
      clan,
      who: { role: "leader", player_tag: "#LEADER" },
    };
    const first = renderWithProviders(<ActionDetail {...props} />);
    await screen.findByLabelText("Chat message");
    expect(screen.queryByLabelText("Title")).toBeNull();
    fireEvent.change(screen.getByLabelText("Chat message"), {
      target: { value: "Reviewed chat words." },
    });
    fireEvent.change(screen.getByLabelText("Delivery channel"), {
      target: { value: "leader_message" },
    });
    await screen.findByText(/Reported limit: one Leader Message per day/);
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Reviewed Inbox words." },
    });
    fireEvent.change(screen.getByLabelText("Delivery channel"), {
      target: { value: "clan_chat" },
    });
    expect(screen.getByLabelText("Chat message").value).toBe(
      "Reviewed chat words.",
    );
    await act(async () =>
      first.queryClient.invalidateQueries({
        queryKey: keys.actions(clan.clan_tag),
      }),
    );
    expect(screen.getByLabelText("Chat message").value).toBe(
      "Reviewed chat words.",
    );
    first.unmount();
    renderWithProviders(<ActionDetail {...props} />);
    expect((await screen.findByLabelText("Chat message")).value).toBe(
      "Reviewed chat words.",
    );
    fireEvent.change(screen.getByLabelText("Delivery channel"), {
      target: { value: "leader_message" },
    });
    expect(screen.getByLabelText("Message").value).toBe(
      "Reviewed Inbox words.",
    );
    expect(decide).not.toHaveBeenCalled();
  });

  test("each selected channel enforces its own limits while preserving invalid edits for shortening", async () => {
    const card = {
      ...announcement,
      delivery: actionDelivery(announcement, { fresh: true }),
    };
    vi.spyOn(manageApi, "action").mockResolvedValue(one({ open: [card] }));
    renderWithProviders(
      <ActionDetail number={46} clan={clan} who={{ role: "leader" }} />,
    );
    fireEvent.change(await screen.findByLabelText("Chat message"), {
      target: { value: "x".repeat(201) },
    });
    expect(screen.getByRole("button", { name: "Sent" }).disabled).toBe(true);
    expect(
      screen.getByRole("button", { name: "Copy the chat message" }).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Delivery channel"), {
      target: { value: "leader_message" },
    });
    expect(screen.getByRole("button", { name: "Sent" }).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "x".repeat(181) },
    });
    expect(screen.getByRole("button", { name: "Sent" }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Delivery channel"), {
      target: { value: "clan_chat" },
    });
    expect(screen.getByLabelText("Chat message").value.length).toBe(201);
    fireEvent.change(screen.getByLabelText("Chat message"), {
      target: { value: "Shortened." },
    });
    expect(screen.getByRole("button", { name: "Sent" }).disabled).toBe(false);
  });

  test("an interrupted mixed-channel update recovers saved words without duplicate receipts or a game resend", async () => {
    const card = {
      ...announcement,
      card_id: "mixed",
      type: "awards_standings",
      evidence: {
        scope: "current",
        season_id: 136,
        messages: [
          {
            part: 1,
            message: { title: "Season 136", body: "Points: Ada, Bob." },
          },
          {
            part: 2,
            message: { title: "Season 136", body: "Attendance: Cy, Dee." },
          },
        ],
      },
    };
    card.delivery = actionDelivery(card, { fresh: true });
    vi.spyOn(manageApi, "action").mockImplementation(async () =>
      one({ open: [structuredClone(card)] }),
    );
    const sent = vi
      .spyOn(manageApi, "messageSent")
      .mockImplementation(async (_tag, _id, part, words) => {
        card.messages_sent = [
          ...(card.messages_sent ?? []),
          { part, ...words, shared: true, sent_by_name: "Example" },
        ];
        if (part === 1) throw new Error("reply lost");
        return { ok: true, data: card };
      });
    const decide = vi
      .spyOn(manageApi, "decideAction")
      .mockResolvedValue({ ok: true, data: {} });
    renderWithProviders(
      <ActionDetail
        number={46}
        clan={clan}
        who={{ role: "leader", player_tag: "#LEADER" }}
      />,
    );
    const fields = await screen.findAllByLabelText("Chat message");
    fireEvent.change(fields[0], { target: { value: "Reviewed first chat." } });
    fireEvent.change(fields[1], {
      target: { value: "Keep this second edit." },
    });
    const first = screen.getByRole("button", { name: "Mark message 1 sent" });
    fireEvent.click(first);
    fireEvent.click(first);
    await screen.findByText("Sent in clan chat");
    expect(screen.getByText("Reviewed first chat.")).toBeTruthy();
    expect(sent).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Complete update" }).disabled,
    ).toBe(true);
    expect(screen.getByLabelText("Chat message").value).toBe(
      "Keep this second edit.",
    );
    fireEvent.change(screen.getByLabelText("Delivery channel for message 2"), {
      target: { value: "leader_message" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Reviewed second Inbox." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark message 2 sent" }),
    );
    await screen.findByText("Sent as a Leader Message");
    expect(
      screen.getByRole("button", { name: "Complete update" }).disabled,
    ).toBe(false);
    expect(card.messages_sent.map((r) => r.channel)).toEqual([
      "clan_chat",
      "leader_message",
    ]);
    expect(decide).not.toHaveBeenCalled();
  });

  test("the list distinguishes chat and competing inbox Actions without claiming a reset or capacity", async () => {
    vi.spyOn(manageApi, "actions").mockResolvedValue(
      view({
        open: [
          announcement,
          { ...announcement, card_id: "awards", number: 47, label: "Awards" },
          { ...removal, number: 48, channel: "clan_chat" },
        ],
        recent: [
          {
            ...announcement,
            number: 45,
            status: "done",
            decided_at: "2026-10-05T11:46:18Z",
          },
          {
            ...announcement,
            number: 44,
            status: "declined",
            decided_at: "2026-10-05T11:47:18Z",
          },
        ],
      }),
    );
    renderWithProviders(<Actions clan={clan} who={{ role: "leader" }} />);
    await screen.findByText(/2 Actions need Leader Messages/);
    expect(
      screen.getByText(/Latest completion in Elixir: Action #45/),
    ).toBeTruthy();
    expect(screen.getByText(/records a decision, not the game/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /#48.*Clan chat/ })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /#46.*Leader Message/ }),
    ).toBeTruthy();
    expect(
      screen.queryByText(/Latest completion in Elixir: Action #44/),
    ).toBeNull();
  });

  test("review later leaves the Action open and warns about masked delivery without disabling a human send", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({ open: [announcement] }),
    );
    const decide = vi.spyOn(manageApi, "decideAction");
    const sent = vi.spyOn(manageApi, "messageSent");
    const navigate = vi.fn();
    renderWithProviders(
      <ActionDetail
        number={46}
        clan={clan}
        who={{ role: "leader" }}
        navigate={navigate}
      />,
    );
    await screen.findByText(/A delivered message can be masked/);
    expect(screen.getByText(/cannot see sends/)).toBeTruthy();
    expect(screen.getByText(/does not guarantee/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sent" }).disabled).toBe(false);
    expect(
      screen.getByRole("button", { name: "Copy the message" }).disabled,
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("link", { name: "Review later · leave open" }),
    );
    expect(navigate).toHaveBeenCalledWith("/clan/2PQRJ8LV/actions");
    expect(decide).not.toHaveBeenCalled();
    expect(sent).not.toHaveBeenCalled();
  });

  test("chat-only Actions do not show an inbox quota", async () => {
    vi.spyOn(manageApi, "actions").mockResolvedValue(
      view({ open: [{ ...removal, channel: "clan_chat", number: 48 }] }),
    );
    renderWithProviders(<Actions clan={clan} who={{ role: "leader" }} />);
    await screen.findByRole("link", { name: /#48/ });
    expect(screen.queryByText(/Leader Message availability/)).toBeNull();
  });

  test("a promotion comes with its Clan Leader Message, counted against the game's limits and copyable", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({
        open: [
          {
            ...removal,
            card_id: "p1",
            type: "promotion",
            label: "Promote to Elder",
            channel: "leader_message",
            copy: null,
            message: {
              title: "Congrats, new Elder!",
              body: "Sleepy is now an Elder. Thank you for showing up for the clan.",
            },
            log: [],
          },
        ],
      }),
    );
    const write = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText: write } });
    renderWithProviders(
      <ActionDetail
        number={37}
        clan={clan}
        who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
      />,
    );
    await waitFor(() => expect(screen.getByText("20/24")).toBeTruthy());
    expect(
      screen.getByText(/promote Sleepy, send the reviewed message/),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "A title that runs far too long" },
    });
    expect(screen.getByText("30/24")).toBeTruthy();
    const copyTitle = screen.getByRole("button", { name: "Copy the title" });
    expect(copyTitle.disabled).toBe(true);
    fireEvent.click(copyTitle);
    expect(write).not.toHaveBeenCalled();
    expect(
      screen.getByText("Shorten to 24 characters before copying."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy the message" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "Sleepy is now an Elder. Thank you for showing up for the clan.",
      ),
    );
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Our new Elder" },
    });
    expect(copyTitle.disabled).toBe(false);
    fireEvent.click(copyTitle);
    await waitFor(() => expect(write).toHaveBeenCalledWith("Our new Elder"));
  });

  test("an announcement is marked sent without a reason, with the words as edited", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({
        open: [
          {
            card_id: "r1",
            type: "rules_announcement",
            label: "Tell the clan how it runs",
            status: "proposed",
            can_act: true,
            audience: { kind: "leaders" },
            player_tag: null,
            raised_at: "2026-09-12T20:00:00Z",
            channel: "leader_message",
            copy: null,
            message: {
              title: "How our clan runs",
              body: "We now run the clan with Elixir Clan.",
            },
            evidence: { version: 1, changes: [] },
            log: [],
          },
        ],
      }),
    );
    const decide = vi
      .spyOn(manageApi, "decideAction")
      .mockResolvedValue({ ok: true, status: 200, data: {} });
    renderWithProviders(
      <ActionDetail
        number={37}
        clan={clan}
        who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
      />,
    );
    await waitFor(() => expect(screen.getByText("The clan")).toBeTruthy());
    // What is shared with Elixir is what the leader sent, as edited.
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Our rules" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sent" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("#2PQRJ8LV", "r1", {
        status: "done",
        reason: null,
        note: null,
        sent: {
          channel: "leader_message",
          title: "Our rules",
          body: "We now run the clan with Elixir Clan.",
        },
      }),
    );
  });
});

describe("the clan's model on a Leader Message", () => {
  test("a pending leader-message draft blocks delivery, then records the reviewed words", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({
        model: { set: true },
        open: [
          {
            ...removal,
            type: "rules_announcement",
            copy: null,
            message: { title: "Our rules", body: "Old wording." },
          },
        ],
      }),
    );
    let reply;
    vi.spyOn(manageApi, "draftLeaderMessage").mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const decide = vi
      .spyOn(manageApi, "decideAction")
      .mockResolvedValue({ ok: true });
    renderWithProviders(
      <ActionDetail number={37} clan={clan} who={{ role: "coLeader" }} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Draft in our voice" }),
    );
    const sent = screen.getByRole("button", { name: "Sent" });
    expect(sent.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Skip" }).disabled).toBe(true);
    expect(
      screen.getByRole("button", { name: "Copy the title" }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Copy the message" }).disabled,
    ).toBe(true);
    fireEvent.click(sent);
    expect(decide).not.toHaveBeenCalled();
    reply({
      ok: true,
      data: { title: "New rules", body: "Draft wording.", model: "stub" },
    });
    await screen.findByDisplayValue("Draft wording.");
    expect(sent.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Reviewed wording." },
    });
    fireEvent.click(sent);
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("#2PQRJ8LV", "a1", {
        status: "done",
        reason: null,
        note: null,
        sent: {
          channel: "leader_message",
          title: "New rules",
          body: "Reviewed wording.",
        },
      }),
    );
  });

  test("a leader drafts it in the clan's voice, sees what to check, and can put back what they had", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({
        model: { set: true, refused: false, model: "claude-sonnet-5" },
        open: [
          {
            card_id: "r1",
            type: "rules_announcement",
            label: "Tell the clan how it runs",
            status: "proposed",
            can_act: true,
            audience: { kind: "leaders" },
            player_tag: null,
            raised_at: "2026-09-12T20:00:00Z",
            channel: "leader_message",
            copy: null,
            message: {
              title: "How our clan runs",
              body: "We now run the clan with Elixir Clan.",
            },
            evidence: { version: 1, changes: [] },
            log: [],
          },
        ],
      }),
    );
    const draft = vi.spyOn(manageApi, "draftLeaderMessage").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        title: "Our way, in brief",
        body: "We run the clan with Elixir Clan now. Sign in to see where you stand.",
        warnings: [],
        model: "claude-sonnet-5",
      },
    });
    renderWithProviders(
      <ActionDetail
        number={37}
        clan={clan}
        who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
      />,
    );
    fireEvent.change(await screen.findByLabelText("What should it say?"), {
      target: { value: "warm" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft in our voice" }));
    await waitFor(() =>
      expect(draft).toHaveBeenCalledWith(
        "#2PQRJ8LV",
        "r1",
        "warm",
        null,
        "leader_message",
      ),
    );
    expect(await screen.findByDisplayValue("Our way, in brief")).toBeTruthy();
    expect(screen.getByText(/Drafted by claude-sonnet-5/)).toBeTruthy();
    fireEvent.click(screen.getByText("Put back what I had"));
    expect(await screen.findByDisplayValue("How our clan runs")).toBeTruthy();
  });

  test("without the clan's key, there is no draft button", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({
        open: [
          {
            card_id: "r1",
            type: "rules_announcement",
            label: "Tell the clan how it runs",
            status: "proposed",
            can_act: true,
            audience: { kind: "leaders" },
            player_tag: null,
            raised_at: "2026-09-12T20:00:00Z",
            channel: "leader_message",
            copy: null,
            message: { title: "How our clan runs", body: "Hello." },
            evidence: { version: 1, changes: [] },
            log: [],
          },
        ],
      }),
    );
    renderWithProviders(
      <ActionDetail
        number={37}
        clan={clan}
        who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
      />,
    );
    await screen.findByDisplayValue("How our clan runs");
    expect(
      screen.queryByRole("button", { name: "Draft in our voice" }),
    ).toBeNull();
  });
});

describe("editable clan chat", () => {
  test("recording delivery locks the reviewed words and a lost reply unlocks without retrying", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({
        model: { set: true },
        open: [{ ...removal, type: "welcome", copy: "Welcome!" }],
      }),
    );
    let fail;
    const decide = vi.spyOn(manageApi, "decideAction").mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    renderWithProviders(
      <ActionDetail number={37} clan={clan} who={{ role: "leader" }} />,
    );
    const editor = await screen.findByLabelText("Chat message");
    fireEvent.change(editor, { target: { value: "My reviewed welcome" } });
    const welcomed = screen.getByRole("button", { name: "Welcomed" });
    fireEvent.click(welcomed);
    expect(editor.disabled).toBe(true);
    expect(welcomed.disabled).toBe(true);
    expect(
      screen.getByRole("button", { name: "Copy the chat message" }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Draft in our voice" }).disabled,
    ).toBe(true);
    expect(screen.getByLabelText("Draft tone").disabled).toBe(true);
    fail(new Error("lost reply"));
    await screen.findByText(/action's outcome is unknown.*check its log/);
    expect(editor.value).toBe("My reviewed welcome");
    expect(editor.disabled).toBe(false);
    expect(welcomed.disabled).toBe(false);
    expect(
      screen.getByRole("button", { name: "Draft in our voice" }).disabled,
    ).toBe(false);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  test("pending drafting locks the editor and an empty previous field can be restored", async () => {
    const decide = vi
      .spyOn(manageApi, "decideAction")
      .mockResolvedValue({ ok: true });
    const write = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText: write } });
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({
        model: { set: true },
        open: [{ ...removal, type: "welcome", copy: "Welcome!" }],
      }),
    );
    let reply;
    vi.spyOn(manageApi, "draftLeaderMessage").mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    renderWithProviders(
      <ActionDetail number={37} clan={clan} who={{ role: "leader" }} />,
    );
    const editor = await screen.findByLabelText("Chat message");
    fireEvent.change(editor, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Draft in our voice" }));
    expect(editor.disabled).toBe(true);
    expect(screen.getByLabelText("Draft tone").disabled).toBe(true);
    const copy = screen.getByRole("button", { name: "Copy the chat message" });
    const welcomed = screen.getByRole("button", { name: "Welcomed" });
    expect(copy.disabled).toBe(true);
    expect(welcomed.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Skip" }).disabled).toBe(true);
    fireEvent.click(copy);
    fireEvent.click(welcomed);
    expect(write).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    reply({ ok: true, data: { line: "Welcome aboard!", model: "stub" } });
    await screen.findByDisplayValue("Welcome aboard!");
    expect(editor.disabled).toBe(false);
    expect(copy.disabled).toBe(false);
    expect(welcomed.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Draft in our voice" }));
    expect(
      screen.getByRole("button", { name: "Put back what I had" }).disabled,
    ).toBe(true);
    reply({ ok: true, data: { line: "Second draft", model: "stub" } });
    await screen.findByDisplayValue("Second draft");
    fireEvent.click(
      screen.getByRole("button", { name: "Put back what I had" }),
    );
    expect(editor.value).toBe("Welcome aboard!");
    fireEvent.change(editor, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Draft in our voice" }));
    reply({ ok: true, data: { line: "Final draft", model: "stub" } });
    await screen.findByDisplayValue("Final draft");
    fireEvent.click(
      screen.getByRole("button", { name: "Put back what I had" }),
    );
    expect(editor.value).toBe("");
  });
  test("a leader edits a welcome, drafts and restores it, then records the words actually sent", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({
        model: { set: true, refused: false },
        open: [
          {
            ...removal,
            type: "welcome",
            label: "Welcome",
            audience: { kind: "elders" },
            copy: "Welcome, Sleepy!",
          },
        ],
      }),
    );
    const draft = vi.spyOn(manageApi, "draftLeaderMessage").mockResolvedValue({
      ok: true,
      data: { line: "Glad you joined, Sleepy!", model: "stub", warnings: [] },
    });
    const decide = vi
      .spyOn(manageApi, "decideAction")
      .mockResolvedValue({ ok: true, data: {} });
    renderWithProviders(
      <ActionDetail number={37} clan={clan} who={{ role: "coLeader" }} />,
    );
    fireEvent.change(await screen.findByLabelText("Chat message"), {
      target: { value: "Welcome aboard, Sleepy!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft in our voice" }));
    await screen.findByDisplayValue("Glad you joined, Sleepy!");
    expect(draft).toHaveBeenCalledWith("#2PQRJ8LV", "a1", null, null);
    expect(decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Put back what I had"));
    await screen.findByDisplayValue("Welcome aboard, Sleepy!");
    fireEvent.click(screen.getByRole("button", { name: "Welcomed" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("#2PQRJ8LV", "a1", {
        status: "done",
        reason: null,
        note: null,
        sent: { line: "Welcome aboard, Sleepy!" },
      }),
    );
  });

  test("a failed removal draft preserves edits and does not complete or automatically retry the action", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({ model: { set: true, refused: false } }),
    );
    const draft = vi
      .spyOn(manageApi, "draftLeaderMessage")
      .mockRejectedValue(new Error("lost reply"));
    const decide = vi
      .spyOn(manageApi, "decideAction")
      .mockResolvedValue({ ok: true });
    renderWithProviders(
      <ActionDetail number={37} clan={clan} who={{ role: "leader" }} />,
    );
    fireEvent.change(await screen.findByLabelText("Chat message"), {
      target: { value: "My own words" },
    });
    expect(screen.getByText(/Use this only after you decide/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Draft in our voice" }));
    await screen.findByText(/outcome is unknown.*words are unchanged/);
    expect(screen.getByDisplayValue("My own words")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Draft in our voice" }).disabled,
    ).toBe(false);
    expect(draft).toHaveBeenCalledTimes(1);
    expect(decide).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Complete" }).disabled).toBe(
      false,
    );
    expect(
      screen.getByRole("button", { name: "Copy the chat message" }).disabled,
    ).toBe(false);
  });

  test("an elder can edit a welcome but cannot use the clan's model", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({
        model: { set: true },
        open: [{ ...removal, type: "welcome", copy: "Welcome!" }],
      }),
    );
    renderWithProviders(
      <ActionDetail number={37} clan={clan} who={{ role: "elder" }} />,
    );
    await screen.findByLabelText("Chat message");
    expect(
      screen.queryByRole("button", { name: "Draft in our voice" }),
    ).toBeNull();
  });

  test("confirmed departure drafts bind to the classification and discard old words and late results", async () => {
    const action = {
      ...removal,
      type: "departure",
      status: "done",
      label: "Departure",
      can_act: false,
      can_draft: true,
      draft_context_version: "left-version",
      outcome: {
        classification: "member_left",
        verified_at: "2026-09-25T12:00:00Z",
      },
      copy: "Thanks for your time, Sleepy.",
    };
    const props = {
      action,
      clan,
      who: { role: "leader" },
      model: { set: true },
      reasons: [],
    };
    let finish;
    const draft = vi.spyOn(manageApi, "draftLeaderMessage").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const decide = vi.spyOn(manageApi, "decideAction");
    const { rerender } = renderWithProviders(<ActionCard {...props} />);
    fireEvent.change(screen.getByLabelText("Chat message"), {
      target: { value: "Old left words" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft in our voice" }));
    expect(draft).toHaveBeenCalledWith("#2PQRJ8LV", "a1", null, "left-version");
    expect(
      screen.getByRole("button", { name: "Copy the chat message" }).disabled,
    ).toBe(true);
    rerender(
      <ActionCard
        {...props}
        action={{
          ...action,
          draft_context_version: "kick-version",
          outcome: { classification: "member_kicked" },
          copy: "Wishing you well, Sleepy.",
        }}
      />,
    );
    expect(screen.getByDisplayValue("Wishing you well, Sleepy.")).toBeTruthy();
    await act(async () =>
      finish({
        ok: true,
        data: {
          line: "Stale left draft",
          model: "fake",
          draft_context_version: "left-version",
        },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Stale left draft")).toBeNull(),
    );
    expect(screen.queryByText("Put back what I had")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Kicked", exact: true }),
    ).toBeNull();
    expect(decide).not.toHaveBeenCalled();
    rerender(
      <ActionCard
        {...props}
        action={{
          ...action,
          status: "proposed",
          can_act: true,
          can_draft: false,
          draft_context_version: "unknown-version",
          outcome: null,
          copy: null,
        }}
      />,
    );
    expect(screen.queryByLabelText("Chat message")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Draft in our voice" }),
    ).toBeNull();
  });

  test("a context refusal withholds stale copy and restoration even when refreshing fails", async () => {
    const changed = vi.fn();
    const draft = vi
      .spyOn(manageApi, "draftLeaderMessage")
      .mockResolvedValueOnce({
        ok: true,
        data: { line: "Old draft", model: "fake" },
      })
      .mockResolvedValueOnce({ ok: false, data: { error: "draft_changed" } });
    renderWithProviders(
      <ActionCard
        action={{ ...removal, draft_context_version: "old" }}
        clan={clan}
        who={{ role: "leader" }}
        reasons={[]}
        model={{ set: true }}
        onChanged={changed}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Draft in our voice" }));
    await screen.findByDisplayValue("Old draft");
    expect(screen.getByText("Put back what I had")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Draft in our voice" }));
    await screen.findByText(/Older words are withheld/);
    expect(screen.queryByLabelText("Chat message")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Copy the chat message" }),
    ).toBeNull();
    expect(screen.queryByText("Put back what I had")).toBeNull();
    expect(screen.getByRole("button", { name: "Complete" }).disabled).toBe(
      true,
    );
    expect(changed).toHaveBeenCalledTimes(1);
    expect(draft).toHaveBeenCalledTimes(2);
  });
});

describe("you here", () => {
  test("a member sees their week, what the clan makes of it, and their time here", async () => {
    const { YouHere } = await import("../src/views/YouHere.jsx");
    vi.spyOn(manageApi, "memberView").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        clan_tag: "#2PQRJ8LV",
        clan_name: "Example Clan",
        as_of: "2026-09-12T19:58:00Z",
        freshness_seconds: 60,
        members: 24,
        min_members: 10,
        policy: { set: true, active: true },
        you: {
          player_tag: "#8QCV",
          name: "Sleepy",
          role: "member",
          this_week: {
            from: "2026-09-07T00:00:00Z",
            complete: false,
            battles: 10,
            ranked_battles: 2,
            donations: 100,
          },
          this_war_week: {
            season_id: 136,
            section_index: 0,
            open: true,
            decks: 8,
            decks_asked: null,
            points: 1600,
          },
          weeks: [
            {
              from: "2026-08-31T00:00:00Z",
              complete: true,
              battles: 20,
              ranked_battles: 0,
              donations: 200,
            },
            {
              from: "2026-09-07T00:00:00Z",
              complete: false,
              battles: 10,
              ranked_battles: 2,
              donations: 100,
            },
          ],
          war_weeks: [
            {
              season_id: 135,
              section_index: 4,
              is_colosseum: true,
              open: false,
              decks: 16,
              decks_asked: 16,
              points: 3200,
            },
            {
              season_id: 136,
              section_index: 0,
              is_colosseum: false,
              open: true,
              decks: 8,
              decks_asked: null,
              points: 1600,
            },
          ],
          trophies: 7000,
          time_here: {
            joined_observed_at: "2026-08-20T00:00:00Z",
            tenure_known: true,
            days: 23,
            recording_since: "2026-05-01T00:00:00Z",
            events: [],
          },
        },
        clan: {
          version: 1,
          goals: ["war"],
          counted: ["war", "donations"],
          ranks_elder: true,
          status: "participating",
          evidence: "100% war decks over 4 war weeks",
          next: ["5 more days in the clan before Elder consideration."],
          minimums: {
            set: { war: 1 },
            met: { war: true },
            passes: true,
            unknown: false,
            rule: "any",
            window_weeks: 2,
          },
          tenure_min_days: 28,
          inactivity: null,
        },
        open_actions: 1,
        hold: null,
        trophies: [],
      },
    });
    renderWithProviders(<YouHere clan={clan} navigate={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("How you are doing here")).toBeTruthy(),
    );
    expect(screen.getByText("Participating")).toBeTruthy();
    expect(screen.getByText(/5 more days in the clan/)).toBeTruthy();
    expect(screen.getByText(/23 of the 28 days/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /1 action waits for you/ }),
    ).toBeTruthy();
    const week = screen.getByRole("group", { name: "This week so far" });
    expect(week.textContent).toMatch(/War decks8Race 136\/0, four a war day/);
    // Ranked is not what this clan counts; donations are.
    expect(week.textContent).toMatch(/Ranked battles2Not counted here/);
    expect(week.textContent).toMatch(/Donations100Battles/);
    expect(
      screen.getByRole("img", {
        name: "Your war decks: 135/4 16 of 16, 136/0 8 so far",
      }),
    ).toBeTruthy();
    expect(screen.getByText("16 of 16 in the finished race.")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "16 of 16" })).toBeTruthy();
    expect(screen.getByText("135/4 · Colosseum")).toBeTruthy();
    expect(screen.getByText("This week, so far")).toBeTruthy();
    expect(screen.getByText(/Joined Aug 20: 23 days/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "How Elder works here ›" }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bcard\b/i);
  });
});

test("one update contains editable messages and explicit delivery progress; copying never completes it", async () => {
  let card = {
    ...removal,
    card_id: "update",
    number: 41,
    type: "awards_standings",
    channel: "leader_message",
    copy: null,
    label: "Share award standings",
    evidence: {
      scope: "current",
      season_id: 136,
      as_of: "2026-10-03T12:00:00Z",
      messages: [
        {
          part: 1,
          message: { title: "First", body: "Provisional first message." },
        },
        {
          part: 2,
          message: { title: "Second", body: "Provisional second message." },
        },
      ],
    },
  };
  vi.spyOn(manageApi, "action").mockImplementation(async () =>
    one({ open: [structuredClone(card)] }),
  );
  const write = vi.fn().mockResolvedValue();
  Object.assign(navigator, { clipboard: { writeText: write } });
  const sent = vi
    .spyOn(manageApi, "messageSent")
    .mockImplementation(async (_clan, _id, part, words) => {
      card = {
        ...card,
        messages_sent: [
          ...(card.messages_sent ?? []),
          {
            part,
            ...words,
            sent_at: "2026-10-03T12:01:00Z",
            sent_by_name: "Ada",
          },
        ],
      };
      return { ok: true, status: 200, data: card };
    });
  const decide = vi
    .spyOn(manageApi, "decideAction")
    .mockResolvedValue({ ok: true, status: 200, data: {} });
  renderWithProviders(
    <ActionDetail
      number={41}
      clan={clan}
      who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
    />,
  );
  const complete = await screen.findByRole("button", {
    name: "Complete update",
  });
  expect(complete.disabled).toBe(true);
  fireEvent.click(
    screen.getAllByRole("button", { name: "Copy the message" })[0],
  );
  await waitFor(() => expect(write).toHaveBeenCalled());
  expect(sent).not.toHaveBeenCalled();
  expect(decide).not.toHaveBeenCalled();
  expect(
    screen.getByText(/Each part has its own delivery choice/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Mark message 1 sent" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Mark message 1 sent" }),
    ).toBeNull(),
  );
  expect(complete.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Mark message 2 sent" }));
  await waitFor(() => expect(complete.disabled).toBe(false));
  fireEvent.click(complete);
  await waitFor(() => expect(decide).toHaveBeenCalled());
});

describe("reopening declined actions", () => {
  test("a lost response retries the same request; pending clicks do not duplicate it and success refreshes History", async () => {
    let card = {
      ...removal,
      status: "declined",
      can_act: false,
      can_reopen: true,
      decided_at: "2026-10-03T12:00:00Z",
      decline_reason: "not_now",
      decision_note: "Waited for context.",
      log: [
        {
          entry_id: "decline",
          kind: "declined",
          at: "2026-10-03T12:00:00Z",
          text: "Waited for context.",
          by: { name: "Ada", role: "leader" },
        },
      ],
    };
    vi.spyOn(manageApi, "action").mockImplementation(async () =>
      one({ open: [structuredClone(card)] }),
    );
    let finish;
    const reopen = vi
      .spyOn(manageApi, "reopenAction")
      .mockRejectedValueOnce(new Error("lost reply"))
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const decide = vi.spyOn(manageApi, "decideAction");
    const { queryClient } = renderWithProviders(
      <ActionDetail number={37} clan={clan} who={{ role: "leader" }} />,
    );
    queryClient.setQueryData(keys.history(clan.clan_tag), { cards: [card] });
    const button = await screen.findByRole("button", { name: "Reopen action" });
    fireEvent.click(button);
    await screen.findByText(/Reopening was not confirmed/);
    const first = reopen.mock.calls[0][2];
    expect(first.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.expected_decided_at).toBe(card.decided_at);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(reopen).toHaveBeenCalledTimes(2);
    expect(button.disabled).toBe(true);
    expect(reopen.mock.calls[1][2]).toEqual(first);
    card = {
      ...card,
      status: "proposed",
      can_act: true,
      can_reopen: false,
      log: [
        ...card.log,
        {
          entry_id: "reopen",
          kind: "reopened",
          at: "2026-10-03T12:01:00Z",
          text: "Reopened for review.",
          by: { name: "Ada", role: "leader" },
        },
      ],
    };
    finish({ ok: true, status: 200, data: card });
    await screen.findByRole("button", { name: "Complete" });
    expect(screen.queryByRole("button", { name: "Reopen action" })).toBeNull();
    expect(screen.getByText("Waited for context.")).toBeTruthy();
    expect(screen.getByText("Reopened for review.")).toBeTruthy();
    expect(
      queryClient.getQueryState(keys.history(clan.clan_tag)).isInvalidated,
    ).toBe(true);
    expect(decide).not.toHaveBeenCalled();
  });

  test("an elder cannot reopen a declined action when the server denies capability", async () => {
    vi.spyOn(manageApi, "action").mockResolvedValue(
      one({
        open: [
          { ...removal, status: "declined", can_act: false, can_reopen: false },
        ],
      }),
    );
    renderWithProviders(
      <ActionDetail number={37} clan={clan} who={{ role: "elder" }} />,
    );
    await screen.findByText("Declined");
    expect(screen.queryByRole("button", { name: "Reopen action" })).toBeNull();
  });
});

test("changing acting player loads that player's own words and restores the first player's buffer", () => {
  const action = {
    ...removal,
    type: "rules_announcement",
    channel: "clan_chat",
    draft_context_version: "frozen",
    evidence: { message: { title: "Rules", body: "Reviewed rules." } },
  };
  action.delivery = actionDelivery(action, { fresh: true });
  const props = { action, clan, who: { player_tag: "#FIRST", role: "leader" } };
  const { rerender } = renderWithProviders(<ActionCard {...props} />);
  fireEvent.change(screen.getByLabelText("Chat message"), {
    target: { value: "First player's edits" },
  });
  rerender(
    <ActionCard {...props} who={{ player_tag: "#SECOND", role: "coLeader" }} />,
  );
  expect(screen.queryByDisplayValue("First player's edits")).toBeNull();
  fireEvent.change(screen.getByLabelText("Chat message"), {
    target: { value: "Second player's edits" },
  });
  rerender(<ActionCard {...props} />);
  expect(screen.getByDisplayValue("First player's edits")).toBeTruthy();
  expect(screen.queryByDisplayValue("Second player's edits")).toBeNull();
});
