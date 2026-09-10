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
