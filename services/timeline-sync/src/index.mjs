/** Lambda entrypoint: the timeline sync, for a person's or agent's
 *  timeline and for a clan's activity channel. In the VPC, so it reaches
 *  the database, and S3 through the gateway endpoint, and nothing else:
 *  the lines leave through the outbox for the Discord relay, and a
 *  clan's model is asked through Clan's model bridge. */
import pg from "pg";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { makeOutbox } from "@elixir-mcp/outbox";
import {
  makeHistoryReader,
  makeStatusReader,
  syncAccount,
  syncClan,
} from "@elixir-mcp/syndication";
import {
  applyReceipts,
  discordQuality,
  receiptsOf,
} from "@elixir-mcp/syndication/quality";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
import { createModelService } from "@elixir-mcp/clan/manage/model.mjs";
import { createModelBridge } from "@elixir-mcp/clan/model-bridge.mjs";
import { createDiscordBridge } from "@elixir-mcp/clan/discord-bridge.mjs";
import { createDiscordService } from "@elixir-mcp/clan/manage/discord.mjs";
import { clanDiscordWake } from "@elixir-mcp/clan/discord-wake.mjs";
import { modelStorage } from "@elixir-mcp/clan/model-storage.mjs";
import { makeHandler } from "./handler.mjs";

const s3 = new S3Client({});
const bucket = process.env.OUTBOX_BUCKET;
const outbox = makeOutbox(bucket, s3);
const readStatus = makeStatusReader(bucket, s3);
const readHistory = makeHistoryReader(bucket, s3);
const secret = process.env.CLAN_MODEL_SECRET || null;
const archive = process.env.ARCHIVE_BUCKET || null;

/** A clan model's run, raw, for the quality ledger: the archive bucket's
 *  discord-runs/, which its lifecycle keeps 30 days. */
const captureRun = archive
  ? (key, body) =>
      s3.send(
        new PutObjectCommand({
          Bucket: archive,
          Key: key,
          Body: JSON.stringify(body),
          ContentType: "application/json",
        }),
      )
  : null;

async function connect() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  return db;
}

const LEADERS = new Set(["leader", "coLeader"]);
/** Does the player lead the clan, by the recorded roster? */
async function leadsNow(db, clanTag, playerTag) {
  const { rows } = await db.query(
    `select role from clan_membership
      where clan_tag = $1 and player_tag = $2 and left_observed_at is null`,
    [clanTag, playerTag],
  );
  return rows.length ? LEADERS.has(rows[0].role) : false;
}

/**
 * The clan's model, as its channel's editor: one round a call, the
 * clan's key through Clan's model bridge (the relay calls Anthropic),
 * recorded in the clan's ledger on a connection of its own. The sync
 * asks it outside any transaction (`syncClan`'s phase two), so no row
 * is locked while the model writes. A round waits 50 s at most, and
 * leaves the run 15 s to write. Without the secret there is no model
 * and Elixir's own stories are posted.
 */
const rewriter = (remainingMs) =>
  secret
    ? async (_db, clanTag, request, { run, round }) => {
        const own = await connect();
        try {
          const model = createModelService({
            ledger: createPostgresLedger(own),
            secret,
            rosterFor: async () => null,
            anthropic: createModelBridge({
              secret,
              storage: modelStorage(bucket, s3),
              timeoutMs: () => Math.min(50_000, remainingMs() - 15_000),
            }),
          });
          return await model.writeUnattended(clanTag, request, {
            ownerLeads: (tag) => leadsNow(own, clanTag, tag),
            run,
            round,
          });
        } finally {
          await own.end().catch(() => {});
        }
      }
    : null;

/**
 * A clan's Actions in its Discord, a minute after a hand-off: under the
 * clan's lock, or not at all when another holder has it (it shares).
 */
async function shareClanDiscord(db, clanTag) {
  if (!secret) return { shared: 0, reason: "no_secret" };
  const lock = `clan-state:${clanTag}`;
  const { rows } = await db.query(
    "select pg_try_advisory_lock(hashtext($1)) as locked",
    [lock],
  );
  if (!rows[0].locked) return { shared: 0, reason: "locked" };
  try {
    return await createDiscordService({
      ledger: createPostgresLedger(db),
      secret,
      bridge: createDiscordBridge({
        secret,
        storage: modelStorage(bucket, s3),
      }),
      wake: clanDiscordWake(outbox),
      quality: discordQuality(db),
    }).share(clanTag);
  } finally {
    await db
      .query("select pg_advisory_unlock(hashtext($1))", [lock])
      .catch(() => {});
  }
}

export const handler = makeHandler({
  connect,
  sync: (db, accountId) => syncAccount(db, accountId, { outbox, readStatus }),
  syncClan: (db, clanTag, { remainingMs, editor }) =>
    syncClan(db, clanTag, {
      outbox,
      readStatus,
      readHistory,
      remainingMs,
      editor,
      policyFor: (d, tag) => createPostgresLedger(d).currentPolicy(tag),
      pitchFor: (d, tag) => createPostgresLedger(d).currentPitch(tag),
      rewrite: rewriter(remainingMs),
      captureRun,
    }),
  shareClanDiscord,
  // The relay's receipts, into the quality ledger (0222).
  receipts: async (db, msg) => {
    const list = receiptsOf(msg);
    if (list === null) return null;
    return { applied: await applyReceipts(db, list) };
  },
  async readObject(obj) {
    if (obj.bucket !== bucket) throw new Error("unknown bucket");
    try {
      const out = await s3.send(
        new GetObjectCommand({ Bucket: obj.bucket, Key: obj.key }),
      );
      return await out.Body.transformToString();
    } catch (err) {
      if (err?.name === "NoSuchKey") return null;
      throw err;
    }
  },
  deleteObject: (obj) =>
    s3.send(new DeleteObjectCommand({ Bucket: obj.bucket, Key: obj.key })),
});
