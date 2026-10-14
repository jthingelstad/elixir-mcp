#!/usr/bin/env node
/** Render every mail Elixir sends into packages/mail/.preview/ (gitignored),
 *  one HTML file per kind and a text file beside each, so a mail can be
 *  opened in a browser or screenshotted and compared with its board.
 *
 *    node packages/mail/scripts/preview.mjs [--tz America/Chicago] [--live]
 *
 *  The product kinds render their fixtures (packages/mail/fixtures, and
 *  the variants in test/fixtures); the
 *  sign-in code, the welcome and an operator notice come from the relay's
 *  own templates. Nothing is sent and nothing is counted: the open pixel
 *  is left out, and images point at this checkout's apps/site/src/assets
 *  (the logo, and card art once infra/scripts/mirror-card-art.mjs has
 *  run) unless --live keeps them on elixir.poapkings.com. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMail, htmlToText } from "../src/index.mjs";
import { renderEmail } from "../../../services/email-relay/src/templates.mjs";
import { mailPreviewCases } from "./preview-cases.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const args = process.argv.slice(2);
const out = args.includes("--out")
  ? path.resolve(args[args.indexOf("--out") + 1])
  : path.join(here, "../.preview");

const tz = args.includes("--tz")
  ? args[args.indexOf("--tz") + 1]
  : "America/Chicago";
const live = args.includes("--live");

const SITE = "https://elixir.poapkings.com";
const local = (html) =>
  (live
    ? html
    : html.replaceAll(
        `${SITE}/assets/`,
        `${path.relative(out, path.join(root, "apps/site/src/assets"))}/`,
      )
  ).replace(/<img src="https:\/\/tinylytics\.app[^>]*>/g, "");

mkdirSync(out, { recursive: true });
const written = [];
const write = (name, subject, preheader, html, text = htmlToText(html)) => {
  writeFileSync(path.join(out, `${name}.html`), local(html));
  writeFileSync(
    path.join(out, `${name}.txt`),
    `Subject: ${subject}\nPreheader: ${preheader}\n\n${text}`,
  );
  written.push({ name, subject, preheader, bytes: Buffer.byteLength(html) });
};

for (const specimen of mailPreviewCases()) {
  const { name, kind, facts, message } = specimen;
  const mail = message
    ? renderEmail({ v: 1, to: "preview@example.org", ...message })
    : renderMail(kind, facts, {
        unsubscribe: `${SITE}/api/email/unsubscribe?t=preview`,
        manage: `${SITE}/console/account/profile/email`,
        period: "preview",
        send_id: "00000000-0000-4000-8000-000000000000",
        timezone: tz,
        pixel: false,
        mine: ["#20JJJ2CCRU", "#VJQV8G8RL", "#VJG0J29QP"],
      });
  const pre =
    mail.preheader ??
    /<span style="display:none[^"]*"[^>]*>([\s\S]*?)<\/span>/.exec(
      mail.html,
    )?.[1] ??
    "";
  write(name, mail.subject, pre, mail.html, mail.text);
}
writeFileSync(
  path.join(out, "manifest.json"),
  JSON.stringify(written, null, 2),
);

writeFileSync(
  path.join(out, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Elixir mail previews</title><body style="font-family:system-ui;background:#0b0920;color:#f7f4ff;padding:24px"><h1>Elixir mail previews</h1><ul>${written
    .map(
      (w) =>
        `<li><a style="color:#c4b5fd" href="${w.name}.html">${w.name}</a> · ${w.subject} · ${(w.bytes / 1024).toFixed(1)} KB</li>`,
    )
    .join("")}</ul></body>`,
);
for (const w of written)
  console.log(
    `${w.name.padEnd(22)} ${(w.bytes / 1024).toFixed(1).padStart(6)} KB  ${w.subject}`,
  );
console.log(
  `\n${written.length} previews in ${path.relative(process.cwd(), out)}/`,
);
