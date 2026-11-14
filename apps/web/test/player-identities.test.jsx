import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlayerName } from "@elixir-mcp/ui";
import { PlayerIdentities } from "../src/lib/PlayerIdentities.jsx";
afterEach(cleanup);
const TAG = "#00C298UC";
const data = (verified) => ({ player_verifications: { [TAG]: verified } });
test("current response proof updates names; clearing or changing the app cache cannot keep another session's badge", () => {
  const client = new QueryClient();
  client.setQueryData(["me", "people"], data(true), { updatedAt: 10 });
  const draw = (cache) => (
    <QueryClientProvider client={cache}>
      <PlayerIdentities>
        <PlayerName tag={TAG}>Ada</PlayerName>
      </PlayerIdentities>
    </QueryClientProvider>
  );
  const { rerender } = render(draw(client));
  expect(screen.queryByRole("img", { name: "Verified player" })).not.toBeNull();
  act(() =>
    client.setQueryData(
      ["me", "player"],
      { data: data(false) },
      { updatedAt: 20 },
    ),
  );
  expect(screen.queryByRole("img", { name: "Verified player" })).toBeNull();
  act(() =>
    client.setQueryData(
      ["me", "feed"],
      { pages: [data(true)] },
      { updatedAt: 30 },
    ),
  );
  expect(screen.queryByRole("img", { name: "Verified player" })).not.toBeNull();
  act(() => client.clear());
  expect(screen.queryByRole("img", { name: "Verified player" })).toBeNull();
  rerender(draw(new QueryClient()));
  expect(screen.queryByRole("img", { name: "Verified player" })).toBeNull();
});
