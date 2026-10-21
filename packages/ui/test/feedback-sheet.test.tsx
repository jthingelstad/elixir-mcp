import { test, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FeedbackSheet } from "../src/index.ts";

afterEach(cleanup);

const CATEGORIES = ["general", "bug", "judgment"];

test("sends the area, the refs and the page with what was written", async () => {
  const send = vi.fn(async () => ({ ok: true, data: { feedback_id: "42" } }));
  render(
    <FeedbackSheet
      area="clan"
      categories={CATEGORIES}
      category="judgment"
      title="Report this"
      about="This action, #12."
      refs={[{ kind: "clan_action", ref: "12" }]}
      context={{ clan_tag: "#J2RGCRVG" }}
      send={send}
      onClose={() => {}}
      itemHref={(id) => `/console/account/feedback/${id}`}
    />,
  );
  expect(screen.getByText("This action, #12.")).toBeTruthy();
  const button = screen.getByRole("button", { name: "Send", hidden: true });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "  The clock is wrong for Ana.  " },
  });
  fireEvent.click(button);
  await screen.findByText("Read it as fb_42");
  expect(send).toHaveBeenCalledWith({
    message: "The clock is wrong for Ana.",
    category: "judgment",
    area: "clan",
    refs: [{ kind: "clan_action", ref: "12" }],
    context: { path: "/", clan_tag: "#J2RGCRVG" },
  });
  expect(screen.getByText("Read it as fb_42").getAttribute("href")).toBe(
    "/console/account/feedback/42",
  );
});

test("a refused send says why and keeps the words", async () => {
  const send = vi.fn(async () => ({
    ok: false,
    status: 400,
    data: { message: "Feedback is 1 to 8,000 characters; this is 9,000." },
  }));
  render(
    <FeedbackSheet
      area="ladder"
      categories={CATEGORIES}
      send={send}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "long" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send", hidden: true }));
  await screen.findByText("Feedback is 1 to 8,000 characters; this is 9,000.");
  expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
    "long",
  );
});

test("Close and Escape both close it", () => {
  const onClose = vi.fn();
  const { container } = render(
    <FeedbackSheet
      area="console"
      categories={CATEGORIES}
      send={vi.fn()}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Close", hidden: true }));
  fireEvent(
    container.querySelector("dialog")!,
    new Event("cancel", { cancelable: true }),
  );
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("links your feedback and its answers before and after sending", async () => {
  const send = vi.fn(async () => ({ ok: true, data: { feedback_id: "7" } }));
  render(
    <FeedbackSheet
      area="console"
      categories={CATEGORIES}
      send={send}
      onClose={() => {}}
      itemHref={(id) => `/console/account/feedback/${id}`}
      historyHref="/console/account/feedback"
    />,
  );
  const history = () =>
    screen.getByRole("link", {
      name: "Your feedback and its answers ›",
      hidden: true,
    });
  expect(history().getAttribute("href")).toBe("/console/account/feedback");
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "The rail hides on my phone." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send", hidden: true }));
  await screen.findByText("Read it as fb_7");
  expect(history().getAttribute("href")).toBe("/console/account/feedback");
});

test("without a history address, no history link", () => {
  render(
    <FeedbackSheet
      area="ladder"
      categories={CATEGORIES}
      send={vi.fn()}
      onClose={() => {}}
    />,
  );
  expect(
    screen.queryByRole("link", { name: /Your feedback/, hidden: true }),
  ).toBeNull();
});
