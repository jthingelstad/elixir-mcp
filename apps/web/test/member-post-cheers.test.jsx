import { test, expect, vi, afterEach } from "vitest";
import {
  screen,
  fireEvent,
  cleanup,
  waitFor,
  renderHook,
  act,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./helpers.jsx";
import { createQueryClient } from "../src/client/index.ts";
import { api } from "../src/api.js";
import { MemberPostPage } from "../src/views/SharedItem.jsx";
import { HOME_FEED_KEY, memberPostKey, useCheer } from "../src/lib/queries.js";
import { withMyCheer } from "../src/home/cheer-set.js";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original()),
  useParams: () => ({ id: "41" }),
  useSearch: () => ({}),
}));
const KEY = memberPostKey("41");
const ITEM = {
  id: "tl_0123456789abcdef0041",
  kind: "post",
  at: "2026-11-17T12:00:00.000Z",
  subject_tag: "#0PGQ2UYL",
  subjects: [{ kind: "player", tag: "#0PGQ2UYL", name: "Invented Ada" }],
  cheers: {},
  my_cheer: null,
  post: {
    id: "41",
    text: "Which card fits this deck?",
    question: true,
    cards: [],
    deck: null,
    mine: false,
    author: { player_tag: "#0PGQ2UYL", name: "Invented Ada" },
  },
};
const ok = (data) => ({ ok: true, status: 200, data });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("the member destination updates count and selection, then sends null to take its cheer back", async () => {
  vi.spyOn(api, "memberPost").mockResolvedValue(ok({ item: ITEM }));
  const sent = [];
  vi.spyOn(api, "cheer").mockImplementation(async ({ cheer }) => {
    sent.push(cheer);
    return ok({ cheers: cheer ? { [cheer]: 1 } : {}, my_cheer: cheer });
  });
  const { queryClient } = renderWithProviders(<MemberPostPage />);
  const button = () => screen.getByRole("button", { name: /^Cheer(ed)?: / });
  fireEvent.click(await screen.findByRole("button", { name: /^Cheer(ed)?: / }));
  await waitFor(() =>
    expect(button().getAttribute("aria-pressed")).toBe("true"),
  );
  expect(queryClient.getQueryData(KEY).data.item.cheers).toEqual({
    well_played: 1,
  });
  expect(queryClient.getQueryData(KEY).data.item.my_cheer).toBe("well_played");
  fireEvent.click(button());
  await waitFor(() => expect(sent).toEqual(["well_played", null]));
  await waitFor(() =>
    expect(button().getAttribute("aria-pressed")).toBe("false"),
  );
  expect(queryClient.getQueryData(KEY).data.item.cheers).toEqual({});
  expect(queryClient.getQueryData(KEY).data.item.my_cheer).toBeNull();
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));
});

test("a cheer confirmed from another surface updates the answered member item as well as post lists", async () => {
  const client = createQueryClient();
  client.setQueryData(KEY, ok({ item: ITEM }));
  const list = ["me", "posts", "player", "#0PGQ2UYL"];
  client.setQueryData(list, { posts: [ITEM] });
  client.setQueryData(HOME_FEED_KEY, {
    pages: [{ timeline: [ITEM] }],
    pageParams: [null],
  });
  const sent = [];
  vi.spyOn(api, "cheer").mockImplementation(async ({ cheer }) => {
    sent.push(cheer);
    return ok({ cheers: cheer ? { [cheer]: 1 } : {}, my_cheer: cheer });
  });
  const { result } = renderHook(() => useCheer(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await result.current.mutateAsync({
      item: ITEM,
      next: "well_played",
      shown: withMyCheer(ITEM, "well_played"),
    });
  });
  expect(client.getQueryData(KEY).data.item.my_cheer).toBe("well_played");
  expect(client.getQueryData(KEY).data.item.cheers).toEqual({ well_played: 1 });
  expect(client.getQueryData(list).posts[0].my_cheer).toBe("well_played");
  const updated = client.getQueryData(KEY).data.item;
  await act(async () => {
    await result.current.mutateAsync({
      item: updated,
      next: null,
      shown: withMyCheer(updated, null),
    });
  });
  expect(sent).toEqual(["well_played", null]);
  expect(client.getQueryData(KEY).data.item.my_cheer).toBeNull();
  expect(client.getQueryData(KEY).data.item.cheers).toEqual({});
});
