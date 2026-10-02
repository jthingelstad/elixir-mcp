/** IAM-only private Clan maintenance, bounded by kind and clan. This is
 * not a public API or a way to read a sealed key. Reads never mark replies
 * seen; a response defaults to preview and refuses a changed item. */
import pg from "pg";
import { createHash } from "node:crypto";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
import { createFeedbackService } from "@elixir-mcp/clan/feedback.mjs";
import { normalizeTag } from "@elixir-mcp/clan/gate.mjs";
import { reconstructedLog } from "@elixir-mcp/clan-engine";
const digest = (body) =>
  createHash("sha256").update(JSON.stringify(body)).digest("hex");
const id = (value) => {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value ?? ""))
    throw new Error("invalid private item id");
  return value;
};
export async function clanMaintenance(databaseUrl, spec) {
  const lane = spec?.lane;
  if (
    ![
      "feedback",
      "actions",
      "respond",
      "clans",
      "grants",
      "morning",
      "action_log",
      "policies",
    ].includes(lane)
  )
    throw new Error("unknown Clan maintenance lane");
  const limit = spec.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Clan maintenance limit is 1 through 100");
  const feedbackId =
    lane === "respond" || spec.feedback_id ? id(spec.feedback_id) : null;
  const clanLane = [
    "actions",
    "grants",
    "morning",
    "action_log",
    "policies",
  ].includes(lane);
  const clanTag = clanLane ? normalizeTag(spec.clan_tag) : null;
  if (clanLane && !clanTag)
    throw new Error("Clan actions need a valid clan tag");
  const cardId = spec.card_id ? id(spec.card_id) : null;
  if (lane === "action_log" && !cardId)
    throw new Error("action log needs a card id");
  const cursor = spec.cursor ?? "";
  if (
    typeof cursor !== "string" ||
    cursor.length > 300 ||
    /[^A-Za-z0-9_#:.+\-TZ]/.test(cursor)
  )
    throw new Error("invalid maintenance cursor");
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const ledger = createPostgresLedger(db);
    // Each read is a bounded page. Cursor is the actual index key; totals
    // count the whole matching inventory, including rows before the page.
    async function page(partition, prefix) {
      const where = "partition_key=$1 and starts_with(sort_key,$2)";
      const total = Number(
        (
          await db.query(
            `select count(*)::int as n from clan_state where ${where}`,
            [partition, prefix],
          )
        ).rows[0].n,
      );
      const rows = (
        await db.query(
          `select body, sort_key from clan_state where ${where} and sort_key collate "C" > $3 collate "C" order by sort_key collate "C" limit $4`,
          [partition, prefix, cursor, limit + 1],
        )
      ).rows;
      const more = rows.length > limit;
      rows.length = Math.min(rows.length, limit);
      return {
        items: rows.map((r) => r.body),
        total,
        next_cursor: more ? rows.at(-1).sort_key : null,
        limit,
      };
    }
    if (lane === "clans") {
      const where = "starts_with(pk,'policy#') and not pk like '%#v%'";
      const total = Number(
        (
          await db.query(
            `select count(*)::int as n from clan_state where ${where}`,
          )
        ).rows[0].n,
      );
      const rows = (
        await db.query(
          `select pk, substr(pk,8) as clan_tag from clan_state where ${where} and pk collate "C" > $1 collate "C" order by pk collate "C" limit $2`,
          [cursor, limit + 1],
        )
      ).rows;
      const more = rows.length > limit;
      rows.length = Math.min(rows.length, limit);
      return {
        lane,
        clans: rows.map((r) => ({ clan_tag: r.clan_tag })),
        total,
        next_cursor: more ? rows.at(-1).pk : null,
        limit,
      };
    }
    if (lane === "morning")
      return { lane, clan_tag: clanTag, receipt: await ledgerOverMorning() };
    async function ledgerOverMorning() {
      return (
        (
          await db.query("select body from clan_state where pk=$1", [
            `morning#${clanTag}`,
          ])
        ).rows[0]?.body ?? null
      );
    }
    if (lane === "grants" || lane === "action_log" || lane === "policies")
      return {
        lane,
        clan_tag: clanTag,
        ...(await page(
          `clan#${clanTag}`,
          lane === "grants"
            ? "award#"
            : lane === "policies"
              ? "policy#v"
              : `action_log#${cardId}#`,
        )),
      };
    if (lane === "feedback") {
      const items = feedbackId
        ? (
            await db.query("select body from clan_state where pk=$1", [
              `feedback#${feedbackId}`,
            ])
          ).rows
        : (
            await db.query(
              `select body from clan_state where partition_key='feedback#queue'
          and ($1::boolean or body->>'status' in ('new','planned') or nullif(btrim(body->>'response'),'') is null)
          and sort_key collate "C" > $3 collate "C"
          order by sort_key collate "C" limit $2`,
              [spec.all === true, limit + 1, cursor],
            )
          ).rows;
      const total = feedbackId
        ? items.length
        : Number(
            (
              await db.query(
                `select count(*)::int as n from clan_state where partition_key='feedback#queue' and ($1::boolean or body->>'status' in ('new','planned') or nullif(btrim(body->>'response'),'') is null)`,
                [spec.all === true],
              )
            ).rows[0].n,
          );
      const more = items.length > limit;
      items.length = Math.min(items.length, limit);
      return {
        lane,
        total,
        limit,
        next_cursor: more ? items.at(-1).body.gsi1sk : null,
        items: items.map(({ body }) => ({
          ...body,
          expected_sha256: digest(body),
        })),
      };
    }
    if (lane === "respond") {
      if (!["seen", "planned", "done", "declined"].includes(spec.status))
        throw new Error("invalid Clan feedback status");
      if (!/^[a-f0-9]{64}$/.test(spec.expected_sha256 ?? ""))
        throw new Error("Clan response needs the read-back digest");
      await db.query("begin");
      const current = (
        await db.query("select body from clan_state where pk=$1 for update", [
          `feedback#${feedbackId}`,
        ])
      ).rows[0]?.body;
      if (!current || digest(current) !== spec.expected_sha256)
        throw new Error("Clan feedback changed; read it again");
      const patch = {
        status: spec.status,
        response: spec.response,
        shipped_in: spec.shipped_in,
      };
      if (spec.apply !== true) {
        await db.query("rollback");
        return {
          lane,
          applied: false,
          feedback_id: feedbackId,
          status: patch.status,
        };
      }
      const next = await createFeedbackService({ ledger }).decide(
        { maintainer: true },
        feedbackId,
        patch,
      );
      const stored = (
        await db.query("select body from clan_state where pk=$1", [
          `feedback#${feedbackId}`,
        ])
      ).rows[0].body;
      await db.query("commit");
      return {
        lane,
        applied: true,
        feedback_id: feedbackId,
        status: next.status,
        expected_sha256: digest(stored),
      };
    }
    const cardPage = await page(`clan#${clanTag}`, "card#");
    const cards = cardId
      ? (
          await db.query("select body from clan_state where pk=$1", [
            `card#${clanTag}#${cardId}`,
          ])
        ).rows.map((r) => r.body)
      : cardPage.items;
    const items = [];
    for (const card of cards) {
      const stored = (
        await db.query(
          `select body from clan_state where partition_key=$1 and starts_with(sort_key,$2)
        order by sort_key collate "C" limit 4`,
          [`clan#${clanTag}`, `action_log#${card.card_id}#`],
        )
      ).rows.map((r) => r.body);
      const logTruncated = stored.length > 3;
      stored.length = Math.min(stored.length, 3);
      const kinds = new Set(stored.map((e) => e.kind));
      const log = stored.some((e) => e.kind === "raised")
        ? stored
        : [
            ...reconstructedLog(card).filter((e) => !kinds.has(e.kind)),
            ...stored,
          ].sort((a, b) => a.at.localeCompare(b.at));
      items.push({ card, log, log_limit: 3, log_truncated: logTruncated });
    }
    return {
      lane,
      clan_tag: clanTag,
      items,
      limit,
      total: cardId ? cards.length : cardPage.total,
      next_cursor: cardId ? null : cardPage.next_cursor,
      context: {
        policy: await ledger.currentPolicy(clanTag),
        verdicts: await ledger.latestVerdicts(clanTag),
        awards: await ledger.currentAwards(clanTag),
        awards_snapshot: await ledger.latestAwardsSnapshot(clanTag),
      },
    };
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}
