/**
 * Comments on a timeline item (2026-11-16): nothing draws while they are
 * off, a feed card shows the newest two and the way in, a refusal says
 * why and keeps the words, and the fixed lists follow the database's.
 * Invented players only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Comments } from "../src/home/Comments.jsx";
import {
  COMMENT_MAX,
  COMMENT_WHO,
  REPORT_REASONS,
  commentsCountLabel,
} from "../src/home/comment-set.js";

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

const ME = (on) => ({
  account_id: "a1",
  features: { comments: on },
});

const COMMENT = (id, text, extra = {}) => ({
  id,
  item_id: "tl_0123456789abcdef0123",
  text,
  at: "2026-11-16T12:00:00.000Z",
  author: {
    account_id: "p1",
    player_tag: "#0GVJ9V",
    name: "Ada",
    verified: true,
  },
  mine: false,
  can_delete: false,
  can_report: true,
  can_block: true,
  ...extra,
});

const ITEM = {
  id: "tl_0123456789abcdef0123",
  subject_tag: "#0VJ2QV",
  subjects: [],
  comments: {
    count: 3,
    latest: [COMMENT("2", "gg"), COMMENT("3", "nice push")],
    open: true,
  },
};

function serve(on, post = null) {
  global.fetch = vi.fn(async (p, init = {}) => {
    const url = String(p);
    calls.push({ path: url, method: init.method ?? "GET", body: init.body });
    if (url === "/api/me") return reply(ME(on));
    if (url.startsWith("/api/me/comments?"))
      return reply({
        item_id: ITEM.id,
        comments: ITEM.comments.latest,
        count: 2,
        open: true,
      });
    if (url === "/api/me/comments" && post) return post();
    return reply({}, 404);
  });
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  path.resolve(here, "../../../db/migrations/0282_comments_and_blocks.sql"),
  "utf8",
);

test("the report reasons and the setting's answers are the database's", () => {
  const reasons = /reason in \(([^)]*)\)/.exec(migration)[1];
  expect(new Set(REPORT_REASONS.map((r) => r.key))).toEqual(
    new Set([...reasons.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])),
  );
  const who = /who in \(([^)]*)\)/.exec(migration)[1];
  expect(COMMENT_WHO.map((w) => w.key)).toEqual(
    [...who.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
  );
  expect(COMMENT_MAX).toBe(280);
  expect(migration).toContain("char_length(body) between 1 and 280");
});

test("the way in says how many there are", () => {
  expect(commentsCountLabel(null)).toBe("Comments");
  expect(commentsCountLabel(0)).toBe("Comments");
  expect(commentsCountLabel(1)).toBe("See 1 comment");
  expect(commentsCountLabel(5)).toBe("See all 5 comments");
});

test("nothing draws while comments are off", async () => {
  serve(false);
  const { container } = renderWithProviders(<Comments it={ITEM} />);
  await waitFor(() =>
    expect(calls.some((c) => c.path === "/api/me")).toBe(true),
  );
  expect(container.querySelector(".kit-comments")).toBeNull();
});

test("an item that takes none draws nothing", async () => {
  serve(true);
  const { container } = renderWithProviders(
    <Comments it={{ ...ITEM, comments: null }} />,
  );
  await waitFor(() =>
    expect(calls.some((c) => c.path === "/api/me")).toBe(true),
  );
  expect(container.querySelector(".kit-comments")).toBeNull();
});

test("a feed card shows the newest two, the way in and Comment", async () => {
  serve(true);
  renderWithProviders(<Comments it={ITEM} />);
  expect(await screen.findByText("nice push")).toBeTruthy();
  expect(screen.getByText("gg")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "See all 3 comments" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Comment" })).toBeTruthy();
  // Never the words as markup: plain text only.
  expect(screen.getByText("gg").tagName).toBe("P");
});

test("a refusal says why in one line and keeps the words", async () => {
  serve(true, () =>
    reply(
      {
        error: "refused",
        category: "bullying",
        message: "Keep it kind.",
      },
      422,
    ),
  );
  renderWithProviders(<Comments it={ITEM} />);
  fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
  const box = await screen.findByRole("textbox", { name: "Your comment" });
  fireEvent.change(box, { target: { value: "you are bad" } });
  fireEvent.click(screen.getByRole("button", { name: "Post" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Your comment wasn't posted. Keep it kind.",
  );
  expect(box.value).toBe("you are bad");
  expect(document.activeElement).toBe(box);
  const sent = calls.find(
    (c) => c.path === "/api/me/comments" && c.method === "POST",
  );
  expect(JSON.parse(sent.body)).toEqual({
    item_id: ITEM.id,
    subjects: ["#0VJ2QV"],
    text: "you are bad",
  });
});

test("while the words are checked a status line says so and the box is read-only", async () => {
  let answer;
  serve(
    true,
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  renderWithProviders(<Comments it={ITEM} />);
  fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
  const box = await screen.findByRole("textbox", { name: "Your comment" });
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("");
  fireEvent.change(box, { target: { value: "rematch me" } });
  fireEvent.click(screen.getByRole("button", { name: "Post" }));
  await waitFor(() =>
    expect(status.textContent).toBe(
      "Elixir checks every comment before it posts, so this takes a few seconds.",
    ),
  );
  expect(box.readOnly).toBe(true);
  expect(screen.getByRole("button", { name: "Checking" })).toBeTruthy();
  answer(
    reply(
      {
        error: "unavailable",
        message: "We couldn't check it just now. Try again.",
      },
      503,
    ),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Your comment wasn't posted. We couldn't check it just now. Try again.",
  );
  expect(status.textContent).toBe("");
  expect(box.readOnly).toBe(false);
  expect(box.value).toBe("rematch me");
});

test("too many characters cannot be posted", async () => {
  serve(true);
  renderWithProviders(<Comments it={ITEM} />);
  fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
  const box = await screen.findByRole("textbox", { name: "Your comment" });
  fireEvent.change(box, { target: { value: "a".repeat(281) } });
  expect(screen.getByText("1 too many")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Post" }).disabled).toBe(true);
});
