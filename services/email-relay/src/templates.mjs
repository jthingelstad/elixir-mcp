/**
 * Email templates: plain text always, HTML alongside it where it earns its
 * place. Every message carries the disclaimer.
 *
 * Practices here are lifted from the two siblings that got this right first —
 * Elixir Drop and Thingy (librarian-thing) — after a review across all three
 * on 2026-09-08 found this the only one still sending text alone:
 *
 *   * The code leads the SUBJECT and the first line of the body. Apple Mail's
 *     verification-code detector keys on "code is NNNNNN" appearing early, and
 *     that one-tap autofill is most of the value of a six-digit code.
 *   * A hidden preheader repeats the code, so the inbox preview shows it
 *     without the message being opened.
 *   * Tables and inline styles. Email clients are not browsers; a stylesheet
 *     is not reliably read and a flex container is not reliably laid out.
 *   * The button carries a bgcolor fallback, and the raw URL appears beneath
 *     it — buttons get stripped, and a link nobody can copy is a dead end.
 *   * Every interpolated value is escaped. A code is ours, but the habit is
 *     what stops the first templated user string from being an injection.
 */

import { DISCLAIMER } from "@elixir-mcp/contracts";

const SIGNIN_BASE = "https://elixir.poapkings.com/signin";
const SITE = "https://elixir.poapkings.com";

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** The site's own palette, so the mail looks like where it came from. */
const C = {
  bg: "#0b0920",
  panel: "#120f2a",
  edge: "#2a2450",
  ink: "#f7f4ff",
  muted: "#c8c1e6",
  faint: "#a99fce",
  gold: "#f5c84c",
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * One shell for every message, so a login and a welcome are recognisably the
 * same sender. `preheader` is the hidden line inboxes show as a preview.
 */
function shell({ title, preheader, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="dark light">
    <title>${esc(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${C.bg};-webkit-text-size-adjust:100%;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${esc(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.bg};">
      <tr><td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
          <tr><td align="center" style="padding:4px 0 22px;">
            <span style="font-family:${FONT};font-size:19px;font-weight:700;letter-spacing:.14em;color:${C.ink};">ELIXIR&nbsp;MCP</span>
          </td></tr>
          <tr><td style="background-color:${C.panel};border:1px solid ${C.edge};border-radius:16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="height:4px;background-color:${C.gold};border-radius:16px 16px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
              <tr><td style="padding:28px 26px 26px;">${body}</td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:20px 6px 0;font-family:${FONT};font-size:11.5px;line-height:1.6;color:${C.faint};">
            ${esc(DISCLAIMER)}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

const p = (text, color = C.muted, size = "15px") =>
  `<p style="margin:0 0 14px;font-family:${FONT};font-size:${size};line-height:1.6;color:${color};">${text}</p>`;

const button = (href, label) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;">
     <tr><td align="center" bgcolor="${C.gold}" style="border-radius:10px;background-color:${C.gold};">
       <a href="${esc(href)}" target="_blank" style="display:block;padding:13px 30px;font-family:${FONT};font-size:15px;font-weight:700;color:#241a02;text-decoration:none;border-radius:10px;">${esc(label)}</a>
     </td></tr>
   </table>`;

export function renderEmail(msg) {
  if (msg.kind === "login") {
    const link = msg.token ? `${SIGNIN_BASE}?login_token=${msg.token}` : null;
    const consent = msg.client_name
      ? `Entering this code authorizes ${msg.client_name} to read your recorded Clash Royale data.\n\n`
      : "";
    const consentHtml = msg.client_name
      ? p(
          `Entering this code authorizes <strong style="color:${C.ink};">${esc(msg.client_name)}</strong> to read your recorded Clash Royale data.`,
        )
      : "";
    return {
      subject: `${msg.code} is your Elixir MCP sign-in code`,
      text:
        `Your Elixir MCP sign-in code is ${msg.code}\n\n` +
        consent +
        (link ? `Or sign in with one click:\n${link}\n\n` : "") +
        `The code and link expire in 15 minutes. If you didn't request this, ignore it.\n\n` +
        `${DISCLAIMER}\n`,
      html: shell({
        title: "Your Elixir MCP sign-in code",
        // Repeats the code so an inbox preview carries it, and phrased the way
        // Apple Mail's code detector expects.
        preheader: `Your Elixir MCP sign-in code is ${msg.code}. It expires in 15 minutes.`,
        body: [
          p("Your sign-in code", C.faint, "12px").replace(
            "margin:0 0 14px",
            "margin:0 0 8px;letter-spacing:.12em;text-transform:uppercase;font-weight:600",
          ),
          `<p style="margin:0 0 18px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;line-height:1.1;font-weight:700;letter-spacing:.22em;color:${C.ink};">${esc(msg.code)}</p>`,
          consentHtml,
          link ? p("Or sign in with one tap:") : "",
          link ? button(link, "Sign in to Elixir MCP") : "",
          link
            ? p(
                `Button not working? Paste this into your browser:<br><a href="${esc(link)}" style="color:${C.gold};word-break:break-all;">${esc(link)}</a>`,
                C.faint,
                "12.5px",
              )
            : "",
          p(
            "The code and the link expire in 15 minutes, and either one can be used once. If you didn't ask to sign in, ignore this — nothing happens.",
            C.faint,
            "13px",
          ),
        ].join(""),
      }),
    };
  }
  if (msg.kind === "welcome") {
    return {
      subject: "Your Elixir MCP access is approved",
      text:
        `You're in!\n\n` +
        `The player you asked with is already being recorded, and so is their clan —\n` +
        `sign in at ${SIGNIN_BASE} and it is waiting for you. Connect your agent to\n` +
        `${SITE}/mcp and start asking questions the game itself can't answer.\n\n` +
        `The five-minute version: ${SITE}/docs/quickstart\n\n` +
        `${DISCLAIMER}\n`,
      html: shell({
        title: "Your Elixir MCP access is approved",
        preheader:
          "You're in. Add your player, connect your agent, and start asking.",
        body: [
          `<h1 style="margin:0 0 14px;font-family:${FONT};font-size:22px;line-height:1.25;font-weight:700;color:${C.ink};">You&rsquo;re in.</h1>`,
          p(
            "Elixir MCP records the Clash Royale history the official API doesn&rsquo;t keep, and serves it to your own agent.",
          ),
          p(
            "The player you asked with is already being recorded, and their clan with them &mdash; sign in and it is waiting for you. Then connect your agent and ask it something the game itself can&rsquo;t answer.",
          ),
          button(`${SITE}/docs/quickstart`, "Start here — five minutes"),
          p(
            `Or go straight to <a href="${SIGNIN_BASE}" style="color:${C.gold};">signing in</a>.`,
            C.faint,
            "13px",
          ),
        ].join(""),
      }),
    };
  }
  if (msg.kind === "owner_notify") {
    // One subject per event, so the inbox reads as a log. A message with
    // no notify_kind predates 2026-09-09 and gets the generic line.
    const subjects = {
      access_request: "Elixir MCP: new access request",
      feedback: "Elixir MCP: new feedback",
      role_upgrade_request: "Elixir MCP: tier upgrade request",
      gateway_request: "Elixir MCP: collector raise-hand",
      gateway_quarantined: "Elixir MCP: collector QUARANTINED",
      approved_welcome: "Elixir MCP: account approved",
    };
    const leads = {
      access_request: "Someone asked for access.",
      feedback: "A beta user said something.",
      role_upgrade_request: "Someone asked for a higher tier.",
      gateway_request: "Someone raised a hand to run a collector.",
      gateway_quarantined:
        "A collector stopped submitting and was quarantined.",
      approved_welcome: "An account was approved.",
    };
    const kind = msg.notify_kind;
    const category = msg.detail?.category;
    const subject =
      kind === "feedback" && category
        ? `${subjects.feedback} - ${category}`
        : (subjects[kind] ?? "Elixir MCP: notification");
    const facts = Object.entries(msg.detail ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    const link = msg.link ?? `${SITE}/admin`;
    const lead = leads[kind] ?? "Something happened on Elixir MCP.";
    return {
      subject,
      text: [
        lead,
        "",
        msg.note ?? "",
        facts ? `\n${facts}` : "",
        "",
        `Act on it: ${link}`,
        "",
      ].join("\n"),
      // The operator's own mail is mail too. These were text-only while
      // the login and the welcome were not, so the one kind that arrives
      // several times a day was the one that looked like a cron job.
      // Same shell, so the inbox reads as one sender.
      html: shell({
        title: subject,
        preheader: msg.note ? `${lead} ${msg.note}` : lead,
        body: [
          `<h1 style="margin:0 0 14px;font-family:${FONT};font-size:20px;line-height:1.3;font-weight:700;color:${C.ink};">${esc(lead)}</h1>`,
          msg.note ? p(esc(msg.note), C.ink) : "",
          // Labelled facts as a table: a definition list is not laid out
          // reliably in mail clients, and these are read at a glance on
          // a phone.
          Object.keys(msg.detail ?? {}).length
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:4px 0 20px;border-top:1px solid ${C.edge};">
                 ${Object.entries(msg.detail)
                   .map(
                     ([k, v]) =>
                       `<tr>
                          <td style="padding:8px 10px 8px 0;border-bottom:1px solid ${C.edge};font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${C.faint};white-space:nowrap;vertical-align:top;">${esc(k)}</td>
                          <td style="padding:8px 0;border-bottom:1px solid ${C.edge};font-family:${FONT};font-size:13.5px;line-height:1.5;color:${C.muted};">${esc(v)}</td>
                        </tr>`,
                   )
                   .join("")}
               </table>`
            : "",
          button(link, "Open the console"),
          p(
            `Or paste this into your browser:<br><a href="${esc(link)}" style="color:${C.gold};word-break:break-all;">${esc(link)}</a>`,
            C.faint,
            "12.5px",
          ),
        ].join(""),
      }),
    };
  }
  throw new Error(`unknown email kind: ${msg.kind}`);
}
