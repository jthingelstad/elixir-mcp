import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { ZoneProvider } from "@elixir-mcp/ui";
import { renderWithProviders } from "./helpers.jsx";
import { ZoneOffer } from "../src/components/ZoneOffer.jsx";
import { api } from "../src/api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const browserIn = (timeZone) => {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
    function () {
      return { ...real.call(this), timeZone };
    },
  );
};

test("an account with no zone is told its times are UTC and offered the browser's, saved only on the click", async () => {
  browserIn("America/Chicago");
  const save = vi
    .spyOn(api, "setTimezone")
    .mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
  renderWithProviders(<ZoneOffer />);
  expect(screen.getByText(/Times here are in UTC/)).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use Central time" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("America/Chicago"));
});

test("nothing to offer: the account has a zone, or the browser is on UTC", () => {
  browserIn("America/Chicago");
  renderWithProviders(
    <ZoneProvider zone="Europe/Paris">
      <ZoneOffer />
    </ZoneProvider>,
  );
  expect(screen.queryByText(/Times here are in UTC/)).toBeNull();
  cleanup();
  vi.restoreAllMocks();
  browserIn("UTC");
  renderWithProviders(<ZoneOffer />);
  expect(screen.queryByText(/Times here are in UTC/)).toBeNull();
});
