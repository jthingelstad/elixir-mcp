import { afterEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "../src/client/index.ts";
import { BringClanmates } from "../src/components/BringClanmates.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CLANS = {
  clans: [{ clan_tag: "#2CLAN", name: "Fixture Clan" }],
  home_clan: { clan_tag: "#2CLAN", name: "Fixture Clan" },
  slots: {},
};

function show(clans) {
  const fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(clans),
  }));
  vi.stubGlobal("fetch", fetch);
  const client = createQueryClient();
  render(
    <QueryClientProvider client={client}>
      <BringClanmates />
    </QueryClientProvider>,
  );
  return { fetch, client };
}

test("bring your clanmates: named for the clan, a chat line within 200, the plain signup link", async () => {
  show(CLANS);
  const panel = (
    await screen.findByText("Invite clanmates", { exact: true })
  ).closest("details");
  fireEvent.click(panel.querySelector("summary"));
  expect(panel.textContent).toContain("Anyone in Fixture Clan who signs up");
  const chat = within(panel)
    .getByRole("button", { name: "Copy the line for clan chat" })
    .closest("div");
  expect(chat.textContent).toContain("the Fixture Clan week");
  expect(chat.textContent.length).toBeLessThanOrEqual(200);
  const note = within(panel)
    .getByRole("button", { name: "Copy the message" })
    .closest("div");
  expect(note.textContent).toContain(
    "https://elixir.poapkings.com/signin?signup",
  );
});

test("with no clan there is nothing to invite to", async () => {
  const { fetch, client } = show({ ...CLANS, home_clan: null });
  // Nothing drawn before the clans read answers proves nothing: wait for
  // the read to have answered and the query to settle, then let React
  // take the result, and only then look.
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(() => new Promise((r) => setTimeout(r, 0)));
  expect(client.getQueryCache().getAll()[0]?.state.status).toBe("success");
  expect(screen.queryByText("Invite clanmates", { exact: true })).toBe(null);
});
