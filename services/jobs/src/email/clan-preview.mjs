/** {clan_report_preview: {clan_tag, at?}}: one clan's Monday report,
 *  read-only, for reading a change back against the live record. It
 *  composes the report the way the Monday run would for the week before
 *  `at` (default now), as the clan's oldest tracker, and renders it
 *  beside the issue already stored for that week, when there is one.
 *  The session is read-only (default_transaction_read_only), so nothing
 *  it calls can write: no issue, no send, no mail. */
import pg from "pg";
import { renderMail, htmlToText } from "@elixir-mcp/mail";
import { loadRecipients, accountCtx, callTool } from "./ctx.mjs";
import { lastGameWeek } from "./week.mjs";
import { buildClan } from "./build-clan.mjs";
import { tryTool } from "./shared.mjs";

const KIND = "clan_report";

export async function clanReportPreview({ databaseUrl, db: given }, spec = {}) {
  const clanTag = typeof spec.clan_tag === "string" ? spec.clan_tag : null;
  const at = spec.at ? new Date(spec.at) : new Date();
  if (!clanTag || Number.isNaN(at.getTime()))
    return { error: "clan_tag is required; at is an ISO instant" };
  const db = given ?? new pg.Client({ connectionString: databaseUrl });
  if (!given) await db.connect();
  try {
    await db.query("set session default_transaction_read_only = on");
    const week = lastGameWeek(at);
    const { rows: trackers } = await db.query(
      `select account_id from account_clan where clan_tag = $1`,
      [clanTag],
    );
    const ids = new Set(trackers.map((r) => r.account_id));
    // The Monday run's reader: the oldest account tracking the clan.
    const account = (await loadRecipients(db, KIND)).find((r) =>
      ids.has(r.accountId),
    );
    if (!account) return { error: "no account tracking that clan" };
    const links = {
      unsubscribe:
        "https://elixir.poapkings.com/api/email/unsubscribe?t=preview",
      manage: "https://elixir.poapkings.com/console/account/profile/email",
      period: week.key,
      timezone: account.timezone ?? "UTC",
    };
    const render = (facts) => {
      const { subject, html } = renderMail(KIND, facts, links);
      return { subject, text: htmlToText(html) };
    };
    const {
      rows: [stored],
    } = await db.query(
      `select facts, composed_at from email_issue
        where kind = $1 and period_key = $2 and subject_key = $3 and facts is not null`,
      [KIND, week.key, clanTag],
    );
    const clock = await tryTool(
      callTool,
      accountCtx(db, account),
      "game_clock",
      {
        at: new Date(week.to.getTime() - 1).toISOString(),
      },
    );
    const facts = await buildClan({
      db,
      account,
      clanTag,
      week,
      season: clock?.season_id ?? null,
    });
    return {
      clan_tag: clanTag,
      week: week.key,
      stored: stored
        ? {
            composed_at: stored.composed_at?.toISOString?.() ?? null,
            trend: stored.facts.trend ?? null,
            ...render(stored.facts),
          }
        : null,
      composed: facts ? { trend: facts.trend ?? null, ...render(facts) } : null,
    };
  } finally {
    if (given)
      await db.query("set session default_transaction_read_only = off");
    else await db.end();
  }
}
