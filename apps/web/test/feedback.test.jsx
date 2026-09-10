/**
 * Feedback: the list is the console's log table with the note
 * shortened to its first line, and the record renders the note and the
 * reply as the Markdown they were written in.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
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

beforeEach(() => {
  cleanup();
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ feedback: FEEDBACK }),
    text: async () => JSON.stringify({ feedback: FEEDBACK }),
  }));
});
afterEach(() => vi.restoreAllMocks());

test("the list is a table: one line per note, id links to the record", async () => {
  const navigate = vi.fn();
  render(<Feedback navigate={navigate} />);
  await waitFor(() => screen.getByText("fb_14"));
  const table = screen.getByRole("table");
  expect(table.textContent).toContain(
    "Deck names in `players_timeline` don't match what I see in game.",
  );
  // The rest of the note stays on the record, not in the cell.
  expect(table.textContent).not.toContain("Two cases");
  expect(table.textContent).toContain("replied");
  screen.getByText("fb_14").click();
  expect(navigate).toHaveBeenCalledWith("/account/feedback/14");
});

test("the record renders the note and the reply as Markdown, safely", async () => {
  render(<FeedbackItem id="14" navigate={() => {}} />);
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
