import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ConnectionQuestions } from "../src/components/ConnectionQuestions.jsx";

const player = {
  player_tag: "#P0Y",
  name: "Test player",
  profile_available: true,
  battles_7d: 12,
  battles_30d: 24,
  battles_previous_7d: 8,
  distinct_decks_7d: 2,
};
function respond(p = player, clan = null, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      text: async () =>
        JSON.stringify({
          player: p,
          clan,
          connection: { active_connections: 1 },
        }),
    })),
  );
}
beforeEach(() => {
  respond();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("connected users can copy data-supported questions, including a recorded clan war", async () => {
  respond(player, { clan_tag: "#P0G" });
  const copy = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: copy },
  });
  render(<ConnectionQuestions navigate={vi.fn()} />);
  await screen.findByText(/AI client you connected/);
  expect(
    screen.getAllByRole("button", { name: /^Copy question:/ }),
  ).toHaveLength(4);
  fireEvent.click(
    screen.getByRole("button", { name: "Copy question: Compare your decks" }),
  );
  await screen.findByText("Copied — paste into your connected client.");
  expect(copy.mock.calls[0][0]).toContain("#P0Y");
  expect(copy.mock.calls[0][0]).toContain("sample sizes");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Copy question: Review your clan's war week",
    }),
  );
  await screen.findByText("Copied — paste into your connected client.");
  expect(copy.mock.calls[1][0]).toContain("#P0G");
  expect(copy.mock.calls[1][0]).toContain("unfinished race");
  expect(
    fetch.mock.calls.every(([url]) => url === "/api/me/first-answer"),
  ).toBe(true);
});

test("profile-only history offers a snapshot, with manual copy when clipboard access fails", async () => {
  respond({
    ...player,
    battles_7d: 0,
    battles_30d: 0,
    battles_previous_7d: 0,
    distinct_decks_7d: 0,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  render(<ConnectionQuestions navigate={vi.fn()} />);
  const button = await screen.findByRole("button", {
    name: "Copy question: Start with your player snapshot",
  });
  expect(
    screen.getAllByRole("button", { name: /^Copy question:/ }),
  ).toHaveLength(1);
  fireEvent.click(button);
  const manual = await screen.findByRole("textbox", {
    name: "Question to copy",
  });
  expect(manual.value).toContain("#P0Y");
  expect(manual.value).toContain(
    "Do not infer progress from a single snapshot",
  );
});

test("no player links to setup; pending capture can be refreshed into questions", async () => {
  respond(null);
  const navigate = vi.fn();
  render(<ConnectionQuestions navigate={navigate} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Add your player" }),
  );
  expect(navigate).toHaveBeenCalledWith("/account/overview");
  expect(screen.queryByRole("button", { name: /^Copy question:/ })).toBeNull();
  respond({
    ...player,
    profile_available: false,
    battles_7d: 0,
    battles_30d: 0,
    battles_previous_7d: 0,
    distinct_decks_7d: 0,
  });
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByText(/Waiting for the first capture for/);
  expect(screen.queryByRole("button", { name: /^Copy question:/ })).toBeNull();
  respond();
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByRole("button", {
    name: "Copy question: Review your recorded battles",
  });
});

test("readiness errors offer a retry without invented questions", async () => {
  respond(null, null, false);
  render(<ConnectionQuestions navigate={vi.fn()} />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: /^Copy question:/ })).toBeNull();
  respond();
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByRole("button", {
    name: "Copy question: Review your recorded battles",
  });
  expect(screen.queryByRole("alert")).toBeNull();
});
