/** Narrow immutable object adapter. No payloads, keys or responses logged. */
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
export function modelStorage(bucket, s3 = new S3Client({ maxAttempts: 2 })) {
  if (!bucket) throw new Error("private model bridge needs its bucket");
  return {
    async get(key) {
      try {
        const out = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          { abortSignal: AbortSignal.timeout(3000) },
        );
        return await out.Body.transformToString();
      } catch (e) {
        if (["NoSuchKey", "NotFound"].includes(e.name)) return null;
        throw e;
      }
    },
    async put(key, body) {
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: "application/json",
            ServerSideEncryption: "AES256",
            IfNoneMatch: "*",
          }),
          { abortSignal: AbortSignal.timeout(3000) },
        );
        return true;
      } catch (e) {
        if (e.name === "PreconditionFailed") return false;
        throw e;
      }
    },
  };
}
