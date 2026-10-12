import { afterEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { RoleConfirming } from "../src/components/RoleConfirming.jsx";
import { confirmingRole, waitingForRole } from "../src/lib/role.js";
import { manageApi } from "../src/api.js";

afterEach(() => {
  waitingForRole()?.dismiss();
  cleanup();
  vi.unstubAllGlobals();
});

const refusal = {
  ok: false,
  status: 409,
  data: { error: "role_unconfirmed", retry_after_s: 15 },
};

test("a change refused role_unconfirmed waits behind the notice; Try again sends it again and answers the page that asked", async () => {
  const answers = [
    refusal,
    refusal,
    { ok: true, status: 200, data: { saved: 1 } },
  ];
  const send = vi.fn(async () => answers.shift());
  render(<RoleConfirming />);
  let answered = null;
  await act(async () => {
    confirmingRole(send).then((r) => {
      answered = r;
    });
  });
  expect(
    screen.getByText(
      "Confirming your role in the game; try again in a minute.",
    ),
  ).toBeTruthy();
  expect(answered).toBe(null);
  // Still unconfirmed: the notice stays and the page still waits.
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Try again" })),
  );
  expect(answered).toBe(null);
  expect(screen.getByRole("status").textContent).toMatch(
    /Confirming your role/,
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Try again" })),
  );
  expect(answered).toEqual({ ok: true, status: 200, data: { saved: 1 } });
  expect(send).toHaveBeenCalledTimes(3);
  expect(screen.queryByText(/Confirming your role/)).toBe(null);
});

test("Dismiss gives the page the refusal; any other answer passes straight through", async () => {
  render(<RoleConfirming />);
  let answered = null;
  await act(async () => {
    confirmingRole(async () => refusal).then((r) => {
      answered = r;
    });
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" })),
  );
  expect(answered).toEqual(refusal);
  expect(screen.queryByRole("status")).toBe(null);
  const conflict = { ok: false, status: 409, data: { error: "stale_version" } };
  expect(await confirmingRole(async () => conflict)).toEqual(conflict);
  expect(waitingForRole()).toBe(null);
});

test("the Clan API's changes go through it, and reads never do", async () => {
  const replies = [
    [409, { error: "role_unconfirmed", retry_after_s: 15 }],
    [200, { ok: true }],
  ];
  const fetch = vi.fn(async () => {
    const [status, body] = replies.shift() ?? [
      409,
      { error: "role_unconfirmed" },
    ];
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fetch);
  render(<RoleConfirming />);
  let answered = null;
  await act(async () => {
    manageApi.setHold("#2PQRJ8LV", "#8QCV", { until: null }).then((r) => {
      answered = r;
    });
  });
  await vi.waitFor(() => expect(waitingForRole()).not.toBe(null));
  await act(async () =>
    fireEvent.click(await screen.findByRole("button", { name: "Try again" })),
  );
  await vi.waitFor(() => expect(answered?.status).toBe(200));
  expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual([
    "PUT",
    "PUT",
  ]);

  replies.push([409, { error: "role_unconfirmed" }]);
  const read = await manageApi.policy("#2PQRJ8LV");
  expect(read.status).toBe(409);
  expect(waitingForRole()).toBe(null);
});
