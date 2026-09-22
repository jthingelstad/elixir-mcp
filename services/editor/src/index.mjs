/** The editor Lambda: the one function that talks to a model. Non-VPC,
 *  on the relay's pattern (the VPC Lambdas have no internet); reads
 *  the brief the jobs Lambda wrote to the archive bucket, runs the
 *  writer and the editor, writes the issue beside the brief, and hands
 *  it back to the jobs Lambda to lint and store. The API key arrives
 *  from the app secret in the environment and is never logged. */
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { generateIssue } from "./generate.mjs";
import { lintIssue } from "@elixir-mcp/mail";

const s3 = new S3Client({});
const lambda = new LambdaClient({});

export async function handler(event) {
  const bucket = process.env.ARCHIVE_BUCKET;
  // Reached through its SQS queue (one message per issue), or invoked
  // directly with {brief_key} from the ops side.
  const record = event?.Records?.[0];
  const message = record ? JSON.parse(record.body) : (event ?? {});
  const briefKey = message?.brief_key;
  if (!briefKey) throw new Error("editor: brief_key missing");
  const out = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: briefKey }),
  );
  const brief = JSON.parse(await out.Body.transformToString());
  // The brief says what it is; the message is the fallback for an ops
  // invoke that named only a key.
  const kind = brief.kind ?? message?.kind ?? "top_100";
  const started = Date.now();
  const result = await generateIssue({
    brief,
    kind,
    lint: lintIssue,
    log: (l) => console.log(JSON.stringify({ editor: l, kind })),
  });
  const issueKey = briefKey.replace(/brief\.json$/, "issue.json");
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: issueKey,
      ContentType: "application/json",
      Body: JSON.stringify({
        ...result.issue,
        _pipeline: {
          draft_findings: result.draft_findings,
          paths_read: result.paths_read,
          ms: Date.now() - started,
          model: process.env.EDITOR_MODEL || "claude-opus-5",
        },
      }),
    }),
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: briefKey.replace(/brief\.json$/, "draft.json"),
      ContentType: "application/json",
      Body: JSON.stringify(result.draft),
    }),
  );
  if (process.env.JOBS_FUNCTION)
    await lambda.send(
      new InvokeCommand({
        FunctionName: process.env.JOBS_FUNCTION,
        InvocationType: "Event",
        Payload: Buffer.from(
          JSON.stringify({ issue_accept: { key: issueKey, kind } }),
        ),
      }),
    );
  console.log(
    JSON.stringify({
      editor_done: {
        kind,
        issueKey,
        draft_findings: result.draft_findings.length,
        ms: Date.now() - started,
      },
    }),
  );
  return { issue_key: issueKey };
}
