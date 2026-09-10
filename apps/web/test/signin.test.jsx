/**
 * Sign in, and the two answers it used to collapse into one.
 *
 * "That link is expired or already used" was what a person saw whether
 * their link had really expired OR their access request was simply still
 * waiting. The second one sent them round a loop that could not work,
 * however many times they tried it.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SignIn } from "../src/views/SignIn.jsx";

function reply(status, body) {
  global.fetch = vi.fn(async () => ({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

beforeEach(() => {
  cleanup();
  window.history.pushState({}, "", "/signin");
  reply(200, { ok: true });
});
afterEach(() => vi.restoreAllMocks());

async function toCodeStep() {
  render(<SignIn onAuthed={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "j@x.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in email" }));
  return screen.findByLabelText("6-digit code");
}

test("the code step keeps both escapes: a wrong address and a spent code", async () => {
  await toCodeStep();
  expect(screen.getByText("Send another email")).toBeTruthy();
  fireEvent.click(screen.getByText("Use a different address"));
  // Back to the address, not stuck waiting for mail that is not coming.
  expect(screen.getByLabelText("Email")).toBeTruthy();
});

test("a waiting access request is not reported as a bad code", async () => {
  const input = await toCodeStep();
  reply(403, { error: "not_approved", status: "requested" });
  fireEvent.change(input, { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("Your request is in")).toBeTruthy();
  expect(screen.getByText(/granted by hand/)).toBeTruthy();
  // And it does not tell them to try again, because trying again cannot work.
  expect(screen.queryByText("Wrong or expired code.")).toBeNull();
});

test("a genuinely wrong code still says so, on the code step", async () => {
  const input = await toCodeStep();
  reply(400, { error: "invalid_or_expired" });
  fireEvent.change(input, { target: { value: "000000" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("Wrong or expired code.")).toBeTruthy();
  expect(screen.getByLabelText("6-digit code")).toBeTruthy();
});

test("an expired magic link says nothing is wrong with the account", async () => {
  // takeLoginToken memoises: it must capture the credential before
  // main.jsx scrubs it and hand the same answer to the view afterwards.
  // A fresh module registry is the only way to arrive with a token twice
  // in one file.
  vi.resetModules();
  const { SignIn: Fresh } = await import("../src/views/SignIn.jsx");
  window.history.pushState({}, "", "/signin?login_token=deadbeef");
  reply(400, { error: "invalid_or_expired" });
  render(<Fresh onAuthed={vi.fn()} />);
  expect(
    await screen.findByText("That link is expired or already used"),
  ).toBeTruthy();
  expect(screen.getByText(/Nothing is wrong with your account/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  expect(screen.getByLabelText("Email")).toBeTruthy();
});

/**
 * Asking for access, which is the same door.
 *
 * The form used to be a second implementation on the static home page,
 * and it failed in the worst available way: the POST landed and the page
 * did not move, because the success path hid a form carrying inline
 * `display: flex` and revealed a `.notice` whose class sets `display` —
 * neither of which a `hidden` attribute can beat. A visitor could not
 * tell "sent" from "broken", so the tests that matter here are about
 * what the screen SAYS after the request, not that a fetch happened.
 */
function requestFields() {
  return {
    email: screen.getByLabelText("Email"),
    tag: screen.getByLabelText("Your player tag"),
  };
}

function fillRequest(tag = "#20JJJ2CCRU") {
  const { email, tag: tagInput } = requestFields();
  fireEvent.change(email, { target: { value: "j@x.com" } });
  fireEvent.change(tagInput, { target: { value: tag } });
  fireEvent.click(screen.getByRole("button", { name: "Request access" }));
}

test("the home page's deep link opens the asking half, not the signing-in half", () => {
  window.history.pushState({}, "", "/signin?request");
  render(<SignIn onAuthed={vi.fn()} />);
  expect(screen.getByLabelText("Your player tag")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Send sign-in email" }),
  ).toBeNull();
});

test("sign in and request access are two steps of one card", () => {
  render(<SignIn onAuthed={vi.fn()} />);
  // Arriving at the sign-in step, the other door is reachable without
  // leaving for the static site (it used to be a link to /#request).
  fireEvent.click(screen.getByText("Request access"));
  expect(screen.getByLabelText("Your player tag")).toBeTruthy();
  fireEvent.click(screen.getByText("Sign in instead"));
  expect(
    screen.getByRole("button", { name: "Send sign-in email" }),
  ).toBeTruthy();
});

test("a sent request SAYS SO — the screen moves", async () => {
  window.history.pushState({}, "", "/signin?request");
  render(<SignIn onAuthed={vi.fn()} />);
  fillRequest();
  expect(await screen.findByText("Your request is in")).toBeTruthy();
  // The form is gone, not merely marked hidden: this is the whole bug.
  expect(screen.queryByLabelText("Your player tag")).toBeNull();
});

test("a refused tag is reported on the form, and the form stays fillable", async () => {
  window.history.pushState({}, "", "/signin?request");
  render(<SignIn onAuthed={vi.fn()} />);
  reply(400, { error: "invalid_tag" });
  fillRequest("not a tag");
  expect(
    await screen.findByText("That doesn't look like a CR tag."),
  ).toBeTruthy();
  expect(screen.getByLabelText("Your player tag")).toBeTruthy();
  expect(screen.queryByText("Your request is in")).toBeNull();
});

test("the request carries the fields the API requires", async () => {
  window.history.pushState({}, "", "/signin?request");
  render(<SignIn onAuthed={vi.fn()} />);
  fillRequest();
  await screen.findByText("Your request is in");
  const [path, init] = global.fetch.mock.calls[0];
  expect(path).toBe("/api/request-access");
  expect(init.headers["x-elixir-client"]).toBe("web");
  expect(JSON.parse(init.body)).toMatchObject({
    email: "j@x.com",
    player_tag: "#20JJJ2CCRU",
  });
});
