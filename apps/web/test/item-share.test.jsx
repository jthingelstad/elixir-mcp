import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
import { ItemShare } from "../src/home/ItemShare.jsx";
import { api } from "../src/api.js";

const URL = "https://elixir.poapkings.com/share/abcdefghijklmnopqrstuvwx";
const item = {
  id: "tl_0123456789abcdef0123",
  kind: "badge_earned",
  section: "player",
  visibility: "public",
  at: "2026-11-17T12:00:00.000Z",
  text: "Private Alias earned a badge",
  subjects: [{ kind: "player", tag: "#0QU8VGV", name: "Private Alias" }],
};
let copy;
beforeEach(() => {
  copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  vi.spyOn(api, "shareItem").mockResolvedValue({
    ok: true,
    data: { url: URL },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("one tap copies only the canonical URL and later taps reuse its capability", async () => {
  window.history.replaceState({}, "", "/timeline?nickname=private#secret");
  render(<ItemShare it={item} />);
  const share = screen.getByRole("button", { name: "Share", exact: true });
  expect(share.textContent).toBe("");
  expect(
    share.querySelector("svg.lucide-share-2")?.getAttribute("aria-hidden"),
  ).toBe("true");
  fireEvent.click(share);
  await screen.findByRole("button", { name: "Link copied" });
  expect(copy).toHaveBeenCalledWith(URL);
  expect(api.shareItem).toHaveBeenCalledWith(
    expect.objectContaining({
      item_id: item.id,
      source: "game",
      kind: item.kind,
      at: item.at,
    }),
  );
  expect(
    screen.getByRole("link", { name: "Share image" }).getAttribute("href"),
  ).toBe(`${URL}.png`);
  fireEvent.click(screen.getByRole("button", { name: "Link copied" }));
  await waitFor(() => expect(copy).toHaveBeenCalledTimes(2));
  expect(api.shareItem).toHaveBeenCalledOnce();
});

test("native sharing contains only the canonical URL, with no private name or page context", async () => {
  navigator.share = vi.fn().mockResolvedValue(undefined);
  render(<ItemShare it={item} />);
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  await screen.findByRole("button", { name: "Shared" });
  expect(navigator.share).toHaveBeenCalledWith({ url: URL });
  expect(copy).not.toHaveBeenCalled();
});

test("native cancellation leaves a selectable link, without success or a clipboard side effect", async () => {
  navigator.share = vi
    .fn()
    .mockRejectedValue(
      Object.assign(new Error("cancelled"), { name: "AbortError" }),
    );
  render(<ItemShare it={item} />);
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  const link = await screen.findByLabelText("Share link");
  expect(link.value).toBe(URL);
  expect(link.readOnly).toBe(true);
  expect(copy).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Shared" })).toBeNull();
});

test("native and clipboard failures leave manual copy without claiming success", async () => {
  navigator.share = vi.fn().mockRejectedValue(new Error("unavailable"));
  copy.mockRejectedValue(new Error("denied"));
  render(<ItemShare it={item} />);
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  const link = await screen.findByLabelText("Share link");
  expect(copy).toHaveBeenCalledWith(URL);
  expect(link.value).toBe(URL);
  expect(screen.queryByRole("button", { name: "Link copied" })).toBeNull();
});

test("a refused create has no fabricated link or copy and can be retried", async () => {
  api.shareItem.mockResolvedValueOnce({
    ok: false,
    status: 404,
    data: { error: "not_found" },
  });
  render(<ItemShare it={item} />);
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  expect((await screen.findByRole("status")).textContent).toBe(
    "Couldn't get a link. Try again.",
  );
  expect(screen.queryByRole("link", { name: "Share image" })).toBeNull();
  expect(copy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  await screen.findByRole("button", { name: "Link copied" });
  expect(api.shareItem).toHaveBeenCalledTimes(2);
});

test("concurrent taps issue one create while pending", async () => {
  let finish;
  api.shareItem.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<ItemShare it={item} />);
  const button = screen.getByRole("button", { name: "Share", exact: true });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(api.shareItem).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Getting link…" }).disabled).toBe(
    true,
  );
  finish({ ok: true, data: { url: URL } });
  await screen.findByRole("button", { name: "Link copied" });
});

test("private and unknown items have no Share, and battle targets use the canonical id", async () => {
  const { rerender } = render(
    <ItemShare it={{ ...item, kind: "member_away", section: "attested" }} />,
  );
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<ItemShare it={{ ...item, kind: "future_kind" }} />);
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<ItemShare battle={{ id: "canonical-battle" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  await screen.findByRole("button", { name: "Link copied" });
  expect(api.shareItem).toHaveBeenCalledWith({
    source: "battle",
    battle_ref: "canonical-battle",
  });
});

test("a Clan news item shares from its owning clan even when a player is named too", async () => {
  const clan = { kind: "clan", tag: "#0VGJQ28P", name: "Clan" };
  const member = { kind: "player", tag: "#0PGQ2UYL", name: "New player" };
  const news = {
    ...item,
    kind: "member_joined",
    visibility: "public",
    subject_tag: clan.tag,
    subjects: [member, clan],
  };
  render(<ItemShare it={news} />);
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  await screen.findByRole("button", { name: "Link copied" });
  expect(api.shareItem).toHaveBeenCalledWith(
    expect.objectContaining({ source: "game", subject: clan }),
  );
});

const NEXT_URL = "https://elixir.poapkings.com/share/zyxwvutsrqponmlkjihgfedc";
const nextItem = { ...item, id: "tl_1123456789abcdef0123" };

test("a different canonical item resets its cached link, image and embed copy", async () => {
  api.shareItem.mockImplementation(async ({ item_id }) => ({
    ok: true,
    data: { url: item_id === item.id ? URL : NEXT_URL },
  }));
  const { rerender } = render(<ItemShare it={item} />);
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  await screen.findByRole("button", { name: "Link copied" });
  rerender(<ItemShare it={nextItem} />);
  expect(screen.queryByRole("link", { name: "Share image" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy for a post" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  await screen.findByRole("button", { name: "Link copied" });
  expect(api.shareItem).toHaveBeenCalledTimes(2);
  expect(copy.mock.calls.map(([value]) => value)).toEqual([URL, NEXT_URL]);
  expect(
    screen.getByRole("link", { name: "Share image" }).getAttribute("href"),
  ).toBe(`${NEXT_URL}.png`);
  fireEvent.click(screen.getByRole("button", { name: "Copy for a post" }));
  expect(copy.mock.calls.at(-1)[0]).toContain(NEXT_URL);
  expect(copy.mock.calls.at(-1)[0]).not.toContain(URL);
});

test("a previous target's late create cannot publish a callback or clipboard write", async () => {
  let finish;
  const ready = vi.fn();
  api.shareItem.mockImplementation(({ item_id }) =>
    item_id === item.id
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ ok: true, data: { url: NEXT_URL } }),
  );
  const { rerender } = render(<ItemShare it={item} onReady={ready} />);
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  await screen.findByRole("button", { name: "Getting link…" });
  rerender(<ItemShare it={nextItem} onReady={ready} />);
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  await screen.findByRole("button", { name: "Link copied" });
  await act(async () => {
    finish({ ok: true, data: { url: URL } });
  });
  expect(ready.mock.calls.map(([value]) => value)).toEqual([NEXT_URL]);
  expect(copy.mock.calls.map(([value]) => value)).toEqual([NEXT_URL]);
  expect(
    screen.getByRole("link", { name: "Share image" }).getAttribute("href"),
  ).toBe(`${NEXT_URL}.png`);
});

test("an unmounted target's late native failure never falls back to the clipboard", async () => {
  let refuse;
  navigator.share = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
    )
    .mockResolvedValue(undefined);
  api.shareItem.mockImplementation(async ({ item_id }) => ({
    ok: true,
    data: { url: item_id === item.id ? URL : NEXT_URL },
  }));
  const { rerender } = render(<ItemShare it={item} />);
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  await waitFor(() => expect(navigator.share).toHaveBeenCalledOnce());
  rerender(<ItemShare it={nextItem} />);
  fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
  await screen.findByRole("button", { name: "Shared" });
  await act(async () => {
    refuse(new Error("native sheet failed after navigation"));
  });
  expect(copy).not.toHaveBeenCalled();
  expect(navigator.share.mock.calls.map(([value]) => value.url)).toEqual([
    URL,
    NEXT_URL,
  ]);
  expect(
    screen.getByRole("link", { name: "Share image" }).getAttribute("href"),
  ).toBe(`${NEXT_URL}.png`);
});
