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
 *   * The button carries a bgcolor fallback; the text alternative carries
 *     its destination, and HTML readers can copy the link.
 *   * Every interpolated value is escaped. A code is ours, but the habit is
 *     what stops the first templated user string from being an injection.
 */

import { DISCLAIMER, isProductEmailKind } from "@elixir-mcp/contracts";
import {
  pixelPath,
  pixelTag,
  mailShell,
  mailParts,
  MAIL_PALETTE as C,
  MAIL_FONT as FONT,
  MAIL_MONO as MONO,
} from "@elixir-mcp/mail";

const SITE = "https://elixir.poapkings.com";
const SIGNIN_BASE = `${SITE}/console/signin`;

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * The one mail shell (packages/mail, shell.mjs), the same one every
 * report and milestone wears, so a login and a clan report are
 * recognisably the same sender (2026-10-01). `preheader` is the hidden
 * line inboxes show as a preview. `pixel` is the Tinylytics path the
 * open counts under (/mail/login, /mail/welcome); the owner's own
 * notifications carry none, so Jamie's reading of them never lands in
 * the numbers. Transactional mail never carries an unsubscribe.
 */
function shell({ kind, title, subtitle, preheader, body, pixel = null }) {
  return mailShell({
    kind,
    docTitle: title,
    title: kind === "login" ? "" : esc(title),
    subtitle: subtitle ? esc(subtitle) : "",
    preheader,
    body,
    pixel: pixel ? pixelTag(pixel) : "",
  });
}

const { p: para, small, h2, button: goldButton, rows } = mailParts();
const p = (text, color = C.muted, size = 14.5) =>
  para(text, { color, size, mb: 14 });
const button = (href, label) => goldButton(label, href, { tag: false });

export function renderEmail(msg) {
  // A product kind (a weekly report, a milestone) is rendered where the
  // facts are, by packages/mail in the jobs Lambda, and rides the queue
  // whole; the relay has no database and composes nothing. The
  // validator already refused one without subject and text.
  if (isProductEmailKind(msg.kind)) {
    return { subject: msg.subject, text: msg.text, html: msg.html ?? null };
  }
  if (msg.kind === "login") {
    // A fragment never leaves the browser; a query string reaches the
    // CDN's access logs and stays there (#129). The console reads it.
    const link = msg.token ? `${SIGNIN_BASE}#login_token=${msg.token}` : null;
    const consent = msg.client_name
      ? `You’re signing in to ${msg.client_name} with Elixir.\n\n`
      : "";
    const consentHtml = msg.client_name
      ? p(
          `You’re signing in to <strong style="color:${C.ink};">${esc(msg.client_name)}</strong> with Elixir.`,
        )
      : "";
    return {
      subject: `${msg.code} is your Elixir sign-in code`,
      text:
        `Your Elixir sign-in code is ${msg.code}\n\n` +
        consent +
        (link ? `Or sign in with one click:\n${link}\n\n` : "") +
        `${link ? "The code and link expire" : "The code expires"} in 15 minutes. ${link ? "Either" : "It"} can be used once. If you didn't request this, ignore it.\n\n` +
        `${DISCLAIMER}\n`,
      html: shell({
        kind: "login",
        pixel: pixelPath("login"),
        title: "Your Elixir sign-in code",
        // Repeats the code so an inbox preview carries it, and phrased the way
        // Apple Mail's code detector expects.
        preheader: `Your Elixir sign-in code is ${msg.code}. It expires in 15 minutes.`,
        body: [
          `<p style="margin:0 0 8px;font-family:${FONT};font-size:16px;line-height:1.4;font-weight:600;color:${C.faint};">Your sign-in code</p>`,
          `<p style="margin:0 0 18px;font-family:${MONO};font-size:36px;line-height:1.1;font-weight:700;letter-spacing:.12em;color:${C.ink};">${esc(msg.code)}</p>`,
          consentHtml,
          link ? button(link, "Sign in to Elixir") : "",
          p(
            `${link ? "The code and link expire" : "This code expires"} in 15 minutes. ${link ? "Either" : "It"} can be used once. If you didn’t ask to sign in, ignore this email.`,
            C.faint,
            13,
          ).replace("margin:0 0 14px", "margin:18px 0 0"),
        ].join(""),
      }),
    };
  }
  if (msg.kind === "welcome") {
    return {
      subject: "Your Elixir account is ready",
      text:
        `You're in.\n\n` +
        `Keep your Clash Royale history in one place: Console, Ladder and Clan.\n\n` +
        `Add your player in Console ▸ Tracking to start your record. If a player is already on your account, its recording stays in place.\n` +
        `The first capture usually lands within a few minutes, with roughly your last 30 battles.\n` +
        `Open ${SITE}/console/account/tracking to get started.\n\n` +
        `What comes next\n\n` +
        `Monday: your clan's week. The river race, who joined and departed. Elixir follows your player's clan for you as soon as it sees it.\n` +
        `Tuesday: your week in the Arena. Your record by mode, your decks, and who you battled.\n` +
        `Wednesday: your friends. Follow anyone with a player tag, and hear how they played.\n` +
        `Your own agent: connect it to ${SITE}/mcp and ask what the game can't answer.\n\n` +
        `The five-minute version: ${SITE}/docs/quickstart\n\n` +
        `${DISCLAIMER}\n`,
      html: shell({
        kind: "welcome",
        pixel: pixelPath("welcome"),
        title: "You’re in.",
        subtitle: "Your Elixir account is ready",
        preheader:
          "You’re in. Start your record in Console, read it in Ladder and open Clan with the same account.",
        body: [
          p(
            "Keep your Clash Royale history in one place: Console, Ladder and Clan.",
          ),
          p(
            "Add your player in Console ▸ Tracking to start your record. If a player is already on your account, its recording stays in place. The first capture usually lands within a few minutes, with roughly your last 30 battles.",
          ),
          button(`${SITE}/console/account/tracking`, "Start your record"),
          h2("What comes next"),
          rows([
            {
              title: "Monday: your clan&rsquo;s week",
              text: "The river race, who joined and departed. Elixir follows your player&rsquo;s clan for you as soon as it sees it.",
            },
            {
              title: "Tuesday: your week in the Arena",
              text: "Your record by mode, your decks, and who you battled.",
            },
            {
              title: "Wednesday: your friends",
              text: "Follow anyone with a player tag, and hear how they played.",
            },
            {
              title: "Your own agent",
              text: `Connect it to <span style="font-family:${MONO};font-size:12.5px;">elixir.poapkings.com/mcp</span> and ask what the game can&rsquo;t answer.`,
            },
          ]),
          small(
            `The five-minute version: <a href="${SITE}/docs/quickstart" style="color:${C.link};text-decoration:none;">Start here</a>.`,
          ),
        ].join(""),
      }),
    };
  }
  if (msg.kind === "owner_notify") {
    // One subject per event, so the inbox reads as a log. A message with
    // no notify_kind predates 2026-09-09 and gets the generic line.
    const subjects = {
      access_request: "Elixir: new access request",
      feedback: "Elixir: new feedback",
      role_upgrade_request: "Elixir: tier upgrade request",
      gateway_request: "Elixir: collector enrolled",
      gateway_quarantined: "Elixir: collector quarantined",
      gateway_silent: "Elixir: collector silent",
      approved_welcome: "Elixir: account approved",
    };
    const leads = {
      access_request: "Access requested.",
      feedback: "New feedback.",
      role_upgrade_request: "Tier upgrade requested.",
      gateway_request: "Collector enrolled.",
      gateway_quarantined: "Collector quarantined.",
      gateway_silent: "Collector silent.",
      approved_welcome: "Account approved.",
    };
    const kind = msg.notify_kind;
    const category = msg.detail?.category;
    const subject =
      kind === "feedback" && category
        ? `${subjects.feedback} - ${category}`
        : (subjects[kind] ?? "Elixir: notification");
    const facts = Object.entries(msg.detail ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    const link = msg.link ?? `${SITE}/console/admin`;
    const lead = leads[kind] ?? "Service notice.";
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
        DISCLAIMER,
        "",
      ].join("\n"),
      // The operator's own mail is mail too. These were text-only while
      // the login and the welcome were not, so the one kind that arrives
      // several times a day was the one that looked like a cron job.
      // Same shell, so the inbox reads as one sender.
      html: shell({
        kind: "owner_notify",
        title: lead,
        preheader: msg.note ? `${lead} ${msg.note}` : lead,
        body: [
          msg.note ? p(esc(msg.note), C.ink) : "",
          // Labelled facts as a table: a definition list is not laid out
          // reliably in mail clients, and these are read at a glance on
          // a phone.
          Object.keys(msg.detail ?? {}).length
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:4px 0 0;border-top:1px solid ${C.edge};">
                 ${Object.entries(msg.detail)
                   .map(
                     ([k, v]) =>
                       `<tr>
                          <td style="padding:8px 10px 8px 0;border-bottom:1px solid ${C.edge};font-family:${FONT};font-size:12px;color:${C.faint};width:32%;vertical-align:top;">${esc(k.replaceAll("_", " "))}</td>
                          <td style="padding:8px 0;border-bottom:1px solid ${C.edge};font-family:${FONT};font-size:13.5px;line-height:1.5;color:${C.muted};word-break:break-word;overflow-wrap:anywhere;">${esc(v)}</td>
                        </tr>`,
                   )
                   .join("")}
               </table>`
            : "",
          button(link, "Open the console"),
        ].join(""),
      }),
    };
  }
  throw new Error(`unknown email kind: ${msg.kind}`);
}
