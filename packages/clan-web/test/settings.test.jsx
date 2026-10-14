import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { Settings } from "../src/views/Settings.jsx";
import { manageApi } from "../src/api.js";
import { renderWithProviders } from "./helpers.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const clan = { clan_tag: "#2PQRJ8LV", role: "leader" };
// These summaries must not turn a configured but unavailable key into success.
for (const [state, text] of [
  [{ set: false }, "Not connected"],
  [{ refused_at: "2026-10-13T12:00:00Z" }, "Needs attention · Key refused"],
  [{ readable: false }, "Needs attention · Key unavailable"],
  [{ owner_leads: false }, "Not in use · Key owner no longer leads"],
  [{ cap_reached: true }, "Paused · Monthly model limit reached"],
  [
    {
      purposes: { recruit: { label: "Recruit" } },
      model_for: { recruit: null },
    },
    "Needs attention · Some model uses unavailable",
  ],
  [
    { models_refresh_error: { at: "2026-10-13T12:00:00Z" } },
    "Needs attention · Model check failed",
  ],
])
  test(`model summary: ${text}`, async () => {
    vi.spyOn(manageApi, "social").mockResolvedValue({
      ok: true,
      data: { enabled: false },
    });
    vi.spyOn(manageApi, "discord").mockResolvedValue({
      ok: true,
      data: { set: false },
    });
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      data: {
        set: true,
        readable: true,
        owner_leads: true,
        usable: true,
        ...state,
      },
    });
    renderWithProviders(<Settings clan={clan} />);
    const row = screen
      .getByRole("heading", { name: "Clan model", exact: true })
      .closest(".settings-row");
    expect(await within(row).findByText(text)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    // Opening a row is just a read; the server still owns saving it.
    fireEvent.click(screen.getByRole("button", { name: "Manage Member map" }));
    expect(screen.getByRole("dialog", { name: "Member map" })).toBeTruthy();
  });
