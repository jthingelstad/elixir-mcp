/** Narrow immutable object adapter. No payloads, keys or responses logged. */
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
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
        // Prefix-scoped listing does not authorize an unrestricted missing-key
        // lookup. Confirm absence using only the exact reply/claim key; a
        // denied list or a listed object keeps the original lookup failure.
        if (
          e.name === "AccessDenied" &&
          /^clan-model\/(?:reply|claim)\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/.test(
            key,
          )
        ) {
          const listed = await s3.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: key,
              MaxKeys: 1,
            }),
            { abortSignal: AbortSignal.timeout(3000) },
          );
          if (listed.Contents?.length === 0 && listed.IsTruncated === false)
            return null;
          // S3 omits Contents for an empty result; require the count as proof.
          if (
            listed.Contents === undefined &&
            listed.KeyCount === 0 &&
            listed.IsTruncated === false
          )
            return null;
        }
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
