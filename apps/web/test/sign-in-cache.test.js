import { test, expect } from "vitest";
import {
  createQueryClient,
  resetSessionCache,
  sessionGeneration,
} from "@elixir-mcp/client";

test("a new identity cannot reuse old feedback, admin or owned-agent data, even from an outstanding read", async () => {
  const client = createQueryClient();
  client.setQueryData(["me"], { data: { authenticated: false } });
  for (const key of [
    ["me", "clan", "feedback"],
    ["admin", "feedback"],
    ["agent", "old", "claims"],
  ])
    client.setQueryData(key, { private: "previous person" });
  let finish;
  const slow = client
    .fetchQuery({
      queryKey: ["me", "clan", "late"],
      queryFn: () =>
        new Promise((r) => {
          finish = r;
        }),
    })
    .catch(() => null);
  const oldGeneration = sessionGeneration(client);
  await resetSessionCache(client);
  expect(sessionGeneration(client)).not.toBe(oldGeneration);
  finish({ private: "previous person late" });
  await slow;
  expect(
    client
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey),
  ).toEqual([["me"]]);
  let reads = 0;
  const next = await client.fetchQuery({
    queryKey: ["me", "clan", "feedback"],
    queryFn: async () => {
      reads++;
      return { private: "next person" };
    },
  });
  expect(reads).toBe(1);
  expect(next.private).toBe("next person");
  client.clear();
});
