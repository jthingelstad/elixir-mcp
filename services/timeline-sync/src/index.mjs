/** Lambda entrypoint: the timeline sync. In the VPC, so it reaches the
 *  database, and S3 through the gateway endpoint, and nothing else: the
 *  lines leave through the outbox for the Discord relay. */
import pg from "pg";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { makeOutbox } from "@elixir-mcp/outbox";
import { makeStatusReader, syncAccount } from "@elixir-mcp/syndication";
import { makeHandler } from "./handler.mjs";

const s3 = new S3Client({});
const bucket = process.env.OUTBOX_BUCKET;
const outbox = makeOutbox(bucket, s3);
const readStatus = makeStatusReader(bucket, s3);

export const handler = makeHandler({
  async connect() {
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    return db;
  },
  sync: (db, accountId) => syncAccount(db, accountId, { outbox, readStatus }),
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
