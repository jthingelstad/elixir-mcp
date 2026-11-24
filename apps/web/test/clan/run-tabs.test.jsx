/**
 * Run's tabs (the Run redesign, 2026-11-24): To do, Members, Exceptions,
 * Rules and Setup across the top; each page fails on its own, in plain
 * words with Try again, and the tabs stay. Synthetic names only.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { renderWithProviders } from "./helpers.jsx";
import { Run } from "../../src/clan/views/Run.jsx";
import {
  PanelBoundary,
  ReadError,
  troubleOf,
} from "../../src/clan/components/ReadError.jsx";
import { manageApi } from "../../src/clan/api.js";
import { FIELDS, GROUPS, TABS, defaults } from "@elixir-mcp/clan-engine";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual()),
  useBlocker: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ok = (data) => ({ ok: true, status: 200, data });
const clan = {
  clan_tag: "#0QC8RCGY",
  name: "Example Clan",
  role: "leader",
  verified: true,
};
const me = { policy: { active: true }, open_actions: 3 };
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
const exceptions = [
  // Set by a leader: counted.
  {
    id: 1,
    kind: "away",
    player_tag: "#0Q2L8",
    set_by: "#0YY9P",
    name: "Invented A",
  },
  // A member's own away: not counted.
  {
    id: 2,
    kind: "away",
    player_tag: "#0C2C8",
    set_by: "#0C2C8",
    name: "Invented B",
  },
];

/** Run, walking its pages as the router would; `went` records each move. */
function Walk({ first, went = () => {} }) {
  const [section, setSection] = useState(first);
  return (
    <Run
      clan={clan}
      me={me}
      section={section}
      navigate={(to, options) => {
        went(to, options);
        setSection(to.split("/run/")[1] ?? null);
      }}
    />
  );
}

function reads({ actions = ok({ actions: [], decided: [] }) } = {}) {
  vi.spyOn(manageApi, "run").mockResolvedValue(ok({ leader: true }));
  vi.spyOn(manageApi, "policy").mockResolvedValue(ok(view));
  vi.spyOn(manageApi, "exceptions").mockResolvedValue(
    ok({ leader: true, exceptions }),
  );
  return vi.spyOn(manageApi, "actions").mockResolvedValue(actions);
}

const tabs = () => screen.getByRole("navigation", { name: "Run" });
const tab = (name) =>
  within(tabs())
    .getAllByRole("link")
    .find((a) => a.textContent.startsWith(name));

describe("Run's tabs", () => {
  test("five tabs; To do is first, open, and counts what waits", async () => {
    reads();
    renderWithProviders(<Walk first={null} />);
    const labels = within(tabs())
      .getAllByRole("link")
      .map((a) => a.firstChild.textContent);
    expect(labels).toEqual([
      "To do",
      "Members",
      "Exceptions",
      "Rules",
      "Setup",
    ]);
    expect(tab("To do").getAttribute("href")).toBe("/clan/0QC8RCGY/run");
    expect(tab("To do").getAttribute("aria-current")).toBe("page");
    expect(tab("To do").textContent).toBe("To do3 waiting");
    expect(tab("Setup").getAttribute("href")).toBe("/clan/0QC8RCGY/run/setup");
    expect(screen.getByRole("heading", { name: "To do" })).toBeTruthy();
    // The Exceptions count is the ones a leader set.
    await waitFor(() =>
      expect(tab("Exceptions").textContent).toBe("Exceptions1 set by leaders"),
    );
  });

  test("To do holds Waiting and Decided; Decided is a page of its own", async () => {
    reads();
    renderWithProviders(<Walk first={null} />);
    const lists = screen.getByRole("navigation", { name: "To do" });
    const waiting = within(lists).getByRole("link", { name: "Waiting" });
    expect(waiting.getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(lists).getByRole("link", { name: "Decided" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("navigation", { name: "To do" }))
          .getByRole("link", { name: "Decided" })
          .getAttribute("aria-current"),
      ).toBe("page"),
    );
    // Still the To do tab.
    expect(tab("To do").getAttribute("aria-current")).toBe("page");
  });

  test("Setup lists its pages, and each one leads back to Setup", async () => {
    reads();
    vi.spyOn(manageApi, "discord").mockResolvedValue(ok({ connected: false }));
    renderWithProviders(<Walk first="setup" />);
    expect(tab("Setup").getAttribute("aria-current")).toBe("page");
    const list = screen.getByRole("navigation", { name: "Setup" });
    const rows = within(list)
      .getAllByRole("link")
      .map((a) => [a.getAttribute("href"), a.textContent]);
    expect(rows.map(([href]) => href)).toEqual([
      "/clan/0QC8RCGY/run/awards-setup",
      "/clan/0QC8RCGY/run/discord",
      "/clan/0QC8RCGY/run/model-voice",
      "/clan/0QC8RCGY/run/settings",
    ]);
    expect(rows[1][1]).toMatch(/^Discord/);
    fireEvent.click(within(list).getByRole("link", { name: /^Discord/ }));
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "Setup" }).length).toBe(2),
    );
    const back = document.querySelector(".clan-run__up");
    expect(back.textContent).toBe("Setup");
    expect(back.getAttribute("href")).toBe("/clan/0QC8RCGY/run/setup");
    // The tab still says Setup.
    expect(tab("Setup").getAttribute("aria-current")).toBe("page");
  });

  test("old addresses forward: Review to Members, an unknown page to To do", async () => {
    reads();
    vi.spyOn(manageApi, "manage").mockResolvedValue(
      ok({ members: [], counts: {} }),
    );
    const went = vi.fn();
    renderWithProviders(<Walk first="review" went={went} />);
    await waitFor(() =>
      expect(went).toHaveBeenCalledWith("/clan/0QC8RCGY/run/members", {
        replace: true,
      }),
    );
    cleanup();
    const went2 = vi.fn();
    renderWithProviders(<Walk first="nothing-here" went={went2} />);
    await waitFor(() =>
      expect(went2).toHaveBeenCalledWith("/clan/0QC8RCGY/run", {
        replace: true,
      }),
    );
  });
});

describe("one page fails on its own", () => {
  test("a slow Actions read says so in its place; the tabs stay", async () => {
    const read = reads({
      actions: { ok: false, status: 504, data: { error: "timeout" } },
    });
    renderWithProviders(<Walk first={null} />);
    expect(await screen.findByText("Elixir was slow")).toBeTruthy();
    expect(
      screen.getByText("Actions didn’t load in time. Nothing is lost."),
    ).toBeTruthy();
    expect(tabs()).toBeTruthy();
    expect(screen.getByRole("heading", { name: "To do" })).toBeTruthy();
    const before = read.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
  });

  // Codex on #1240: the decisions are the leaders' record, so a refusal
  // hides what was cached; a slow read keeps it on the page.
  test.each([
    [401, "You're signed out", false],
    [403, "Not yours to see", false],
    [504, null, true],
  ])(
    "a Decided read answered %i after a good one: kept only if not refused",
    async (status, says, kept) => {
      reads();
      const card = {
        card_id: "c1",
        number: 7,
        label: "Invented decision",
        status: "done",
        raised_at: new Date().toISOString(),
        decided_at: new Date().toISOString(),
        log: [],
      };
      const history = vi
        .spyOn(manageApi, "history")
        .mockResolvedValue(ok({ cards: [card] }));
      const { queryClient } = renderWithProviders(<Walk first="decided" />);
      expect(await screen.findByText("Invented decision")).toBeTruthy();
      history.mockResolvedValue({
        ok: false,
        status,
        data: { error: status === 504 ? "timeout" : "refused" },
      });
      await queryClient.refetchQueries({ queryKey: ["me", "clan"] });
      await waitFor(() => expect(history.mock.calls.length).toBeGreaterThan(1));
      if (kept) {
        expect(screen.getByText("Invented decision")).toBeTruthy();
      } else {
        expect(await screen.findByText(says)).toBeTruthy();
        expect(screen.queryByText("Invented decision")).toBeNull();
      }
      expect(tabs()).toBeTruthy();
    },
  );

  test("a rules read that fails leaves the other tabs working", async () => {
    reads();
    manageApi.policy.mockRejectedValue(
      Object.assign(new Error("network"), { transport: "network" }),
    );
    renderWithProviders(<Walk first="rules" />);
    expect(await screen.findByText("Can't reach Elixir")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rules" })).toBeTruthy();
    fireEvent.click(tab("To do"));
    expect(await screen.findByRole("heading", { name: "To do" })).toBeTruthy();
  });

  test("a page that breaks while drawing fails alone, with Try again", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let broken = true;
    function Panel() {
      if (broken) throw new Error("boom");
      return <p>Drawn</p>;
    }
    render(
      <div>
        <nav aria-label="Run">tabs</nav>
        <PanelBoundary what="Discord">
          <Panel />
        </PanelBoundary>
      </div>,
    );
    expect(screen.getByText("Discord didn't load")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Run" })).toBeTruthy();
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(screen.getByText("Drawn")).toBeTruthy();
  });
});

describe("the words for a failed read", () => {
  test("troubleOf names the cause", () => {
    expect(troubleOf({ signedOut: true })).toBe("signedOut");
    expect(troubleOf({ status: 401 })).toBe("signedOut");
    expect(troubleOf({ forbidden: "leaders_only" })).toBe("forbidden");
    expect(troubleOf({ error: "timeout" })).toBe("slow");
    expect(troubleOf({ error: "bad_response" })).toBe("slow");
    expect(troubleOf({ error: "unavailable" })).toBe("slow");
    expect(troubleOf({ failed: { status: 502, message: "upstream" } })).toBe(
      "slow",
    );
    expect(troubleOf({ failed: { transport: "network" } })).toBe("offline");
    expect(troubleOf({ error: "internal" })).toBe("failed");
    expect(troubleOf(null)).toBe("failed");
  });

  test("each cause reads in plain words; retry only where it helps", () => {
    const retry = vi.fn();
    const { rerender } = render(
      <ReadError
        what="Actions"
        failure={{ error: "internal" }}
        onRetry={retry}
      />,
    );
    expect(screen.getByText("Actions didn't load")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(
      <ReadError
        what="Actions"
        failure={{ forbidden: true }}
        onRetry={retry}
      />,
    );
    expect(screen.getByText("Not yours to see")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
    rerender(
      <ReadError
        what="Actions"
        failure={{ signedOut: true }}
        onRetry={retry}
      />,
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    // No em dashes in any of it.
    expect(document.body.textContent).not.toMatch(/—/);
  });
});
