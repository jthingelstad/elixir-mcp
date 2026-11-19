import { test, expect, vi, afterEach } from "vitest";
import {
  act,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { api } from "../src/api.js";
import { keys, postsKey, usePosts } from "../src/lib/queries.js";
import { BattlePosts } from "../src/views/BattlePosts.jsx";
import { renderWithProviders } from "./helpers.jsx";

/**
 * The battle page's post panel (#762; a highlight until 0292, a post with
 * a battle attached since): it shows only what the server answered about
 * who may post, words are optional, and words are text, never markup.
 */
const BATTLE = { id: "ccd04012bda8" };
const SIDES = [
  { players: [{ player_tag: "#0CR", name: '<b>"Ana"</b>' }] },
  { players: [{ player_tag: "#08C", name: "Bo" }] },
];
const ok = (data) => ({ ok: true, status: 200, data });
const item = (post) => ({
  id: "tl_00000000000000000001",
  kind: "post",
  subject_tag: "#0CR",
  post: {
    id: "41",
    text: "",
    battle: { battle_id: "ccd04012bda8" },
    share_url: null,
    status: undefined,
    ...post,
  },
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("nothing is drawn when the server names no player of yours", async () => {
  const read = vi
    .spyOn(api, "postsOnBattle")
    .mockResolvedValue(ok({ battle_id: "x", can_post_as: [], posts: [] }));
  const { container } = renderWithProviders(
    <BattlePosts battle={BATTLE} sides={SIDES} />,
  );
  await waitFor(() => expect(read).toHaveBeenCalledWith("ccd04012bda8"));
  expect(container.textContent).toBe("");
});

test("a verified player of yours posts about the battle, words optional, from the primary action", async () => {
  vi.spyOn(api, "postsOnBattle").mockResolvedValue(
    ok({ battle_id: "x", can_post_as: ["#0CR"], posts: [] }),
  );
  const post = vi.spyOn(api, "writeBattlePost").mockResolvedValue({
    ok: true,
    status: 201,
    data: { post: item() },
  });
  renderWithProviders(<BattlePosts battle={BATTLE} sides={SIDES} />);
  const button = await screen.findByRole("button", { name: "Post" });
  expect(button.className).toContain("btn--primary");
  // The player's name is text in the sentence, quotes and markup and all.
  expect(screen.getByText(/<b>"Ana"<\/b>’s timeline/)).toBeTruthy();
  // As quick as a highlight was: no words needed.
  fireEvent.click(button);
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith({
      battle: "ccd04012bda8",
      player_tag: "#0CR",
      text: "",
    }),
  );
  fireEvent.change(screen.getByLabelText("Your words (optional)"), {
    target: { value: "Finally beat the cycle deck" },
  });
  fireEvent.click(button);
  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith({
      battle: "ccd04012bda8",
      player_tag: "#0CR",
      text: "Finally beat the cycle deck",
    }),
  );
});

test("posting from a battle refreshes a previously opened player page", async () => {
  const player = { player: "#0CR" };
  let posts = [];
  const list = vi
    .spyOn(api, "posts")
    .mockImplementation(async () => ok({ posts }));
  vi.spyOn(api, "postsOnBattle").mockImplementation(async () =>
    ok({ battle_id: BATTLE.id, can_post_as: ["#0CR"], posts }),
  );
  vi.spyOn(api, "writeBattlePost").mockImplementation(async () => {
    posts = [item({ text: "One more game" })];
    return ok({ post: posts[0] });
  });
  function PlayerPosts() {
    const query = usePosts(player);
    return query.data ? (
      <p>
        {query.data.posts.map((it) => it.post.text).join() || "No posts yet"}
      </p>
    ) : null;
  }
  const { rerender, queryClient } = renderWithProviders(<PlayerPosts />);
  await screen.findByText("No posts yet");
  rerender(<BattlePosts battle={BATTLE} sides={SIDES} />);
  queryClient.setQueryData(keys.feed, { timeline: [] });
  fireEvent.click(await screen.findByRole("button", { name: "Post" }));
  await screen.findByText("“One more game”");
  expect(queryClient.getQueryState(keys.feed).isInvalidated).toBe(true);
  rerender(<PlayerPosts />);
  await screen.findByText("One more game");
  expect(list).toHaveBeenCalledTimes(2);
  expect(queryClient.getQueryData(postsKey(player)).posts).toEqual(posts);
});

test("a posted one shows its words as text, with Share and Edit words", async () => {
  vi.spyOn(api, "postsOnBattle").mockResolvedValue(
    ok({
      battle_id: "x",
      can_post_as: ["#0CR"],
      posts: [item({ text: "<img src=x onerror=alert(1)>" })],
    }),
  );
  const { container } = renderWithProviders(
    <BattlePosts battle={BATTLE} sides={SIDES} />,
  );
  await screen.findByRole("button", { name: "Share" });
  expect(screen.getByRole("button", { name: "Edit words" })).toBeTruthy();
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  // The words lead (G9): they come before where they went, Share and Edit
  // words are ordinary small buttons, and Delete is a quiet link.
  const text = container.textContent;
  expect(text.indexOf("<img src=x")).toBeLessThan(text.indexOf("timeline"));
  for (const name of ["Share", "Edit words"]) {
    expect(screen.getByRole("button", { name }).className).toContain("btn--sm");
    expect(screen.getByRole("button", { name }).className).not.toMatch(
      /btn--primary|btn--gold|btn--danger/,
    );
  }
  expect(screen.getByRole("button", { name: "Delete" }).className).toContain(
    "link",
  );
  // One per player per battle: no second compose for the same player.
  expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
});

test("a post without words says so, and its words can be added", async () => {
  vi.spyOn(api, "postsOnBattle").mockResolvedValue(
    ok({ battle_id: "x", can_post_as: ["#0CR"], posts: [item()] }),
  );
  const edit = vi
    .spyOn(api, "editPost")
    .mockResolvedValue(ok({ post: item({ text: "gg" }), changed: true }));
  renderWithProviders(<BattlePosts battle={BATTLE} sides={SIDES} />);
  expect(await screen.findByText("No words, just the battle.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit words" }));
  fireEvent.change(screen.getByLabelText("Your words"), {
    target: { value: "gg" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save words" }));
  await waitFor(() => expect(edit).toHaveBeenCalledWith("41", "gg"));
});

const SHARED = {
  id: "42",
  text: "gg",
  share_url: "https://elixir.poapkings.com/share/abcdefghijklmnopqrstuvwx",
};

test("a shared post offers its clan's Discord only when the server says so, and asks first", async () => {
  vi.spyOn(api, "postsOnBattle").mockResolvedValue(
    ok({
      battle_id: "x",
      can_post_as: ["#0CR"],
      posts: [
        item({
          ...SHARED,
          clan_discord: { available: true, posted_at: null },
        }),
      ],
    }),
  );
  const post = vi
    .spyOn(api, "postToClanDiscord")
    .mockResolvedValue(
      ok({ posted_at: "2026-11-13T00:00:00Z", already: false }),
    );
  renderWithProviders(<BattlePosts battle={BATTLE} sides={SIDES} />);
  const trigger = await screen.findByRole("button", {
    name: "Post in your clan’s Discord",
  });
  // An additive act: a plain small button, never gold or red.
  expect(trigger.className).toBe("btn btn--sm");
  fireEvent.click(trigger);
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Post" }));
  await waitFor(() => expect(post).toHaveBeenCalledWith("42"));
});

test("a post already in the clan's Discord says so; one the clan does not take offers nothing", async () => {
  vi.spyOn(api, "postsOnBattle").mockResolvedValue(
    ok({
      battle_id: "x",
      can_post_as: ["#0CR"],
      posts: [
        item({
          ...SHARED,
          clan_discord: { available: false, posted_at: "2026-11-13T00:00:00Z" },
        }),
      ],
    }),
  );
  renderWithProviders(<BattlePosts battle={BATTLE} sides={SIDES} />);
  expect(
    await screen.findByText("Posted in your clan’s Discord."),
  ).toBeTruthy();
  cleanup();
  vi.spyOn(api, "postsOnBattle").mockResolvedValue(
    ok({
      battle_id: "x",
      can_post_as: ["#0CR"],
      posts: [
        item({
          ...SHARED,
          clan_discord: { available: false, posted_at: null },
        }),
      ],
    }),
  );
  renderWithProviders(<BattlePosts battle={BATTLE} sides={SIDES} />);
  await screen.findByText("“gg”");
  expect(
    screen.queryByRole("button", { name: "Post in your clan’s Discord" }),
  ).toBeNull();
});

test("a failed battle post read offers a retry and recovers the composer", async () => {
  const read = vi
    .spyOn(api, "postsOnBattle")
    .mockResolvedValueOnce({ ok: false, status: 503, data: {} })
    .mockResolvedValue(ok({ can_post_as: ["#0CR"], posts: [] }));
  renderWithProviders(<BattlePosts battle={BATTLE} sides={SIDES} />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Post" })).toBeTruthy();
  expect(read).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a temporary refresh error keeps battle post words, and a later unavailable battle closes the panel", async () => {
  const read = vi
    .spyOn(api, "postsOnBattle")
    .mockResolvedValue(ok({ can_post_as: ["#0CR"], posts: [] }));
  const { queryClient, container } = renderWithProviders(
    <BattlePosts battle={BATTLE} sides={SIDES} />,
  );
  const words = await screen.findByLabelText("Your words (optional)");
  fireEvent.change(words, { target: { value: "One more game" } });
  read.mockResolvedValueOnce({
    ok: false,
    status: 429,
    data: { message: "Try again later." },
  });
  await act(() =>
    queryClient.invalidateQueries({ queryKey: keys.battlePosts(BATTLE.id) }),
  );
  expect(await screen.findByText("Try again later.")).toBeTruthy();
  expect(screen.getByLabelText("Your words (optional)").value).toBe(
    "One more game",
  );
  read.mockResolvedValueOnce({
    ok: false,
    status: 404,
    data: { error: "not_found" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(container.textContent).toBe(""));
});

test("a deck trial credits the author only after the member chooses it, and still waits for Post", async () => {
  const before = window.location.href;
  try {
    window.history.replaceState(
      {},
      "",
      "/battle/ccd04012bda8?as=%230CR&deck_post=41#tried-deck",
    );
    vi.spyOn(api, "postsOnBattle").mockResolvedValue(
      ok({ battle_id: BATTLE.id, can_post_as: ["#0CR"], posts: [] }),
    );
    const proof = vi
      .spyOn(api, "trial")
      .mockResolvedValue(
        ok({
          match: {
            battle_id: BATTLE.id,
            player_tag: "#0CR",
            source: { path: "/home/post/41", name: "Rowan" },
          },
        }),
      );
    const publish = vi
      .spyOn(api, "writeBattlePost")
      .mockResolvedValue(ok({ post: item() }));
    renderWithProviders(<BattlePosts battle={BATTLE} sides={SIDES} />);
    const button = await screen.findByRole("button", { name: "Credit Rowan" });
    expect(proof).toHaveBeenCalledWith("41", BATTLE.id);
    expect(
      screen
        .getByRole("link", { name: "The deck shared by Rowan" })
        .getAttribute("href"),
    ).toBe("/home/post/41");
    fireEvent.click(button);
    expect(screen.getByLabelText("Your words (optional)").value).toBe(
      "I tried Rowan’s deck.",
    );
    expect(publish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Post", exact: true }));
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith({
        battle: BATTLE.id,
        player_tag: "#0CR",
        text: "I tried Rowan’s deck.",
      }),
    );
  } finally {
    window.history.replaceState({}, "", before);
  }
});
