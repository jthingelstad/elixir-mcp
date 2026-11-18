import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Comments } from "../src/home/Comments.jsx";
import { PostActions, PostBody } from "../src/home/Post.jsx";
import { api } from "../src/api.js";

const question = {
  id: "tl_0123456789abcdef0123",
  kind: "post",
  at: "2026-11-17T12:00:00.000Z",
  subjects: [],
  post: {
    id: "42",
    text: "How did that battle end?",
    question: true,
    answered: false,
    mine: true,
    can_edit: true,
  },
  comments: { count: 0, latest: [], open: true },
};
const reply = (data) => ({
  ok: true,
  status: 200,
  json: async () => data,
  text: async () => JSON.stringify(data),
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("a question always says how many answers it has, including zero and the newest two", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      reply({ authenticated: true, features: { comments: true, posts: true } }),
    ),
  );
  const { rerender } = renderWithProviders(<Comments it={question} />);
  expect(await screen.findByRole("button", { name: "0 answers" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Answers" })).toBeTruthy();
  rerender(
    <Comments
      it={{ ...question, comments: { count: 2, latest: [], open: true } }}
    />,
  );
  expect(screen.getByRole("button", { name: "2 answers" })).toBeTruthy();
});

test("only the question's author can mark it answered, and its state is visible", async () => {
  const update = vi
    .spyOn(api, "setQuestionAnswered")
    .mockResolvedValue({ ok: true, data: {} });
  const { rerender } = renderWithProviders(
    <>
      <PostBody it={question} />
      <PostActions it={question} />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Mark answered" }));
  await vi.waitFor(() => expect(update).toHaveBeenCalled());
  rerender(
    <>
      <PostBody
        it={{ ...question, post: { ...question.post, answered: true } }}
      />
      <PostActions
        it={{ ...question, post: { ...question.post, answered: true } }}
      />
    </>,
  );
  expect(screen.getByText(/Answered/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Mark unanswered" })).toBeTruthy();
  rerender(
    <PostActions
      it={{
        ...question,
        post: { ...question.post, mine: false, can_edit: false },
      }}
    />,
  );
  expect(screen.queryByRole("button", { name: "Mark answered" })).toBeNull();
});

test("reply notices keep one stable conversation key and open the post directly", async () => {
  const { commentRows } = await import("../src/shell/bell-logic.js");
  const row = commentRows({
    items: [
      {
        post_id: "42",
        comment_id: "7",
        question: true,
        count: 3,
        unread_count: 2,
        new: true,
        text: "<b>words</b>",
        author: { name: "<script>name</script>" },
      },
    ],
  })[0];
  expect(row.key).toBe("post-comments-42");
  expect(row.to).toBe("/home/post/42?answers=1&reply=7&after=all");
  expect(row.question).toBe(true);
  expect(row.unread).toBe(2);
  expect(row.count).toBe(3);
  expect(
    commentRows({ items: [{ post_id: "42", comment_id: "8" }] })[0].key,
  ).toBe(row.key);
});

test("a first-read notification marks only others' answers New and opens its anchored thread", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      reply(
        String(url) === "/api/me"
          ? { features: { comments: true, posts: true } }
          : {
              comments: [
                {
                  id: "8",
                  at: "2026-11-17T12:00:00Z",
                  text: "Their answer",
                  mine: false,
                  author: { name: "Invented Reader" },
                },
                {
                  id: "9",
                  at: "2026-11-17T12:01:00Z",
                  text: "My answer",
                  mine: true,
                  author: { name: "Invented Ada" },
                },
              ],
              open: true,
              anchored: true,
            },
      ),
    ),
  );
  renderWithProviders(
    <Comments it={question} entry={{ reply: "8", after: "all" }} />,
  );
  expect(
    await screen.findByRole("button", { name: "Hide answers" }),
  ).toBeTruthy();
  await screen.findByText("Their answer");
  expect(screen.getAllByText("New answer")).toHaveLength(1);
  expect(document.activeElement.textContent).toContain("Their answer");
});

test("replying from an anchored notification returns to latest so the new answer appears", async () => {
  let posted = false;
  vi.spyOn(api, "postComment").mockImplementation(async () => {
    posted = true;
    return { ok: true, data: {} };
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      reply(
        String(url) === "/api/me"
          ? { features: { comments: true, posts: true } }
          : {
              comments: [
                {
                  id: "8",
                  text: "Their answer",
                  mine: false,
                  author: { name: "Invented Reader" },
                },
                ...(posted && !String(url).includes("around=")
                  ? [
                      {
                        id: "9",
                        text: "My new answer",
                        mine: true,
                        author: { name: "Invented Ada" },
                      },
                    ]
                  : []),
              ],
              open: true,
              anchored: String(url).includes("around="),
            },
      ),
    ),
  );
  renderWithProviders(
    <Comments it={question} entry={{ reply: "8", after: "all" }} />,
  );
  await screen.findByText("Their answer");
  fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
    target: { value: "My new answer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Post", exact: true }));
  expect(await screen.findByText("My new answer")).toBeTruthy();
});
