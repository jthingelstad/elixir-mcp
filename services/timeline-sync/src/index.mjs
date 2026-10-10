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
} from "@aws-sdk/client-s3";
import { makeOutbox } from "@elixir-mcp/outbox";
import {
  makeStatusReader,
  syncAccount,
  syncClan,
} from "@elixir-mcp/syndication";
import { createPostgresLedger } from "@elixir-mcp/clan-state/postgres";
import { createModelService } from "@elixir-mcp/clan/manage/model.mjs";
import { createModelBridge } from "@elixir-mcp/clan/model-bridge.mjs";
import { modelStorage } from "@elixir-mcp/clan/model-storage.mjs";
import { makeHandler } from "./handler.mjs";

const s3 = new S3Client({});
const bucket = process.env.OUTBOX_BUCKET;
const outbox = makeOutbox(bucket, s3);
const readStatus = makeStatusReader(bucket, s3);
const secret = process.env.CLAN_MODEL_SECRET || null;

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
 * The clan's model, for its channel's rewrite: the clan's key through
 * Clan's model bridge (the relay calls Anthropic), recorded in the
 * clan's ledger on a connection of its own, so the use is on record
 * whatever becomes of the sync's transaction. Without the secret there
 * is no rewrite and Elixir's own lines are posted.
 */
const rewriter = (remainingMs) =>
  secret
    ? async (_db, clanTag, request) => {
        const own = await connect();
        try {
          const model = createModelService({
            ledger: createPostgresLedger(own),
            secret,
            rosterFor: async () => null,
            anthropic: createModelBridge({
              secret,
              storage: modelStorage(bucket, s3),
              timeoutMs: () => Math.min(25_000, remainingMs() - 8000),
            }),
          });
          return await model.writeUnattended(clanTag, request, {
            ownerLeads: (tag) => leadsNow(own, clanTag, tag),
          });
        } finally {
          await own.end().catch(() => {});
        }
      }
    : null;

export const handler = makeHandler({
  connect,
  sync: (db, accountId) => syncAccount(db, accountId, { outbox, readStatus }),
  syncClan: (db, clanTag, { remainingMs }) =>
    syncClan(db, clanTag, {
      outbox,
      readStatus,
      policyFor: (d, tag) => createPostgresLedger(d).currentPolicy(tag),
      rewrite: rewriter(remainingMs),
    }),
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
