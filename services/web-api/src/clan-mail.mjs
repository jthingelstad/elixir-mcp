/**
 * A family app's own mail, sent through Elixir (JSON API 2.4.0; Jamie,
 * 2026-09-25): `POST /api/v1/clans/{tag}/mail` on an integration key with
 * `mail:send`. Elixir Clan composes "actions waiting for you" after its
 * morning run and names who each email is for by player tag; Elixir holds
 * the addresses, the switches (on to start) and the unsubscribe, and the
 * app never sees an address.
 *
 * For each message Elixir finds the account whose VERIFIED claim is that
 * player, checks the player is in the clan today and the account has the
 * kind switched on, and sends at most one of the kind per clan per account
 * per UTC day, under a lock so two calls cannot both pass the check. The
 * app's words are plain lines that the renderer escapes; its link must
 * lead to a family app. Each send is recorded like every Elixir email
 * (the issue, the archive, the send id in the footer, the console's
 * record), and a message that cannot be sent says why.
 */

import { normalizeTag } from "@elixir-mcp/contracts";
import { FIRST_PARTY_ORIGINS } from "@elixir-mcp/auth";
import { upsertIssue } from "../../jobs/src/email/ledger.mjs";
import { deliver } from "../../jobs/src/email/deliver.mjs";

/** The kinds a family app may send through this door. */
const CLAN_MAIL_KINDS = ["clan_actions_waiting"];
const MAX_MESSAGES = 50;
const MAX_LINES = 12;
const LINE_MAX = 160;
const SUBJECT_MAX = 120;

class MailError extends Error {
  constructor(status, code, detail) {
    super(detail ?? code);
    this.status = status;
    this.code = code;
  }
}

const bad = (detail) => new MailError(400, "invalid_mail", detail);

function tagOf(value, what) {
  try {
    return normalizeTag(String(value ?? ""));
  } catch {
    throw new MailError(400, "invalid_tag", `${what} is not a tag.`);
  }
}

const plain = (v) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();

/** One message as the app sent it, checked; anything off is refused. */
function checkMessage(m, i) {
  if (!m || typeof m !== "object")
    throw bad(`messages[${i}] is not an object.`);
  const player_tag = tagOf(m.player_tag, `messages[${i}].player_tag`);
  const subject = plain(m.subject);
  if (!subject || subject.length > SUBJECT_MAX)
    throw bad(`messages[${i}].subject is 1 to ${SUBJECT_MAX} characters.`);
  if (!Array.isArray(m.lines) || !m.lines.length || m.lines.length > MAX_LINES)
    throw bad(`messages[${i}].lines is 1 to ${MAX_LINES} lines.`);
  const lines = m.lines.map(plain);
  if (lines.some((l) => !l || l.length > LINE_MAX))
    throw bad(`each line is 1 to ${LINE_MAX} characters.`);
  let link;
  try {
    link = new URL(String(m.link ?? ""));
  } catch {
    throw bad(`messages[${i}].link is not a URL.`);
  }
  if (!FIRST_PARTY_ORIGINS.includes(link.origin))
    throw bad(`messages[${i}].link must lead to one of the family's apps.`);
  return { player_tag, subject, lines, link: link.toString() };
}

/** The account that proved this player, if it may be mailed. */
async function recipientOf(db, playerTag, clanTag, kind) {
  const { rows } = await db.query(
    `select a.account_id, a.email,
            exists (select 1 from clan_membership m
                     where m.clan_tag = $2 and m.player_tag = c.player_tag
                       and m.left_observed_at is null) as in_clan,
            coalesce((select p.enabled from account_email_pref p
                       where p.account_id = a.account_id and p.kind = $3), true)
              as enabled
       from claim c
       join account a on a.account_id = c.account_id
      where c.player_tag = $1 and c.status = 'verified'
        and a.kind = 'person' and a.status = 'approved'`,
    [playerTag, clanTag, kind],
  );
  const r = rows[0];
  if (!r) return { status: "no_account" };
  if (!r.in_clan) return { status: "not_in_clan" };
  if (!r.email) return { status: "no_address" };
  if (!r.enabled) return { status: "switched_off" };
  return { account: { accountId: r.account_id, email: r.email } };
}

export async function sendClanMail(
  db,
  integration,
  clanInput,
  body,
  { enqueue, secret, archive = null, now = () => new Date() } = {},
) {
  const clanTag = tagOf(clanInput, "clan_tag");
  const kind = String(body.kind ?? "");
  if (!CLAN_MAIL_KINDS.includes(kind))
    throw new MailError(
      400,
      "unknown_mail_kind",
      `A family app sends: ${CLAN_MAIL_KINDS.join(", ")}.`,
    );
  if (
    !Array.isArray(body.messages) ||
    !body.messages.length ||
    body.messages.length > MAX_MESSAGES
  )
    throw bad(`messages is 1 to ${MAX_MESSAGES} emails.`);
  const messages = body.messages.map(checkMessage);
  if (!enqueue || !secret)
    throw new MailError(
      503,
      "temporarily_unavailable",
      "Mail is not wired here.",
    );
  const { rows: clanRows } = await db.query(
    `select name from clan where clan_tag = $1`,
    [clanTag],
  );
  if (!clanRows[0]) throw new MailError(404, "not_recorded");
  const at = now();
  const day = at.toISOString().slice(0, 10);
  const issueKey = `${kind}/${day}/${clanTag}`;
  // One caller at a time per clan, kind and day: the per-account check
  // below is code, and the web-api runs many at once. A session lock, not
  // a transaction: a send already handed to the outbox keeps its record
  // even if a later message fails.
  const lockKey = `clan-mail:${issueKey}`;
  await db.query(`select pg_advisory_lock(hashtext($1))`, [lockKey]);
  try {
    const issueId = await upsertIssue(db, {
      kind,
      periodKey: day,
      subjectKey: clanTag,
      facts: { clan_tag: clanTag, source: integration.name },
      status: "queued",
    });
    const results = [];
    for (const m of messages) {
      const who = await recipientOf(db, m.player_tag, clanTag, kind);
      if (!who.account) {
        results.push({ player_tag: m.player_tag, status: who.status });
        continue;
      }
      try {
        const sent = await deliver({
          db,
          enqueue,
          secret,
          kind,
          issueId,
          issueKey,
          period: day,
          account: who.account,
          archive,
          now: at,
          facts: {
            clan: { tag: clanTag, name: clanRows[0].name ?? null },
            app:
              integration.name === "elixir-clan"
                ? "Elixir Clan"
                : integration.name,
            subject: m.subject,
            lines: m.lines,
            link: m.link,
          },
        });
        results.push(
          sent.sent
            ? {
                player_tag: m.player_tag,
                status: "sent",
                send_id: sent.send_id,
              }
            : { player_tag: m.player_tag, status: "already_sent_today" },
        );
      } catch (err) {
        // The compose-failure alarm reads this line in the web-api log.
        console.error(
          JSON.stringify({
            level: "error",
            email_compose_failed: kind,
            clan_tag: clanTag,
            error: err?.message ?? String(err),
          }),
        );
        results.push({ player_tag: m.player_tag, status: "failed" });
      }
    }
    return { kind, day, clan_tag: clanTag, results };
  } finally {
    await db.query(`select pg_advisory_unlock(hashtext($1))`, [lockKey]);
  }
}
