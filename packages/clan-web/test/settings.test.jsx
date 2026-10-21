import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    vi.spyOn(manageApi, "voice").mockResolvedValue({
      ok: true,
      data: { voice: "", max: 400 },
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

// How our messages sound (2026-10-20, call 5): one voice, set here by
// leaders and co-leaders, its bound said beside the box. Synthetic words.
function voiceRow(voice) {
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
    data: { set: false },
  });
  return vi.spyOn(manageApi, "voice").mockResolvedValue({
    ok: true,
    data: {
      clan_tag: clan.clan_tag,
      voice,
      max: 400,
      set_by_name: voice ? "Ada" : null,
      set_at: voice ? "2026-10-20T12:00:00Z" : null,
    },
  });
}

test("voice summary: not set, or the leaders' words in short", async () => {
  voiceRow("");
  renderWithProviders(<Settings clan={clan} />);
  const row = () =>
    screen
      .getByRole("heading", { name: "How our messages sound" })
      .closest(".settings-row");
  expect(
    await within(row()).findByText(
      "Not set · Used by drafts and the Discord editor",
    ),
  ).toBeTruthy();
  cleanup();
  vi.restoreAllMocks();
  voiceRow(`Warm and a little cheeky; ${"cheer the wins ".repeat(6)}`);
  renderWithProviders(<Settings clan={clan} />);
  expect(
    await within(row()).findByText(
      /^“Warm and a little cheeky; cheer the wins cheer the wins…” · Used by drafts and the Discord editor$/,
    ),
  ).toBeTruthy();
});

test("a leader sets the voice: the bound is said and held, the words go as typed, and the server's refusal is shown", async () => {
  voiceRow("Saved voice");
  const set = vi
    .spyOn(manageApi, "setVoice")
    .mockResolvedValueOnce({
      ok: false,
      status: 400,
      data: {
        error: "voice_too_long",
        max: 400,
        message: "Keep it to 400 characters.",
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { voice: "Short and loud", max: 400 },
    });
  renderWithProviders(<Settings clan={clan} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Manage How our messages sound",
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "How our messages sound" });
  const box = await within(dialog).findByLabelText("How our messages sound");
  expect(box.value).toBe("Saved voice");
  expect(box.getAttribute("maxLength")).toBe("400");
  expect(
    within(dialog).getByText(
      /^11\/400\. At most 400 characters, one paragraph, no links or mentions\./,
    ),
  ).toBeTruthy();
  expect(within(dialog).getByText(/never the facts/)).toBeTruthy();
  expect(within(dialog).getByText(/Last set by Ada · 2026-10-20/)).toBeTruthy();
  const save = within(dialog).getByRole("button", { name: "Save the voice" });
  expect(save.disabled).toBe(true);
  fireEvent.change(box, { target: { value: "Short and loud" } });
  expect(within(dialog).getByText(/^14\/400\./)).toBeTruthy();
  fireEvent.click(save);
  expect(
    await within(dialog).findByText("Keep it to 400 characters."),
  ).toBeTruthy();
  fireEvent.click(save);
  await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
  expect(set).toHaveBeenNthCalledWith(2, clan.clan_tag, "Short and loud");
});
