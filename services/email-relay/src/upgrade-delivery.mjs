import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

/** Upgrade notices claim a stable send identity BEFORE SES. A completed
 * receipt suppresses every duplicate, even after outbox deletion. A
 * crash or ambiguous transport outcome leaves a pending receipt and
 * retries fail closed for inspection (SES has no idempotency token).
 * Definitive SES rejections release the claim so the queue can retry. */
export function upgradeDeliveryStore(bucket, s3) {
  const key = (id) => `mail-delivery/collector-upgrade/${id}.json`;
  return {
    async claim(id) {
      if (!/^[0-9a-f-]{36}$/.test(id))
        throw new Error("invalid_upgrade_send_id");
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key(id),
            IfNoneMatch: "*",
            Body: JSON.stringify({ status: "pending" }),
            ContentType: "application/json",
          }),
        );
        return "claimed";
      } catch (err) {
        if (err?.$metadata?.httpStatusCode !== 412) throw err;
        const r = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: key(id) }),
        );
        return JSON.parse(await r.Body.transformToString()).status;
      }
    },
    async finish(id, messageId) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key(id),
          Body: JSON.stringify({ status: "sent", message_id: messageId }),
          ContentType: "application/json",
        }),
      );
    },
    async release(id) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key(id) }));
    },
  };
}
