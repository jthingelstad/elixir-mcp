/** Product email routes (docs/EMAIL.md).
 *
 *  GET  /api/me/email          every switch (absent row = on), with
 *       each kind's product, its send time in the account's zone and
 *       the last one sent to this account
 *  PUT  /api/me/email          {kind, enabled}; kind "all" is the
 *       page's Every email switch: every kind at once, the flip an
 *       "all" unsubscribe token makes. The digest (tracking_report)
 *       also takes {cadence: "weekly" | "daily"} (0242), with or
 *       without enabled; a turn-off keeps the cadence
 *  GET  /api/me/email/sends    every product email sent to me, newest
 *       first (the Activity page's Emails view)
 *  GET  /api/me/email/sends/<send_id>  one of them with its archived
 *       body, the pixel stripped (a look at the record is not an open)
 *  GET  /api/email/unsubscribe?t=  a page with a button (no session:
 *       the token is the credential; a GET never changes state, because
 *       link scanners prefetch)
 *  POST /api/email/unsubscribe?t=  the one-click header's POST, and the
 *       page's button: flips the kind off (or "all")
 *
 *  There is deliberately no anonymous page for an issue (Jamie,
 *  2026-09-18): sharing a Top 100 is forwarding the mail.
 */
import {
  DISCLAIMER,
  PRODUCT_EMAIL_KINDS,
  ACTIVE_PRODUCT_EMAIL_KINDS,
  isProductEmailKind,
  isRetiredEmailKind,
} from "@elixir-mcp/contracts";
import {
  verifyUnsubscribe,
  KIND_LABELS,
  MAIL_SOURCE,
  mailSendTime,
  DIGEST_CADENCES,
} from "@elixir-mcp/mail";
import { MAIL_PATHS } from "@elixir-mcp/mail/paths";
import {
  SENDS_FROM,
  SENDS_SQL,
  sendRow,
  loadSendRecord,
} from "../send-record.mjs";
import { json, UUID_RE } from "../http.mjs";

const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function html(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
    body,
  };
}

/** Where a turn-off page sends a person next, by the face the page shows
 *  (the site's session hint picks it before paint). Absolute paths: the
 *  page is served at /api/email/unsubscribe. */
const NEXT = {
  in: [
    { href: "/home", label: "Open Home" },
    { href: "/settings/emails", label: "Email settings" },
  ],
  out: [
    { href: "/signin", label: "Sign in" },
    { href: "/", label: "Elixir home" },
  ],
};

const DOCS_LINK = { href: "/docs/email", label: "How Elixir email works" };

/** The step's own section, in the site's classes (every one is used by
 *  apps/site/src/email-page.njk, so the stylesheet keeps it). */
function section({ title, lead, form = "", next = NEXT }) {
  const row = (face, links) =>
    `<div class="flex flex-wrap items-center gap-3" data-session-face="${face}">${links
      .map((l, i) => {
        // The step's own button leads when it has one; else the first way on.
        const cls =
          l === DOCS_LINK
            ? "btn btn--quiet"
            : !form && i === 0
              ? "btn btn--primary"
              : "btn";
        return `<a class="${cls}" href="${esc(l.href)}">${esc(l.label)}</a>`;
      })
      .join("")}</div>`;
  return `<section class="mx-auto flex max-w-[560px] flex-col items-start gap-4 pt-10 pb-6" data-email-page>
  <span class="chip">Email</span>
  <h1 class="hero-title m-0">${esc(title)}</h1>
  <p class="docs__lede m-0">${lead}</p>
  ${form}
  ${row("out", [...next.out, DOCS_LINK])}
  ${row("in", [...next.in, DOCS_LINK])}
</section>`;
}

const SLOT = /<section\b[^>]*\bdata-email-page\b[^>]*>[\s\S]*?<\/section>/;
// The token in this page's address is a credential (it turns mail off),
// so the page carries no third-party script that reads the address.
const ANALYTICS = /\s*<script\b[^>]*tinylytics\.app[^>]*><\/script>/g;

/** The site's own shell with this step in it, or null when the shell is
 *  missing or not the one this expects. */
function inShell(shell, view) {
  if (typeof shell !== "string" || !SLOT.test(shell)) return null;
  return shell
    .replace(
      /<title>[^<]*<\/title>/,
      `<title>${esc(view.title)} - Elixir</title>`,
    )
    .replace(SLOT, () => section(view))
    .replace(ANALYTICS, "");
}

/** What a step reads as when the site's shell cannot be read (the bucket
 *  is mid-publish, or S3 did not answer): plain, but a page, with the
 *  ways onward and the disclaimer. */
function fallback({ title, lead, form = "", next = NEXT }) {
  const links = [...next.in, ...next.out, DOCS_LINK]
    .filter((l, i, all) => all.findIndex((x) => x.href === l.href) === i)
    .map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`)
    .join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} - Elixir</title>
<style>body{margin:0;background:#0c0920;color:#ddd7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}main{max-width:480px;margin:48px auto;padding:0 20px}h1{color:#faf8ff;font-size:22px}p{line-height:1.55}a{color:#b49dfb}button{background:#f5c84c;color:#2a1500;border:0;border-radius:8px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer}.wm{letter-spacing:.18em;font-weight:800;color:#faf8ff;margin-bottom:28px}.f{margin-top:36px;font-size:12px;color:#a29ad0}</style></head>
<body><main><div class="wm">ELIXIR</div><h1>${esc(title)}</h1><p>${lead}</p>${form}<p>${links}</p><p class="f">${esc(DISCLAIMER)}</p></main></body></html>`;
}

/** RFC 8058: a mail client's one-click POST carries this form body. A
 *  person's button sends none, and is answered with a page. (Accept
 *  cannot tell them apart: the edge forwards no Accept header to /api/*,
 *  so every press of the button used to get the mail client's "ok".) */
const isOneClick = (event) =>
  /(^|&)List-Unsubscribe=One-Click(&|$)/i.test(String(event.body ?? "").trim());

export function labelOf(kind) {
  return kind === "all" ? "every Elixir email" : (KIND_LABELS[kind] ?? kind);
}

async function setPref(
  db,
  accountId,
  kind,
  enabled,
  via,
  { inTx = false } = {},
) {
  const kinds =
    kind === "all"
      ? [...(enabled ? ACTIVE_PRODUCT_EMAIL_KINDS : PRODUCT_EMAIL_KINDS)]
      : [kind];
  for (const k of kinds)
    await db.query(
      `insert into account_email_pref (account_id, kind, enabled, via, changed_at)
       values ($1, $2, $3, $4, now())
       on conflict (account_id, kind) do update set enabled = excluded.enabled, via = excluded.via, changed_at = now()`,
      [accountId, k, enabled, via],
    );
  // Best effort; inside a transaction a savepoint keeps a failed event
  // from rolling the switch back with it.
  if (inTx) await db.query("savepoint pref_event");
  await db
    .query(
      `insert into account_event (account_id, kind, detail) values ($1, 'email_pref', $2)`,
      [accountId, JSON.stringify({ kind, enabled, via })],
    )
    .catch(async () => {
      if (inTx) await db.query("rollback to savepoint pref_event");
    });
}

/** The digest's cadence (0242): set on its pref row, a row made on (the
 *  default) when the person has none, so choosing daily never turns the
 *  digest on or off by itself. */
async function setCadence(db, accountId, cadence) {
  await db.query(
    `insert into account_email_pref (account_id, kind, enabled, via, changed_at, cadence)
     values ($1, 'tracking_report', true, 'profile', now(), $2)
     on conflict (account_id, kind) do update set cadence = excluded.cadence, changed_at = now()`,
    [accountId, cadence],
  );
  await db
    .query(
      `insert into account_event (account_id, kind, detail) values ($1, 'email_pref', $2)`,
      [accountId, JSON.stringify({ kind: "tracking_report", cadence })],
    )
    .catch(() => {});
}

/** The labels read as names ("Milestones", "every Elixir email"); a
 *  sentence that opens with one starts with a capital. */
const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function emailRoutes({
  resolveAccount,
  secret,
  archive = null,
  emailShell = null,
}) {
  const claim = (event) => {
    const t = event.queryStringParameters?.t ?? "";
    return verifyUnsubscribe({ secret, token: t });
  };
  /** A step of the turn-off link, in the site's own page when it can be
   *  read (apps/site/src/email-page.njk). */
  const render = async (statusCode, view) => {
    let shell = null;
    try {
      shell = emailShell ? await emailShell() : null;
    } catch {
      shell = null;
    }
    return html(statusCode, inShell(shell, view) ?? fallback(view));
  };
  const expired = {
    title: "This link has expired",
    lead: `Nothing was changed. Sign in and choose which emails you get from <a href="${MAIL_PATHS.emails}">your email settings</a>.`,
    next: {
      in: [
        { href: "/settings/emails", label: "Email settings" },
        { href: "/home", label: "Open Home" },
      ],
      out: NEXT.out,
    },
  };
  return {
    "GET /api/me/email": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select kind, enabled, changed_at, via, cadence from account_email_pref where account_id = $1`,
        [account.accountId],
      );
      const { rows: ops } = await db.query(
        `select exists (select 1 from gateway where owner_account_id = $1 and status <> 'revoked') as operator,
                exists (select 1 from claim c join clan_membership m
                          on m.player_tag = c.player_tag and m.left_observed_at is null
                         where c.account_id = $1 and c.status = 'verified') as in_clan`,
        [account.accountId],
      );
      const { rows: recent } = await db.query(
        `${SENDS_SQL} where s.account_id = $1 order by s.enqueued_at desc limit 12`,
        [account.accountId],
      );
      // The last one of each kind, so the page can open what a kind
      // looks like from the account's own record.
      const { rows: lastSent } = await db.query(
        `select distinct on (i.kind) i.kind, s.send_id
           ${SENDS_FROM}
          where s.account_id = $1
          order by i.kind, s.enqueued_at desc`,
        [account.accountId],
      );
      const by = new Map(rows.map((r) => [r.kind, r]));
      const last = new Map(lastSent.map((r) => [r.kind, r.send_id]));
      return json(200, {
        kinds: ACTIVE_PRODUCT_EMAIL_KINDS.map((kind) => ({
          kind,
          label: KIND_LABELS[kind],
          product: MAIL_SOURCE[kind]?.product ?? null,
          // {weekday, time, zone} in the account's zone; null for the
          // kinds that come when something happens.
          sends: mailSendTime(kind, account.timezone ?? "UTC"),
          last_send_id: last.get(kind) ?? null,
          enabled: by.get(kind)?.enabled ?? true,
          changed_at: by.get(kind)?.changed_at ?? null,
          // The digest's how-often; null for every other kind.
          cadence:
            kind === "tracking_report"
              ? (by.get(kind)?.cadence ?? "weekly")
              : null,
          applies:
            kind === "collector_activity"
              ? Boolean(ops[0]?.operator)
              : kind === "clan_actions_waiting"
                ? Boolean(ops[0]?.in_clan)
                : true,
        })),
        recent: recent.map(sendRow),
      });
    },
    "GET /api/me/email/sends": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `${SENDS_SQL} where s.account_id = $1 order by s.enqueued_at desc limit 200`,
        [account.accountId],
      );
      return json(200, { sends: rows.map(sendRow) });
    },
    "GET /api/me/email/sends/*": async (db, event) => {
      // One sent email, opened from Activity or from its own footer: the
      // row and, when the archive has it, the mail as it was sent. Own
      // sends only; an id from someone else's footer opens nothing.
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const sendId = String(event.pathParam ?? "");
      if (!UUID_RE.test(sendId)) return json(404, { error: "not_found" });
      const record = await loadSendRecord(db, {
        sendId,
        accountId: account.accountId,
        archive,
      });
      if (!record) return json(404, { error: "not_found" });
      return json(200, record);
    },
    "PUT /api/me/email": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const kind = String(body?.kind ?? "");
      if (kind !== "all" && !isProductEmailKind(kind))
        return json(400, { error: "bad_kind" });
      const cadence = body?.cadence;
      if (cadence !== undefined) {
        if (kind !== "tracking_report")
          return json(400, { error: "no_cadence" });
        if (!DIGEST_CADENCES.includes(cadence))
          return json(400, { error: "bad_cadence" });
      }
      if (cadence === undefined && typeof body?.enabled !== "boolean")
        return json(400, { error: "bad_enabled" });
      if (body.enabled !== undefined && typeof body.enabled !== "boolean")
        return json(400, { error: "bad_enabled" });
      if (body.enabled && isRetiredEmailKind(kind))
        return json(410, { error: "kind_retired" });
      if (cadence !== undefined)
        await setCadence(db, account.accountId, cadence);
      if (typeof body.enabled === "boolean")
        await setPref(db, account.accountId, kind, body.enabled, "profile");
      return json(200, {
        kind,
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        ...(cadence !== undefined ? { cadence } : {}),
      });
    },
    "GET /api/email/unsubscribe": async (db, event) => {
      const c = claim(event);
      if (!c) return render(400, expired);
      if (isRetiredEmailKind(c.kind))
        return render(200, {
          title: `${upper(labelOf(c.kind))} has ended`,
          lead: `Elixir no longer sends this email, so there is nothing to turn off. Your other emails are on <a href="${MAIL_PATHS.emails}">your email settings</a>.`,
        });
      const t = encodeURIComponent(event.queryStringParameters?.t ?? "");
      const what = labelOf(c.kind);
      return render(200, {
        title: `Turn off ${what}?`,
        lead:
          c.kind === "all"
            ? `One click and Elixir stops sending you every email it sends. Sign-in codes and account notices still come. You can turn any of them back on from <a href="${MAIL_PATHS.emails}">your email settings</a>.`
            : `One click and Elixir stops sending you ${esc(what)}. Your other emails stay as they are, and you can turn this one back on any time from <a href="${MAIL_PATHS.emails}">your email settings</a>.`,
        form: `<form method="post" action="/api/email/unsubscribe?t=${t}"><button type="submit" class="btn btn--primary">Turn it off</button></form>`,
      });
    },
    "POST /api/email/unsubscribe": async (db, event) => {
      const c = claim(event);
      if (!c) return render(400, expired);
      if (c.kind !== "all" && !isProductEmailKind(c.kind))
        return json(400, { error: "bad_kind" });
      // A removed account keeps no switches ({account_remove}): a late
      // one-click on an old mail answers as done and writes nothing to the
      // tombstone, which has no address to mail anyway. The share lock
      // waits out a removal in flight (it holds the row for update) and
      // then reads the row as it committed.
      await db.query("begin");
      try {
        const { rows } = await db.query(
          `select email_hash from account where account_id = $1 for share`,
          [c.accountId],
        );
        const live =
          rows.length &&
          !String(rows[0].email_hash ?? "").startsWith("removed:");
        if (live)
          await setPref(db, c.accountId, c.kind, false, "one_click", {
            inTx: true,
          });
        await db.query("commit");
      } catch (err) {
        await db.query("rollback").catch(() => {});
        throw err;
      }
      // A mail client's one-click POST wants a 2xx and nothing else; a
      // person's button wants a page.
      if (isOneClick(event))
        return {
          statusCode: 200,
          headers: { "content-type": "text/plain" },
          body: "ok",
        };
      const what = labelOf(c.kind);
      return render(200, {
        title: c.kind === "all" ? "Every email is off" : `${upper(what)}: off`,
        lead:
          c.kind === "all"
            ? `Elixir will not send you any more of its emails. Sign-in codes and account notices still come when there is one. Changed your mind? Turn any of them back on from <a href="${MAIL_PATHS.emails}">your email settings</a>.`
            : `Elixir will not send you ${esc(what)} again. Your other emails stay as they are. Changed your mind? Turn it back on from <a href="${MAIL_PATHS.emails}">your email settings</a>.`,
      });
    },
  };
}
