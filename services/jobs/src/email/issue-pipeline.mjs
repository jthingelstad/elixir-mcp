/** The spine both WRITTEN kinds share: a program builds a brief, a model
 *  writes from it, a lint refuses what does not trace, and only then is
 *  there an issue to send (docs/EMAIL.md, "how it stays honest").
 *
 *  The Top 100 had this inline and Card of the Week needed the same
 *  shape, so it is one module rather than two copies. What differs per
 *  kind is passed in: how to build the brief, which names the writer may
 *  have mangled, and what facts the renderer wants. What does not differ
 *  - the archive key, the editor queue, the lint gate, the owner notice
 *  on a failure, the ledger row - lives here.
 *
 *  A failing issue does not send and the owner hears why. That is the
 *  whole point of the gate: a newsletter that prints a wrong number is a
 *  trust problem, not a bug. */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { upsertIssue } from "./ledger.mjs";
import { lintIssue, repairNames } from "@elixir-mcp/mail";

const SITE = "https://elixir.poapkings.com";
const s3 = new S3Client({});
const sqs = new SQSClient({});

/** Where an issue's brief, draft and answer live. One prefix per kind
 *  and period, so a week's whole paper trail is one listing. */
const briefKey = (kind, periodKey) => `mail/${kind}/${periodKey}/brief.json`;

async function readJson(bucket, key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return JSON.parse(await out.Body.transformToString());
}

export async function putJson(bucket, key, value) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json",
    }),
  );
  return key;
}

/** Binary beside the brief (the season chart), so the renderer has a URL
 *  and the writer never sees the series except through the brief. */
export async function putAsset(bucket, key, body, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return key;
}

/** The editor is reached through its queue: the VPC has no Lambda
 *  endpoint, the way mail reaches the relay. */
async function queueForEditor({ key, kind }) {
  if (!process.env.EDITOR_QUEUE_URL) return false;
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.EDITOR_QUEUE_URL,
      MessageBody: JSON.stringify({ brief_key: key, kind }),
    }),
  );
  return true;
}

/** Store a brief and hand it to the editor. */
export async function generateIssue({
  db,
  bucket,
  kind,
  periodKey,
  brief,
  subjectKey = "",
}) {
  const key = await putJson(bucket, briefKey(kind, periodKey), brief);
  await upsertIssue(db, {
    kind,
    periodKey,
    subjectKey,
    status: "composed",
    note: `brief ${key}`,
  });
  const queued = await queueForEditor({ key, kind });
  return { brief_key: key, period_key: periodKey, queued };
}

/** The owner hears about a SCHEDULED issue failing, because that is a
 *  week with no mail and nobody else is watching. An operator who forced
 *  a regenerate is already looking at the result, and mailing them their
 *  own iteration is noise that teaches people to ignore the alert that
 *  matters. */
export const shouldNotifyOwner = (brief) => !brief?.ops;

/** The editor's answer, linted and stored - or refused, with the owner
 *  told why. `names` are the brief's own spellings (a name the model
 *  wrote through a broken escape comes back from the brief before
 *  anything else looks at the body); `factsOf` shapes what the renderer
 *  receives. */
export async function acceptIssue({
  db,
  bucket,
  key,
  kind,
  periodKey = null,
  subjectKey = "",
  names = () => [],
  factsOf,
  enqueue = null,
}) {
  const briefK = key.replace(/issue\.json$/, "brief.json");
  const [issue, brief] = await Promise.all([
    readJson(bucket, key),
    readJson(bucket, briefK),
  ]);
  issue.body_markdown = repairNames(issue.body_markdown, names(brief));
  const problems = lintIssue(issue, brief, { kind });
  const period =
    periodKey ?? brief.period_key ?? brief.window?.issue_date ?? null;
  if (problems.length) {
    await upsertIssue(db, {
      kind,
      periodKey: period,
      subjectKey,
      status: "failed",
      note: `${brief.ops ? "[ops] " : ""}${problems.join("; ")}`,
    });
    if (enqueue && shouldNotifyOwner(brief))
      await enqueue({
        v: 1,
        kind: "owner_notify",
        to: process.env.OWNER_NOTIFY_EMAIL || "elixir@poapkings.com",
        note: `${kind} issue ${period} failed lint: ${problems.slice(0, 5).join("; ")}`,
        link: `${SITE}/admin`,
      });
    return { accepted: false, problems, period };
  }
  const facts = factsOf(brief, issue);
  await upsertIssue(db, {
    kind,
    periodKey: period,
    subjectKey,
    facts,
    subjectLine: issue.subject,
    status: "composed",
    note: `issue ${key}`,
  });
  return { accepted: true, period, subject: issue.subject };
}
