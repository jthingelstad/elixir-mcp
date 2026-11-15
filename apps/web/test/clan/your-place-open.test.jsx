/**
 * Your place opens on each new opening request, not only the first:
 * Profile stays mounted while its hash leaves #place and comes back
 * (Back), and the picker opens again (Codex on #1028).
 */
import { test, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { YourPlace } from "../../src/clan/views/YourPlace.jsx";
import { renderWithProviders } from "./helpers.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("a new opening request opens the picker again", async () => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ place: null }),
    text: async () => JSON.stringify({ place: null }),
  }));
  const { rerender } = renderWithProviders(<YourPlace setting open />);
  await screen.findByLabelText("Country");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await screen.findByText("Not set");
  rerender(<YourPlace setting open={false} />);
  expect(screen.queryByLabelText("Country")).toBeNull();
  rerender(<YourPlace setting open />);
  expect(await screen.findByLabelText("Country")).toBeTruthy();
});
