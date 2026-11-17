/**
 * Posts (2026-11-17): nothing draws while posts are off or for a person
 * with no Verified player; a pasted deck link becomes the deck and leaves
 * the words; a refusal says why and keeps the words; a post's words are
 * plain text, never links or markup; a question says so and takes
 * answers. Invented players only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  screen,
  fireEvent,
  waitFor,
  cleanup,
  renderHook,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "./helpers.jsx";
import { createQueryClient } from "../src/client/index.ts";
import { useCommentsChanged } from "../src/lib/queries.js";
import { PostComposer } from "../src/home/Post.jsx";
import { FeedItem } from "../src/home/FeedItem.jsx";
import { PostList } from "../src/home/PostList.jsx";
import {
  POST_MAX,
  averageElixir,
  canPost,
  postsOn,
  readDraft,
} from "../src/home/post-set.js";

const IDS = [
  26000000, 26000001, 26000010, 26000014, 27000000, 28000000, 28000008,
  26000021,
];
const LINK = `https://link.clashroyale.com/en/?clashroyale://copyDeck?deck=${IDS.join(";")}&tt=159000000`;

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let calls;
beforeEach(() => {
  cleanup();
  calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const VERIFIED = [
  {
    player_tag: "#0PGQ2UYL",
    status: "verified",
    is_primary: true,
    relationship: "primary",
  },
];
const ME = ({ posts = true, claims = VERIFIED } = {}) => ({
  authenticated: true,
  account_id: "a1",
  features: { comments: true, posts },
  claims,
});

function serve(me, write = null) {
  global.fetch = vi.fn(async (p, init = {}) => {
    const url = String(p);
    calls.push({ path: url, method: init.method ?? "GET", body: init.body });
    if (url === "/api/me") return reply(me);
    if (url === "/api/public/cards")
      return reply({
        cards: IDS.map((id, i) => ({
          id,
          name: `Card ${i + 1}`,
          elixir_cost: 3,
        })),
      });
    if (url === "/api/me/posts" && write) return write(init);
    return reply({}, 404);
  });
}

const POST = (extra = {}) => ({
  id: "tl_0123456789abcdef0abc",
  kind: "post",
  at: "2026-11-17T12:00:00.000Z",
  sort_at: "2026-11-17T12:00:00.000Z",
  subject_tag: "#0PGQ2UYL",
  subjects: [{ kind: "player", tag: "#0PGQ2UYL", name: "Ada" }],
  text: "x",
  comments: { count: 0, latest: [], open: true },
  post: {
    id: "7",
    text: "Is this good? https://example.com <b>bold</b>",
    question: true,
    deck: {
      cards: IDS.map((id, i) => ({
        id,
        name: `Card ${i + 1}`,
        elixir_cost: 3,
      })),
      tower_troop: { id: 159000000, name: "Tower Princess" },
      label: "Hog Rider cycle",
      average_elixir: 3,
      copy_link: LINK,
    },
    cards: [],
    author: { account_id: "p1", player_tag: "#0PGQ2UYL", name: "Ada" },
    mine: false,
    can_delete: false,
    can_report: true,
    can_block: true,
  },
  ...extra,
});

test("the composer's rules follow the server's", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migration = readFileSync(
    path.resolve(here, "../../../db/migrations/0285_posts.sql"),
    "utf8",
  );
  expect(POST_MAX).toBe(500);
  expect(migration).toContain("char_length(body) between 1 and 500");
  expect(postsOn({ features: { posts: true, comments: true } }, null)).toBe(
    true,
  );
  expect(postsOn({ features: { posts: true, comments: false } }, null)).toBe(
    false,
  );
  expect(postsOn({ features: { posts: true, comments: true } }, "agent")).toBe(
    false,
  );
  expect(canPost({ claims: VERIFIED })).toBe(true);
  expect(canPost({ claims: [{ ...VERIFIED[0], status: "unverified" }] })).toBe(
    false,
  );
  expect(
    canPost({
      claims: [{ ...VERIFIED[0], is_primary: false, relationship: "friend" }],
    }),
  ).toBe(false);
  expect(averageElixir([{ elixir_cost: 3 }, { elixir_cost: 4 }])).toBe(3.5);
  expect(averageElixir([{ elixir_cost: 3 }, {}])).toBe(null);
});

test("a deck link in the words becomes the deck; another link stays words", () => {
  const d = readDraft(`Good for 7k?  ${LINK}  thanks`);
  expect(d.words).toBe("Good for 7k? thanks");
  expect(d.deck.cards).toEqual(IDS);
  expect(d.deck.tower_troop).toBe(159000000);
  const other = readDraft("see https://example.com/deck");
  expect(other.deck).toBe(null);
  expect(other.words).toBe("see https://example.com/deck");
});

test("nothing draws while posts are off, or without a Verified player", async () => {
  for (const me of [ME({ posts: false }), ME({ claims: [] })]) {
    cleanup();
    serve(me);
    const { container } = renderWithProviders(
      <PostComposer open setOpen={() => {}} />,
    );
    await waitFor(() =>
      expect(calls.some((c) => c.path === "/api/me")).toBe(true),
    );
    expect(container.querySelector(".kit-post-compose")).toBeNull();
  }
});

test("a pasted deck link shows the deck, and the link is not sent as words", async () => {
  serve(ME(), () => reply({ post: POST() }, 201));
  const closed = vi.fn();
  renderWithProviders(<PostComposer open setOpen={closed} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Ask a question" }),
  );
  const box = screen.getByRole("textbox", { name: "Your question" });
  fireEvent.change(box, { target: { value: `Good for 7k? ${LINK}` } });
  expect(
    await screen.findByRole("list", { name: "The deck from your link" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add cards" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  await waitFor(() => expect(closed).toHaveBeenCalledWith(false));
  const sent = calls.find(
    (c) => c.path === "/api/me/posts" && c.method === "POST",
  );
  expect(JSON.parse(sent.body)).toEqual({
    text: `Good for 7k? ${LINK}`,
    question: true,
    cards: [],
  });
});

test("a refusal says why in one line and keeps the words", async () => {
  serve(ME(), () =>
    reply(
      {
        error: "refused",
        category: "personal_info",
        message: "Keep personal details out of posts.",
      },
      422,
    ),
  );
  renderWithProviders(<PostComposer open setOpen={() => {}} />);
  const box = await screen.findByRole("textbox", { name: "Your post" });
  fireEvent.change(box, { target: { value: "where is everyone from" } });
  fireEvent.click(screen.getByRole("button", { name: "Post" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Keep personal details out of posts.",
  );
  expect(box.value).toBe("where is everyone from");
});

test("too many characters cannot be posted", async () => {
  serve(ME());
  renderWithProviders(<PostComposer open setOpen={() => {}} />);
  const box = await screen.findByRole("textbox", { name: "Your post" });
  fireEvent.change(box, { target: { value: "a".repeat(501) } });
  expect(screen.getByText("1 too many")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Post" }).disabled).toBe(true);
});

test("a post draws its words as plain text, its Question label, deck and Copy deck", async () => {
  serve(ME());
  const { container } = renderWithProviders(<FeedItem it={POST()} />);
  const words = await screen.findByText(
    "Is this good? https://example.com <b>bold</b>",
  );
  expect(words.tagName).toBe("P");
  expect(words.querySelector("a, b")).toBeNull();
  expect(container.querySelector('a[href^="https://example.com"]')).toBeNull();
  expect(screen.getByText("Question")).toBeTruthy();
  expect(screen.getByText("Hog Rider cycle")).toBeTruthy();
  expect(container.textContent).toContain("3.0 average elixir");
  expect(screen.getByRole("button", { name: /Copy deck/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Report" })).toBeTruthy();
  // A question takes answers.
  expect(await screen.findByRole("button", { name: "Answer" })).toBeTruthy();
});

test("a cheer on a page's post list shows at once, and a second tap takes it back", async () => {
  const sent = [];
  global.fetch = vi.fn(async (p, init = {}) => {
    const url = String(p);
    if (url === "/api/me") return reply(ME());
    if (url.startsWith("/api/me/posts"))
      return reply({ posts: [POST({ cheers: {}, my_cheer: null })] });
    if (url === "/api/me/cheers") {
      const body = JSON.parse(init.body);
      sent.push(body.cheer);
      return reply({
        item_id: body.item_id,
        cheers: body.cheer ? { [body.cheer]: 1 } : {},
        my_cheer: body.cheer,
      });
    }
    return reply({}, 404);
  });
  renderWithProviders(<PostList player="#0PGQ2UYL" />);
  const cheer = () => screen.getByRole("button", { name: /^Cheer(ed)?: / });
  fireEvent.click(await screen.findByRole("button", { name: /^Cheer(ed)?: / }));
  await waitFor(() =>
    expect(cheer().getAttribute("aria-pressed")).toBe("true"),
  );
  await waitFor(() => expect(sent).toEqual(["well_played"]));
  fireEvent.click(cheer());
  await waitFor(() =>
    expect(cheer().getAttribute("aria-pressed")).toBe("false"),
  );
  await waitFor(() => expect(sent).toEqual(["well_played", null]));
});

test("a comment write reads a post list and Clan's Feed again, not only Home", async () => {
  serve(ME());
  const queryClient = createQueryClient();
  const { result } = renderHook(() => useCommentsChanged(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  const list = ["me", "posts", "player", "#0PGQ2UYL"];
  const feed = ["me", "clan", "record", "#0RJ29CVY", "feed"];
  const race = ["me", "clan", "record", "#0RJ29CVY", "race"];
  for (const key of [list, feed, race]) queryClient.setQueryData(key, {});
  await result.current("tl_0123456789abcdef0abc");
  expect(queryClient.getQueryState(list).isInvalidated).toBe(true);
  expect(queryClient.getQueryState(feed).isInvalidated).toBe(true);
  expect(queryClient.getQueryState(race).isInvalidated).toBe(false);
});
