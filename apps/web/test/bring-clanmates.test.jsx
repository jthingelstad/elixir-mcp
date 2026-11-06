import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@elixir-mcp/client";
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(clans),
    })),
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <BringClanmates />
    </QueryClientProvider>,
  );
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
  show({ ...CLANS, home_clan: null });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText("Invite clanmates", { exact: true })).toBe(null);
});
