import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { PlayerBattleShare } from "../src/views/PlayerBattleShare.jsx";

const URL = "https://elixir.poapkings.com/battle/ccd04012bda8";
let copy;
beforeEach(() => {
  copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function open(words = "My first close win after returning.") {
  render(<PlayerBattleShare url={URL} players="Player against Opponent" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Share with your context" }),
  );
  fireEvent.change(screen.getByLabelText(/Why did this battle matter/), {
    target: { value: words },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview message" }));
}

test("context leads the explicit message, with only the canonical battle link", async () => {
  window.history.replaceState({}, "", "/battle/alias?token=private#unrelated");
  open();
  const message = screen.getByLabelText("Message preview").value;
  expect(message).toBe(
    `Why this mattered to me\nMy first close win after returning.\n\nPlayer against Opponent — Clash Royale battle\n${URL}`,
  );
  expect(message).not.toContain("private");
  fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
  expect(await screen.findByText("Message copied.")).toBeTruthy();
  expect(copy).toHaveBeenCalledWith(message);
  expect(screen.queryByRole("button", { name: "Share message" })).toBeNull();
});

test("back preserves exact words, cancel clears them, blank context adds no invented intent", () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: "Back to edit" }));
  expect(screen.getByLabelText(/Why did this battle matter/).value).toBe(
    "My first close win after returning.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Share with your context" }),
  );
  expect(screen.getByLabelText(/Why did this battle matter/).value).toBe("");
  expect(screen.getByLabelText(/Why did this battle matter/).maxLength).toBe(
    500,
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview message" }));
  expect(screen.getByLabelText("Message preview").value).toBe(
    `Player against Opponent — Clash Royale battle\n${URL}`,
  );
});

test("failed and unavailable clipboard leaves a selectable preview and a manual retry", async () => {
  copy.mockRejectedValueOnce(new Error("permission"));
  open("<script>Only my typed words</script>");
  fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Copy did not finish",
  );
  expect(screen.getByLabelText("Message preview").value).toContain(
    "<script>Only my typed words</script>",
  );
  expect(document.querySelector("script")).toBeNull();
  expect(screen.queryByText("Message copied.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
  expect(await screen.findByText("Message copied.")).toBeTruthy();
  navigator.clipboard = null;
  fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Select the message below",
  );
});

test("pending repeated copy sends one message and keeps transitions disabled", async () => {
  let done;
  copy.mockImplementation(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  open();
  const button = screen.getByRole("button", { name: "Copy message" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(copy).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Back to edit" }).disabled).toBe(
    true,
  );
  done();
  expect(await screen.findByText("Message copied.")).toBeTruthy();
});

test("native share cancellation keeps the preview and a later share includes explicit context", async () => {
  const share = vi
    .fn()
    .mockRejectedValueOnce(new DOMException("Canceled", "AbortError"))
    .mockResolvedValue(undefined);
  navigator.share = share;
  open("This was my comeback.");
  fireEvent.click(screen.getByRole("button", { name: "Share message" }));
  expect(await screen.findByText(/Share canceled/)).toBeTruthy();
  expect(screen.getByLabelText("Message preview").value).toContain(
    "This was my comeback.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Share message" }));
  expect(await screen.findByText("Shared.")).toBeTruthy();
  expect(share.mock.calls[1][0]).toEqual({
    title: "Player against Opponent — Clash Royale battle",
    text: "Why this mattered to me\nThis was my comeback.\n\nPlayer against Opponent — Clash Royale battle",
    url: URL,
  });
  expect(copy).not.toHaveBeenCalled();
});

test("native share interruption never claims success or automatically repeats", async () => {
  navigator.share = vi.fn().mockRejectedValue(new Error("unavailable"));
  open();
  fireEvent.click(screen.getByRole("button", { name: "Share message" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Sharing did not finish",
  );
  await waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Shared.")).toBeNull();
});

test.each([
  null,
  "https://other.example/battle/ccd04012bda8",
  `${URL}?token=private`,
  `${URL}#context=private`,
])("missing or noncanonical URL offers no composer: %s", (url) => {
  render(<PlayerBattleShare url={url} players="Player against Opponent" />);
  expect(screen.queryByRole("button")).toBeNull();
});
