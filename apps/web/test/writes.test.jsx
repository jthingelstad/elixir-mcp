import { test, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient, useWrite } from "@elixir-mcp/client";
import { WriteError, writeErrorText } from "@elixir-mcp/ui";

/**
 * Writes (review 2026-09-27 §7.5). 21 of the console's 58 awaited
 * `api.*` calls threw the `{ ok, status, data }` envelope away, among
 * them revoke key, suspend agent, sign out everywhere, revoke session,
 * disconnect client and approve access: a refused write looked exactly
 * like one that worked.
 */
const src = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src",
);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory()
      ? walk(p)
      : /\.[jt]sx?$/.test(name)
        ? [p]
        : [];
  });
}

test("no console call awaits an api write and drops its answer", () => {
  // A statement that IS the await: nothing reads the envelope. Assigned
  // (`const r = await api.x()`) or unwrapped (`unwrap(await ...)`) is
  // read; a write goes through useWrite, which reads it for you.
  const bare = [];
  for (const file of walk(src)) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/await\s+api\.\w+\(/g)) {
      const before = source.slice(0, m.index).trimEnd();
      if (/(^|[;{})>]|\belse)$/.test(before))
        bare.push(
          `${path.relative(src, file)}:${source.slice(0, m.index).split("\n").length}`,
        );
    }
  }
  expect(bare, `bare api awaits: ${bare.join(", ")}`).toEqual([]);
});

function wrapper(client) {
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

test("a refused write is an error, and nothing is refetched over it", async () => {
  const client = createQueryClient();
  const refetch = vi.spyOn(client, "invalidateQueries");
  const call = vi.fn(async () => ({
    ok: false,
    status: 409,
    data: { error: "primary_in_use", message: "Choose a new primary first." },
  }));
  const { result } = renderHook(
    () => useWrite(call, { invalidate: [["me"]] }),
    { wrapper: wrapper(client) },
  );
  let answer;
  await act(async () => {
    answer = await result.current.run("#ABC");
  });
  expect(call).toHaveBeenCalledWith("#ABC");
  expect(answer.ok).toBe(false);
  expect(answer.error.status).toBe(409);
  // The hook's state follows on the next notify.
  await waitFor(() => expect(result.current.error?.status).toBe(409));
  expect(writeErrorText(result.current.error)).toBe(
    "Choose a new primary first.",
  );
  expect(refetch).not.toHaveBeenCalled();
});

test("a write that took refetches what it names, and clears on reset", async () => {
  const client = createQueryClient();
  const refetch = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(
    () =>
      useWrite(async () => ({ ok: true, status: 200, data: { done: 1 } }), {
        invalidate: [["me", "sessions"]],
      }),
    { wrapper: wrapper(client) },
  );
  let answer;
  await act(async () => {
    answer = await result.current.run();
  });
  expect(answer).toEqual({ ok: true, data: { done: 1 } });
  expect(refetch).toHaveBeenCalledWith({ queryKey: ["me", "sessions"] });
  expect(result.current.error).toBeNull();
});

test("a call that throws is a failed write, never an unhandled rejection", async () => {
  const client = createQueryClient();
  const { result } = renderHook(
    () =>
      useWrite(async () => {
        throw new TypeError("Failed to fetch");
      }),
    { wrapper: wrapper(client) },
  );
  let answer;
  await act(async () => {
    answer = await result.current.run();
  });
  expect(answer.ok).toBe(false);
  expect(answer.error.transport).toBe("network");
});

test("WriteError says what happened, in one sentence, as an alert", () => {
  const { rerender } = render(<WriteError error={null} />);
  expect(screen.queryByRole("alert")).toBeNull();
  rerender(<WriteError error={{ status: 0, transport: "timeout" }} />);
  expect(screen.getByRole("alert").textContent).toMatch(
    /may or may not have taken effect/,
  );
  rerender(<WriteError error={{ status: 0, transport: "network" }} />);
  expect(screen.getByRole("alert").textContent).toMatch(/nothing was changed/);
  rerender(
    <WriteError error={{ status: 403, data: { error: "forbidden" } }} />,
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "That was refused (HTTP 403).",
  );
  rerender(<WriteError error={{ status: 503, data: {} }} />);
  expect(screen.getByRole("alert").textContent).toMatch(/HTTP 503/);
});
