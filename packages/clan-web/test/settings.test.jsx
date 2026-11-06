import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { VoiceSetting } from "../src/views/VoiceSetting.jsx";
import { manageApi } from "../src/api.js";
import { renderWithProviders } from "./helpers.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const clan = { clan_tag: "#2PQRJ8LV", role: "leader" };

// How our messages sound (2026-10-20, call 5): one voice, set by leaders and
// co-leaders, its bound said beside the box. Synthetic words.
function voiceRead(voice) {
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

test("a leader sets the voice: the bound is said and held, the words go as typed, and the server's refusal is shown", async () => {
  voiceRead("Saved voice");
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
  const { container } = renderWithProviders(<VoiceSetting clan={clan} />);
  const page = within(container);
  const box = await page.findByLabelText("How our messages sound");
  expect(box.value).toBe("Saved voice");
  expect(box.getAttribute("maxLength")).toBe("400");
  expect(
    page.getByText(
      /^11\/400\. At most 400 characters, one paragraph, no links or mentions\./,
    ),
  ).toBeTruthy();
  expect(page.getByText(/never the facts/)).toBeTruthy();
  const save = page.getByRole("button", { name: "Save the voice" });
  expect(save.disabled).toBe(true);
  fireEvent.change(box, { target: { value: "Short and loud" } });
  expect(page.getByText(/^14\/400\./)).toBeTruthy();
  fireEvent.click(save);
  expect(await page.findByText("Keep it to 400 characters.")).toBeTruthy();
  fireEvent.click(save);
  await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
  expect(set).toHaveBeenNthCalledWith(2, clan.clan_tag, "Short and loud");
  expect(screen.queryByRole("dialog")).toBeNull();
});
