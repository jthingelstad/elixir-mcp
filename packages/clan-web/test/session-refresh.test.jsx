import { useEffect } from "react";
import { test, expect, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import { resetSessionCache } from "@elixir-mcp/client";
import { renderWithProviders } from "./helpers.jsx";
import { useRoster, keys } from "../src/lib/queries.js";
import { api } from "../src/api.js";

test("a forced roster refresh from the prior session cannot repopulate the next person's cache", async () => {
  let finish;
  const oldReply = new Promise((r) => {
    finish = r;
  });
  vi.spyOn(api, "roster").mockImplementation((tag, force) =>
    force
      ? oldReply
      : Promise.resolve({
          ok: true,
          status: 200,
          data: { name: "old person roster" },
        }),
  );
  let load;
  function View() {
    const refresh = useRoster("#P0LYQ").load;
    useEffect(() => {
      load = refresh;
    }, [refresh]);
    return null;
  }
  const { queryClient } = renderWithProviders(<View />);
  await waitFor(() =>
    expect(queryClient.getQueryData(keys.roster("#P0LYQ"))).toBeTruthy(),
  );
  let pending;
  act(() => {
    pending = load(true);
  });
  await act(async () => {
    await resetSessionCache(queryClient);
  });
  const next = {
    ok: true,
    status: 200,
    data: { name: "next person's roster" },
  };
  queryClient.setQueryData(keys.roster("#P0LYQ"), next);
  await act(async () => {
    finish({
      ok: true,
      status: 200,
      data: { name: "late prior person's roster" },
    });
    await pending;
  });
  expect(queryClient.getQueryData(keys.roster("#P0LYQ"))).toEqual(next);
  cleanup();
  vi.restoreAllMocks();
});
