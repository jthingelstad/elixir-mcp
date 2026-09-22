/** The dry run's output: this week's issue rendered to a file, sent to
 *  nobody (deliverable 9).
 *
 *  It renders from the SAME facts and the SAME renderer a real send
 *  uses, so what a reviewer opens is the mail - not a preview that
 *  drifts from it. The open pixel is left out (`pixel: false`, the
 *  public-page path): looking at a draft is not an open. */
import pg from "pg";
import { renderMail, htmlToText } from "@elixir-mcp/mail";
import { putAsset, putJson } from "./issue-pipeline.mjs";

const SITE = "https://elixir.poapkings.com";
const KIND = "card_of_week";

/** The newest composed issue for a kind, or one named period. */
async function storedIssue(db, period) {
  const { rows } = await db.query(
    `select period_key, facts, subject_line from email_issue
      where kind = $1 and facts is not null
        and ($2::text is null or period_key = $2)
      order by composed_at desc limit 1`,
    [KIND, period],
  );
  return rows[0] ?? null;
}

export async function cardOfWeekPreview({
  databaseUrl,
  db = null,
  bucket,
  period = null,
}) {
  const own = !db;
  if (own) {
    db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
  }
  try {
    const row = await storedIssue(db, period);
    if (!row) return { skipped: "no composed card_of_week issue to render" };
    const links = {
      // A preview is not a send: there is no recipient, so there is no
      // signed one-click token. The renderer demands both links, so the
      // preview names the page that would carry them.
      unsubscribe: `${SITE}/account/profile/email`,
      manage: `${SITE}/account/profile/email`,
      period: row.period_key,
      pixel: false,
    };
    const { subject, html } = renderMail(KIND, row.facts, links);
    const text = htmlToText(html);
    const base = `mail/${KIND}/${row.period_key}/preview`;
    await putAsset(bucket, `${base}.html`, html, "text/html; charset=utf-8");
    await putAsset(bucket, `${base}.txt`, text, "text/plain; charset=utf-8");
    await putJson(bucket, `${base}.json`, {
      subject,
      period: row.period_key,
      card: row.facts?.card?.name ?? null,
      words: String(row.facts?.body_markdown ?? "")
        .split(/\s+/)
        .filter(Boolean).length,
    });
    return {
      period: row.period_key,
      subject,
      card: row.facts?.card?.name ?? null,
      html_key: `${base}.html`,
      text_key: `${base}.txt`,
      bytes: html.length,
    };
  } finally {
    if (own) await db.end();
  }
}
