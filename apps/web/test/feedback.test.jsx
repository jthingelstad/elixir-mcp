/**
 * Feedback: the list is the console's log table with the note
 * shortened to its first line, and the record renders the note and the
 * reply as the Markdown they were written in.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Feedback, FeedbackItem } from "../src/views/account/Feedback.jsx";

const NOTE =
  'Deck names in `players_timeline` don\'t match what I see in game.\n\nTwo cases:\n\n- **Hog 2.6** shows as "Hog Rider cycle"\n- Log bait shows as "Goblin Barrel bait"\n\n<script>alert(1)</script> [x](javascript:alert(1))';

const FEEDBACK = [
  {
    feedback_id: 14,
    surface: "web",
    category: "data_quality",
    status: "planned",
    created_at: "2026-09-08T14:02:00Z",
    message: NOTE,
    response: "Agreed.\n\nIt lands with **0.26**.",
    responded_at: "2026-09-09T09:10:00Z",
  },
  {
    feedback_id: 3,
    surface: "web",
    category: "praise",
    status: "seen",
    created_at: "2026-08-04T19:30:00Z",
    message: "Thank you.",
    response: null,
  },
];

/** The record's own read (0204): the item, its pointers and its thread. */
const ITEM = {
  ...FEEDBACK[0],
  area: "ladder",
  refs: [
    { kind: "call", ref: "0e6c1f7a-0000-4000-8000-000000000002" },
    { kind: "player", ref: "#20JJJ2CCRU" },
  ],
  follows_id: 3,
  followed_by: [21],
};

const reply = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  cleanup();
  global.fetch = vi.fn(async (url, init) => {
    const path = String(url);
    if (init?.method === "POST") return reply({ ok: true, feedback_id: 22 });
    if (/\/api\/me\/feedback\/14$/.test(path)) return reply({ feedback: ITEM });
    return reply({ feedback: FEEDBACK });
  });
});
afterEach(() => vi.restoreAllMocks());

test("email feedback reads the committed route search before the address bar catches up", async () => {
  window.history.replaceState(
    {},
    "",
    "/console/account/activity/e/example?report=1",
  );
  renderWithProviders(
    <Feedback search={{ send_id: "5c1c5dbf-0000-4000-8000-000000000001" }} />,
  );
  expect(await screen.findByText(/Reporting one email/)).toBeTruthy();
  expect(screen.getByText("5c1c5dbf")).toBeTruthy();
  window.history.replaceState({}, "", "/");
});

test("the list is a table: one line per note, id links to the record", async () => {
  const navigate = vi.fn();
  renderWithProviders(<Feedback navigate={navigate} />);
  await waitFor(() => screen.getByText("fb_14"));
  const table = screen.getByRole("table");
  expect(table.textContent).toContain(
    "Deck names in `players_timeline` don't match what I see in game.",
  );
  // The rest of the note stays on the record, not in the cell.
  expect(table.textContent).not.toContain("Two cases");
  expect(table.textContent).toContain("replied");
  screen.getByText("fb_14").click();
  expect(navigate).toHaveBeenCalledWith("/console/account/feedback/14");
});

test("the record renders the note and the reply as Markdown, safely", async () => {
  renderWithProviders(<FeedbackItem id="14" navigate={() => {}} />);
  await waitFor(() => screen.getByText("fb_14"));
  const items = document.querySelectorAll(".md li");
  expect(items.length).toBe(2);
  expect(document.querySelector(".md strong")?.textContent).toBe("Hog 2.6");
  expect(document.querySelector(".md code")?.textContent).toBe(
    "players_timeline",
  );
  // Raw HTML is text, and a javascript: link is not a link.
  expect(document.querySelector(".md script")).toBeNull();
  expect(document.body.textContent).toContain("<script>");
  expect(document.querySelector('.md a[href^="javascript"]')).toBeNull();
  expect(document.body.textContent).toContain("It lands with");
});

test("the record names its area, what it points at and its thread", async () => {
  renderWithProviders(<FeedbackItem id="14" navigate={() => {}} />);
  await waitFor(() => screen.getByText("fb_14"));
  expect(document.body.textContent).toContain("Ladder");
  expect(screen.getByText("call 0e6c1f7a")).toBeTruthy();
  expect(document.body.textContent).toContain("Player #20JJJ2CCRU");
  expect(screen.getByText("fb_3")).toBeTruthy();
  expect(screen.getByText("fb_21")).toBeTruthy();
  // The record is read by its own route, not found in the list.
  expect(
    global.fetch.mock.calls.some(([u]) =>
      String(u).endsWith("/api/me/feedback/14"),
    ),
  ).toBe(true);
});

test("a reply to an answer follows it, in the same area", async () => {
  renderWithProviders(<FeedbackItem id="14" navigate={() => {}} />);
  await waitFor(() => screen.getByText("fb_14"));
  fireEvent.click(screen.getByRole("button", { name: /Reply/ }));
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Still wrong on Hog 2.6." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("fb_22");
  const [, init] = global.fetch.mock.calls.find(
    ([, i]) => i?.method === "POST",
  );
  expect(JSON.parse(init.body)).toEqual({
    message: "Still wrong on Hog 2.6.",
    category: "data_quality",
    area: "ladder",
    follows_id: 14,
  });
});
