import { test, expect, vi, afterEach } from "vitest";
import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Tracking } from "../src/views/account/Tracking.jsx";
import { TrackedRecord } from "../src/views/account/TrackedRecord.jsx";
import { Overview } from "../src/views/account/Overview.jsx";
import { keys } from "../src/lib/queries.js";

const me = { claims: [], recordings: [], entitlements: {}, role: "member" };
const clan = {
  clan_tag: "#2PQRJ8LV",
  name: "Saved example clan",
  scope: "activity",
  recording_status: "active",
};
const views = [
  ["Tracking", Tracking, {}],
  ["clan record", TrackedRecord, { tag: "2PQRJ8LV" }],
  ["Overview", Overview, {}],
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

for (const [name, View, props] of views) {
  for (const warm of [false, true]) {
    test(`${name} distinguishes ${warm ? "a failed refresh with retained clans" : "a failed first read"} from no tracking and retries only the read`, async () => {
      let failed = !warm;
      const fetch = vi.fn(async (path) => {
        const bad = path === "/api/me/clans" && failed;
        const body =
          path === "/api/me/clans"
            ? bad
              ? { error: "unavailable" }
              : { clans: [clan], home_clan: null }
            : path === "/api/me/first-answer"
              ? {
                  player: null,
                  clan: null,
                  connection: {
                    active_connections: 0,
                    last_data_read_at: null,
                  },
                }
              : { today_calls: 0, quota_max: 100 };
        return {
          ok: !bad,
          status: bad ? 503 : 200,
          text: async () => JSON.stringify(body),
        };
      });
      vi.stubGlobal("fetch", fetch);
      const { queryClient } = renderWithProviders(
        <View {...props} me={me} refresh={vi.fn()} navigate={vi.fn()} />,
      );
      if (warm) {
        await screen.findByText(clan.name, { exact: true });
        failed = true;
        await queryClient.invalidateQueries({ queryKey: keys.clans });
      }
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Your clans could not be read",
      );
      expect(screen.queryByText("Nothing tracked yet")).toBeNull();
      expect(screen.queryByText("You are not tracking that")).toBeNull();
      if (warm)
        expect(screen.getByText(clan.name, { exact: true })).toBeTruthy();
      failed = false;
      fireEvent.click(
        screen.getByRole("button", { name: "Try again", exact: true }),
      );
      await screen.findByText(clan.name, { exact: true });
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      expect(
        fetch.mock.calls.every(
          ([, init]) => !init?.method || init.method === "GET",
        ),
      ).toBe(true);
    });
  }
}
