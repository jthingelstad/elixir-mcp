/* Elixir's service worker (2026-11-16, docs/notes/2026-11-16-web-push.md).
 *
 * Push only: it shows a notice Elixir sent and opens it when tapped. No
 * fetch handler and no cache, so every request (the app, sign-in, the
 * OAuth doors, /mcp) goes to the network exactly as it would without it.
 *
 * A notice's words came from players' names and text: they are shown as
 * plain notification text (never HTML), with control and direction
 * characters taken out and lengths capped. Its link must be a path on
 * this origin. */

// Control, bidi and zero-width characters, by code point.
const hidden = (c) =>
  c < 0x20 ||
  (c >= 0x7f && c <= 0x9f) ||
  (c >= 0x200b && c <= 0x200f) ||
  (c >= 0x202a && c <= 0x202e) ||
  (c >= 0x2066 && c <= 0x2069) ||
  c === 0xfeff;

const clean = (value, max) =>
  Array.from(String(value ?? ""))
    .map((ch) =>
      hidden(ch.codePointAt(0)) ? (ch.codePointAt(0) < 0x20 ? " " : "") : ch,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const samePath = (url) =>
  typeof url === "string" && /^\/(?!\/)/.test(url) && !url.includes("\\")
    ? url
    : "/timeline";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let notice = {};
  try {
    notice = event.data ? event.data.json() : {};
  } catch {
    notice = {};
  }
  const title = clean(notice.title, 120) || "Elixir";
  const url = samePath(notice.url);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: clean(notice.body, 200),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: clean(notice.kind, 20) || "elixir",
      data: {
        url,
        notice_id: /^[0-9a-f-]{36}$/.test(String(notice.notice_id ?? ""))
          ? notice.notice_id
          : null,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url = "/timeline", notice_id: id = null } =
    event.notification.data ?? {};
  const target = new URL(samePath(url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      // So the activity mail does not tell it again. Best effort: a
      // signed-out browser is refused, and the tap still opens.
      if (id)
        await fetch("/api/me/push/opened", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-elixir-client": "web",
          },
          body: JSON.stringify({ notice_id: id }),
        }).catch(() => null);
      const open = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const here = open.find((c) => c.url.startsWith(self.location.origin));
      if (here) {
        await here.focus();
        return here
          .navigate(target)
          .catch(() => self.clients.openWindow(target));
      }
      return self.clients.openWindow(target);
    })(),
  );
});
