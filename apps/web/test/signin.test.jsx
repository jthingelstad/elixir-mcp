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
  window.history.pushState({}, "", "/console/signin");
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
  expect(await screen.findByText("Account access is unavailable")).toBeTruthy();
  expect(screen.getByText(/cannot sign in/)).toBeTruthy();
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
  // The link's own form since #129: the token rides the fragment.
  window.history.pushState({}, "", "/console/signin#login_token=deadbeef");
  reply(400, { error: "invalid_or_expired" });
  render(<Fresh onAuthed={vi.fn()} />);
  expect(global.fetch.mock.calls[0][1].body).toContain("deadbeef");
  expect(window.location.hash).toBe("");
  expect(
    await screen.findByText("That link is expired or already used"),
  ).toBeTruthy();
  expect(screen.getByText(/Nothing is wrong with your account/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  expect(screen.getByLabelText("Email")).toBeTruthy();
});

test("both public signup and legacy request links use the same email verification door", () => {
  for (const query of ["signup", "request"]) {
    cleanup();
    window.history.pushState({}, "", `/console/signin?${query}`);
    render(<SignIn onAuthed={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "Create your Elixir account" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.queryByLabelText("Your player tag")).toBeNull();
    expect(
      screen.getByText(/No password, invitation or collector needed/),
    ).toBeTruthy();
  }
});

test("failed email delivery stays on the email form and can be retried", async () => {
  render(<SignIn onAuthed={vi.fn()} />);
  reply(503, { error: "unavailable" });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "new@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in email" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByLabelText("Email")).toBeTruthy();
  expect(screen.queryByText("Check your email")).toBeNull();
  reply(200, { ok: true });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in email" }));
  expect(await screen.findByLabelText("6-digit code")).toBeTruthy();
});

test("a double submission while delivery is pending sends one email request", async () => {
  let finish;
  global.fetch = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<SignIn onAuthed={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "new@example.com" },
  });
  const form = screen.getByLabelText("Email").closest("form");
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  finish({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
    text: async () => JSON.stringify({ ok: true }),
  });
  expect(await screen.findByLabelText("6-digit code")).toBeTruthy();
});

test("signup discloses existing mail policy and the independent collector gate", () => {
  render(<SignIn onAuthed={vi.fn()} />);
  expect(screen.getByText(/product news and reports/)).toBeTruthy();
  expect(screen.getByText(/Collectors need separate approval/)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Privacy" }).getAttribute("href"),
  ).toBe("/docs/privacy");
});

test("an interrupted magic-link response offers recovery without calling the link expired", async () => {
  vi.resetModules();
  const { SignIn: Fresh } = await import("../src/views/SignIn.jsx");
  window.history.pushState({}, "", "/console/signin#login_token=temporary");
  reply(503, { error: "unavailable" });
  render(<Fresh onAuthed={vi.fn()} />);
  expect(await screen.findByText("Sign-in did not finish")).toBeTruthy();
  expect(screen.queryByText("That link is expired or already used")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Start again" }));
  expect(screen.getByLabelText("Email")).toBeTruthy();
});
