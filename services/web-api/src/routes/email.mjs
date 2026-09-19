/** Product email routes (docs/EMAIL.md).
 *
 *  GET  /api/me/email          the six switches (absent row = on)
 *  PUT  /api/me/email          {kind, enabled}
 *  POST /api/me/email/send     {kind}: compose this kind for me, now
 *  GET  /api/email/unsubscribe?t=  a page with a button (no session:
 *       the token is the credential; a GET never changes state, because
 *       link scanners prefetch)
 *  POST /api/email/unsubscribe?t=  the one-click header's POST, and the
 *       page's button: flips the kind off (or "all")
 */
import { PRODUCT_EMAIL_KINDS, isProductEmailKind } from "@elixir-mcp/contracts";
import {
  verifyUnsubscribe,
  renderMail,
  KIND_LABELS,
  TINYLYTICS_EMBED_CODE,
} from "@elixir-mcp/mail";
import { runEmail } from "../../../jobs/src/email/index.mjs";
import { json } from "../http.mjs";

const SITE = "https://elixir.poapkings.com";

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

function page({ title, lead, form = "" }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Elixir</title>
<style>body{margin:0;background:#0c0920;color:#ddd7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}main{max-width:480px;margin:48px auto;padding:0 20px}h1{color:#faf8ff;font-size:22px}p{line-height:1.55}a{color:#b49dfb}button{background:#f5c84c;color:#2a1500;border:0;border-radius:8px;padding:11px 18px;font-weight:700;font-size:14px;cursor:pointer}.wm{letter-spacing:.18em;font-weight:800;color:#faf8ff;margin-bottom:28px}.f{margin-top:36px;font-size:12px;color:#a29ad0}</style></head>
<body><main><div class="wm">ELIXIR</div><h1>${esc(title)}</h1><p>${lead}</p>${form}<p class="f">This material is unofficial and is not endorsed by Supercell. For more information see Supercell's Fan Content Policy: www.supercell.com/fan-content-policy.</p></main></body></html>`;
}

function labelOf(kind) {
  return kind === "all" ? "every Elixir email" : (KIND_LABELS[kind] ?? kind);
}

async function setPref(db, accountId, kind, enabled, via) {
  const kinds = kind === "all" ? [...PRODUCT_EMAIL_KINDS] : [kind];
  for (const k of kinds)
    await db.query(
      `insert into account_email_pref (account_id, kind, enabled, via, changed_at)
       values ($1, $2, $3, $4, now())
       on conflict (account_id, kind) do update set enabled = excluded.enabled, via = excluded.via, changed_at = now()`,
      [accountId, k, enabled, via],
    );
  await db
    .query(
      `insert into account_event (account_id, kind, detail) values ($1, 'email_pref', $2)`,
      [accountId, JSON.stringify({ kind, enabled, via })],
    )
    .catch(() => {});
}

export function emailRoutes({
  resolveAccount,
  secret,
  enqueueEmail,
  databaseUrl,
}) {
  const claim = (event) => {
    const t = event.queryStringParameters?.t ?? "";
    return verifyUnsubscribe({ secret, token: t });
  };
  return {
    "GET /api/me/email": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select kind, enabled, changed_at, via from account_email_pref where account_id = $1`,
        [account.accountId],
      );
      const { rows: ops } = await db.query(
        `select exists (select 1 from gateway where owner_account_id = $1 and status <> 'revoked') as operator`,
        [account.accountId],
      );
      const { rows: recent } = await db.query(
        `select i.kind, i.period_key, i.subject_line, s.enqueued_at from email_send s join email_issue i on i.issue_id = s.issue_id
          where s.account_id = $1 order by s.enqueued_at desc limit 12`,
        [account.accountId],
      );
      const by = new Map(rows.map((r) => [r.kind, r]));
      return json(200, {
        kinds: PRODUCT_EMAIL_KINDS.map((kind) => ({
          kind,
          label: KIND_LABELS[kind],
          enabled: by.get(kind)?.enabled ?? true,
          changed_at: by.get(kind)?.changed_at ?? null,
          applies:
            kind === "collector_activity" ? Boolean(ops[0]?.operator) : true,
        })),
        recent: recent.map((r) => ({
          kind: r.kind,
          period: r.period_key,
          subject: r.subject_line,
          sent_at: r.enqueued_at,
        })),
      });
    },
    "PUT /api/me/email": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const kind = String(body?.kind ?? "");
      if (!isProductEmailKind(kind)) return json(400, { error: "bad_kind" });
      if (typeof body?.enabled !== "boolean")
        return json(400, { error: "bad_enabled" });
      await setPref(db, account.accountId, kind, body.enabled, "profile");
      return json(200, { kind, enabled: body.enabled });
    },
    "POST /api/me/email/send": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      const kind = String(body?.kind ?? "");
      if (!isProductEmailKind(kind)) return json(400, { error: "bad_kind" });
      // The same composer the schedule runs, for this account only, past the ledger.
      const result = await runEmail({
        db,
        databaseUrl,
        kind,
        accountId: account.accountId,
        force: true,
        enqueue: enqueueEmail,
        secret,
      });
      const sent = result.sent > 0;
      return json(200, {
        kind,
        sent,
        reason: sent
          ? null
          : result.failed
            ? "failed"
            : result.recipients === 0
              ? "off_or_ineligible"
              : "nothing_to_say",
        detail: result.details?.[0]?.error ?? null,
      });
    },
    // The Top 100 issue as a page anyone can open: the mail's own HTML,
    // rendered from the stored issue, no session. This is the share link
    // in the mail. A JSON client gets the facts instead.
    "GET /api/public/top100/*": async (db, event) => {
      const date = String(event.pathParam ?? "");
      const latest = date === "latest";
      if (!latest && !/^\d{4}-\d{2}-\d{2}$/.test(date))
        return json(404, { error: "not_found" });
      const { rows } = await db.query(
        `select period_key, facts from email_issue where kind = 'top_100' and subject_key = '' and facts is not null
          ${latest ? "" : "and period_key = $1"} order by composed_at desc limit 1`,
        latest ? [] : [date],
      );
      if (!rows[0]) return json(404, { error: "not_found" });
      const facts = rows[0].facts;
      const wantsJson = /application\/json/.test(event.headers?.accept ?? "");
      if (wantsJson) return json(200, { date: rows[0].period_key, ...facts });
      // Links carry the issue's campaign; the open pixel is left off and
      // the site's own script counts the page view instead.
      const { html } = renderMail("top_100", facts, {
        unsubscribe: `${SITE}/account/profile`,
        manage: `${SITE}/account/profile`,
        period: rows[0].period_key,
        pixel: false,
      });
      const body = html.replace(
        "</body>",
        `<script defer src="https://tinylytics.app/embed/${TINYLYTICS_EMBED_CODE}/min.js?hits&countries"></script></body>`,
      );
      return {
        statusCode: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=600",
        },
        body,
      };
    },
    "GET /api/email/unsubscribe": async (db, event) => {
      const c = claim(event);
      if (!c)
        return html(
          400,
          page({
            title: "This link has expired",
            lead: `Sign in and use <a href="${SITE}/account/profile">your account page</a> to change which emails you get.`,
          }),
        );
      const t = esc(event.queryStringParameters?.t ?? "");
      return html(
        200,
        page({
          title: `Turn off ${labelOf(c.kind)}?`,
          lead: `One click and Elixir stops sending you ${labelOf(c.kind)}. You can turn it back on any time from <a href="${SITE}/account/profile">your account page</a>.`,
          form: `<form method="post" action="/api/email/unsubscribe?t=${t}"><button type="submit">Turn it off</button></form>`,
        }),
      );
    },
    "POST /api/email/unsubscribe": async (db, event) => {
      const c = claim(event);
      if (!c)
        return html(
          400,
          page({
            title: "This link has expired",
            lead: `Sign in and use <a href="${SITE}/account/profile">your account page</a>.`,
          }),
        );
      if (c.kind !== "all" && !isProductEmailKind(c.kind))
        return json(400, { error: "bad_kind" });
      await setPref(db, c.accountId, c.kind, false, "one_click");
      // A mail client's one-click POST wants a 2xx and nothing else; a
      // person's button wants a page.
      const wantsHtml = /text\/html/.test(event.headers?.accept ?? "");
      if (!wantsHtml)
        return {
          statusCode: 200,
          headers: { "content-type": "text/plain" },
          body: "ok",
        };
      return html(
        200,
        page({
          title: `${labelOf(c.kind)}: off`,
          lead: `Done. Elixir will not send you ${labelOf(c.kind)} again unless you turn it back on from <a href="${SITE}/account/profile">your account page</a>.`,
        }),
      );
    },
  };
}
