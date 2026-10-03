import { createHash } from "node:crypto";
import pg from "pg";
import { emailHash } from "@elixir-mcp/auth/crypto";
import { upsertIssue } from "@elixir-mcp/mail/ledger";
import { deliver } from "@elixir-mcp/mail/deliver";

// Released collector versions are vX.Y.Z. Dev builds, hashes, missing
// versions and prereleases are not ordered as installed releases.
export function isUpgrade(from, to) {
  const parse = (v) =>
    /^v?(\d+)\.(\d+)\.(\d+)$/
      .exec(v ?? "")
      ?.slice(1)
      .map(BigInt);
  const a = parse(from),
    b = parse(to);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return b[i] > a[i];
  }
  return false;
}

/** Durable journal, bounded drain. The jobs function has concurrency one.
 * Each event has a stable send id and outbox key across enqueue/ledger
 * retries. Preferences are the existing collector_activity switch. */
export async function runCollectorUpgrades({
  databaseUrl,
  db = null,
  enqueue,
  secret,
  archive = null,
  accountEmail = null,
  replay = null,
  apply = false,
  remainingMs = null,
}) {
  const own = !db;
  if (own) {
    db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
  }
  const result = { sent: 0, skipped: 0, details: [] };
  try {
    if (replay !== null) {
      // Replay is a maintainer-only test lane, never a historical blast.
      if (
        !accountEmail ||
        !Array.isArray(replay) ||
        replay.length < 1 ||
        replay.length > 10
      )
        throw new Error("replay_requires_owner_email_and_1_to_10_transitions");
      const { rows: owners } = await db.query(
        `select account_id from account where email_hash = $1 and kind = 'person'
          and status = 'approved' and is_owner`,
        [emailHash(accountEmail)],
      );
      if (!owners[0]) throw new Error("replay_requires_owner_account");
      const ownerId = owners[0].account_id;
      // Validate the entire request before any write.
      const checked = [];
      for (const r of replay) {
        if (
          !isUpgrade(r.from_version, r.to_version) ||
          !r.evidence ||
          typeof r.evidence !== "string" ||
          r.evidence.length > 512 ||
          !Number.isFinite(Date.parse(r.observed_at)) ||
          Date.parse(r.observed_at) > Date.now()
        )
          throw new Error("replay_requires_past_observed_upgrade_and_evidence");
        const { rows: g } = await db.query(
          `select g.gateway_id from gateway g where (g.gateway_id::text = $1 or g.name = $1) and g.owner_account_id = $2
             and g.status <> 'revoked'`,
          [r.gateway_id ?? r.gateway_name, ownerId],
        );
        if (g.length !== 1) throw new Error("replay_collector_not_owned");
        if (
          r.release &&
          (r.release.release_url !==
            `https://github.com/jthingelstad/elixir-mcp-collector/releases/tag/${r.to_version}` ||
            typeof r.release.changes !== "string" ||
            r.release.changes.length > 12000 ||
            r.release.reason != null ||
            ![
              `https://github.com/jthingelstad/elixir-mcp-collector/releases/tag/${r.to_version}`,
              `https://github.com/jthingelstad/elixir-mcp-collector/compare/${r.from_version}...${r.to_version}`,
            ].includes(r.release.source_url))
        )
          throw new Error("invalid_replay_release_notes");
        checked.push({ ...r, gateway_id: g[0].gateway_id });
      }
      if (!apply)
        return {
          dry_run: true,
          collectors: checked.map((r) => r.gateway_id),
          sent: 0,
        };
      for (const r of checked) {
        const key = createHash("sha256")
          .update(`${r.gateway_id}/${r.from_version}/${r.to_version}`)
          .digest("hex");
        await db.query(
          `insert into collector_version_event (gateway_id, account_id, from_version, to_version,
             observed_at, signature_state, test, replay_key, evidence, release_details)
           values ($1, $2, $3, $4, $5, 'not_recorded', true, $6, $7, $8)
           on conflict (replay_key) do nothing`,
          [
            r.gateway_id,
            ownerId,
            r.from_version,
            r.to_version,
            r.observed_at,
            key,
            r.evidence,
            r.release ? JSON.stringify(r.release) : null,
          ],
        );
      }
    }
    // Pin test replay to that owner's events; scheduled drains never
    // send tests someone previously staged without explicitly applying.
    const { rows } = await db.query(
      `select e.*, g.card_name, g.name, g.status as gateway_status,
              g.owner_account_id, a.email, a.timezone, a.kind, a.status as account_status,
              not exists (select 1 from account_email_pref p where p.account_id = e.account_id
                           and p.kind = 'collector_activity' and not p.enabled) as enabled,
              n.release_url, n.changes, n.reason
       from collector_version_event e join gateway g using (gateway_id)
       join account a on a.account_id = e.account_id
       left join collector_release_note n on n.version = e.to_version
       where e.completed_at is null and e.test = $1
         and ($2::text is null or a.email_hash = $2)
       order by e.observed_at, e.event_id limit 100`,
      [replay !== null, accountEmail ? emailHash(accountEmail) : null],
    );
    for (const e of rows) {
      if (remainingMs && remainingMs() < 90_000) break;
      let outcome = "skipped";
      if (
        isUpgrade(e.from_version, e.to_version) &&
        e.enabled &&
        e.email &&
        e.account_status === "approved" &&
        e.kind === "person" &&
        e.gateway_status !== "revoked" &&
        e.owner_account_id === e.account_id
      ) {
        const facts = {
          event: "upgrade",
          test: e.test,
          name: e.card_name ?? e.name,
          from_version: e.from_version,
          to_version: e.to_version,
          observed_at: e.observed_at.toISOString(),
          signature_state: e.signature_state,
          release:
            e.release_details ??
            (/^v\d+\.\d+\.\d+$/.test(e.to_version)
              ? {
                  release_url:
                    e.release_url ??
                    `https://github.com/jthingelstad/elixir-mcp-collector/releases/tag/${e.to_version}`,
                  changes: e.changes,
                  reason: e.reason,
                }
              : null),
        };
        const issueKey = `collector-upgrade/${e.event_id}`;
        const issueId = await upsertIssue(db, {
          kind: "collector_activity",
          periodKey: issueKey,
          subjectKey: e.gateway_id,
          facts,
        });
        const enqueuedAt = new Date();
        const sent = await deliver({
          db,
          enqueue,
          secret,
          archive,
          kind: "collector_activity",
          issueId,
          issueKey,
          period: e.observed_at.toISOString().slice(0, 10),
          account: {
            accountId: e.account_id,
            email: e.email,
            timezone: e.timezone,
          },
          facts,
          sendId: e.send_id,
          now: enqueuedAt,
        });
        outcome = sent.sent ? "queued" : sent.reason;
        if (sent.sent) {
          result.sent++;
          result.details.push({
            event_id: e.event_id,
            send_id: e.send_id,
            subject: sent.subject,
            observed_at: facts.observed_at,
            enqueued_at: enqueuedAt.toISOString(),
          });
        }
      } else result.skipped++;
      await db.query(
        `update collector_version_event set completed_at = now(), outcome = $2
        where event_id = $1`,
        [e.event_id, outcome],
      );
    }
    return result;
  } finally {
    if (own) await db.end();
  }
}
