import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  cleanup,
  screen,
  fireEvent,
  within,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { PairGames } from "../src/home/PairGames.jsx";
import { PLAYER_LANDED_KEYS, makeOwnRefresh } from "../src/lib/own-refresh.js";

const FRIEND = "#0PGQ2UYL",
  OWN = "#0RJ29CVY",
  ALT = "#0PLUG2V9";
const response = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const meta = {
  state: "ready",
  selected_player: OWN,
  own_players: [
    { tag: OWN, name: "Reader" },
    { tag: ALT, name: "Other own player" },
  ],
  modes: [
    { key: "casual", teamed: 1, against: 0 },
    { key: "ladder", teamed: 0, against: 1 },
  ],
};
beforeEach(() => cleanup());
afterEach(() => vi.restoreAllMocks());

test("a pair view selects one owned player and mode, with actual member battle links", async () => {
  const calls = [];
  global.fetch = vi.fn(async (path) => {
    const url = new URL(String(path), "https://example.test");
    calls.push(url);
    if (!url.searchParams.has("side"))
      return response(
        url.searchParams.get("as") === ALT
          ? { ...meta, selected_player: ALT, modes: [] }
          : meta,
      );
    const casual = url.searchParams.get("mode") === "casual";
    return response({
      battles: [
        {
          battle_id: casual ? "a" : "b",
          at: "2026-11-18T10:00:00Z",
          outcome: casual ? "win" : "loss",
          url: casual ? "/battle/aaaaaaaaaaaa" : "/battle/bbbbbbbbbbbb",
        },
      ],
      next_before: null,
    });
  });
  renderWithProviders(<PairGames tag={FRIEND} />);
  await screen.findByRole("link", { name: /Won/ });
  expect(screen.getByRole("link", { name: /Won/ }).getAttribute("href")).toBe(
    "/battle/aaaaaaaaaaaa",
  );
  expect(
    within(screen.getByRole("region", { name: "Played against" })).getByText(
      "None recorded in this mode.",
    ),
  ).toBeTruthy();
  expect(
    calls.filter((u) => u.searchParams.get("side") === "against"),
  ).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Mode"), {
    target: { value: "ladder" },
  });
  await screen.findByRole("link", { name: /Lost/ });
  expect(screen.queryByRole("link", { name: /Won/ })).toBeNull();
  expect(calls.at(-1).searchParams.get("mode")).toBe("ladder");
  fireEvent.change(screen.getByLabelText("Your player"), {
    target: { value: ALT },
  });
  await screen.findByText("No shared battles recorded");
  expect(screen.queryByRole("link", { name: /Lost/ })).toBeNull();
  expect(calls.at(-1).searchParams.get("as")).toBe(ALT);
});

test("missing pair evidence is unknown, while verification is a separate state", async () => {
  global.fetch = vi.fn(async () => response({ ...meta, modes: [] }));
  const first = renderWithProviders(<PairGames tag={FRIEND} />);
  await screen.findByText("No shared battles recorded");
  expect(screen.getByText(/A battle it did not read is not here/)).toBeTruthy();
  expect(screen.queryByText(/never played/i)).toBeNull();
  first.unmount();
  global.fetch = vi.fn(async () =>
    response({ state: "verify", own_players: [], modes: [] }),
  );
  renderWithProviders(<PairGames tag={FRIEND} />);
  await screen.findByRole("link", { name: "Verify your player" });
  expect(screen.queryByText("No shared battles recorded")).toBeNull();
});

test("a failed pair read is not an empty record and can retry", async () => {
  let up = false;
  global.fetch = vi.fn(async () =>
    up ? response({ ...meta, modes: [] }) : response({ error: "down" }, 503),
  );
  renderWithProviders(<PairGames tag={FRIEND} />);
  await screen.findByText("Your games together could not be read just now");
  expect(screen.queryByText("No shared battles recorded")).toBeNull();
  up = true;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("No shared battles recorded");
});

test.each(
  [
    ["account", undefined],
    ["player", PLAYER_LANDED_KEYS],
  ].flatMap(([lane, landedKeys]) =>
    ["queued", "fresh"].map((completion) => ({ lane, landedKeys, completion })),
  ),
)(
  "$lane $completion completion refreshes Together's count and rows",
  async ({ landedKeys, completion }) => {
    let landed = false;
    const calls = [];
    global.fetch = vi.fn(async (path) => {
      const q = new URL(String(path), "https://example.test").searchParams;
      calls.push(q.has("side") ? "rows" : "summary");
      if (!q.has("side"))
        return response({
          ...meta,
          own_players: [{ tag: OWN, name: "Reader" }],
          modes: [{ key: "casual", teamed: landed ? 2 : 1, against: 0 }],
        });
      return response({
        battles: [
          {
            battle_id: "a",
            at: "2026-11-18T10:00:00Z",
            outcome: "win",
            url: "/battle/aaaaaaaaaaaa",
          },
          ...(landed
            ? [
                {
                  battle_id: "b",
                  at: "2026-11-18T10:05:00Z",
                  outcome: "loss",
                  url: "/battle/bbbbbbbbbbbb",
                },
              ]
            : []),
        ],
        next_before: null,
      });
    });
    const { queryClient } = renderWithProviders(<PairGames tag={FRIEND} />);
    queryClient.setQueryData(["cards"], { readable: true });
    queryClient.setQueryData(["me", "unrelated"], { readable: true });
    await screen.findByRole("link", { name: /Won/ });
    expect(screen.queryByRole("link", { name: /Lost/ })).toBeNull();
    const refresher = makeOwnRefresh({
      ask: async () => ({
        ok: true,
        data: {
          queued: completion === "queued",
          players: [{ state: completion, retry_after_s: 5 }],
        },
      }),
      status: async () => ({
        ok: true,
        data: { players: [{ pending: false }], feed_current: true },
      }),
      landedKeys,
      invalidate: (queryKey) => queryClient.invalidateQueries({ queryKey }),
      wait: async () => {},
      hidden: () => false,
    });
    landed = true;
    await act(() => refresher.ask({ asked: true }));
    await screen.findByRole("link", { name: /Lost/ });
    expect(screen.getByText("2 battles")).toBeTruthy();
    expect(refresher.snapshot().outcome).toBe("updated");
    expect(calls.filter((kind) => kind === "summary")).toHaveLength(2);
    expect(calls.filter((kind) => kind === "rows")).toHaveLength(2);
    expect(queryClient.getQueryState(["cards"]).isInvalidated).toBe(false);
    expect(queryClient.getQueryState(["me", "unrelated"]).isInvalidated).toBe(
      false,
    );
  },
);

test("Together tells the dated change from teammates to opponents for an alt", async () => {
  const modes = [
    {
      key: "casual",
      teamed: 3,
      against: 0,
      days: [{ day: "2026-11-14", teamed: true, count: 3, wins: 3 }],
    },
    {
      key: "ladder",
      teamed: 0,
      against: 1,
      days: [{ day: "2026-11-15", teamed: false, count: 1, wins: 0 }],
    },
  ];
  global.fetch = vi.fn(async (u) => {
    const q = new URL(String(u), "https://elixir.test").searchParams;
    return response(
      q.has("side")
        ? { battles: [], next_before: null }
        : { ...meta, selected_player: ALT, modes },
    );
  });
  renderWithProviders(<PairGames tag={FRIEND} initialAs={ALT} />);
  expect(
    await screen.findByText(
      /won 3 .* together on Saturday.*then played 1 .* against each other on Sunday/,
    ),
  ).toBeTruthy();
  expect(screen.getByLabelText("Your player").value).toBe(ALT);
});
