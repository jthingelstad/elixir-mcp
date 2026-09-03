#!/usr/bin/env node
/**
 * One-time account bootstrap (run with AWS_PROFILE=jamie, before the first
 * deploy — GATED like the deploy itself; creates IAM/S3/secret resources):
 *
 *  1. code bucket elixir-mcp-code-<account>
 *  2. app secret elixir-mcp/app: db_password + session_secret generated
 *     URL-SAFE here (the password rides a postgres:// URL in Lambda env);
 *     jmap_token read from the repo-root .env (ELIXIR_MCP_JMAP_TOKEN) —
 *     secret values flow file -> AWS, never through a terminal or agent.
 *  3. gateway IAM user elixir-mcp-gw-jamie scoped to exactly the two
 *     request queues (receive), the results queue (send), and its own
 *     metric namespace; access key appended to .env (0600).
 *
 * Idempotent: existing resources are left alone and reported.
 */

import crypto from "node:crypto";
import { readFile, appendFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  S3Client,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  DescribeSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  IAMClient,
  CreateUserCommand,
  GetUserCommand,
  PutUserPolicyCommand,
  CreateAccessKeyCommand,
  ListAccessKeysCommand,
} from "@aws-sdk/client-iam";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const REGION = process.env.AWS_REGION ?? "us-east-1";
const SECRET_NAME = "elixir-mcp/app";
const GW_USER = "elixir-mcp-gw-jamie";

const urlSafeSecret = (bytes) =>
  crypto.randomBytes(bytes).toString("base64url").replace(/[-_]/g, "a");

async function envValue(name) {
  try {
    const text = await readFile(path.join(repoRoot, ".env"), "utf8");
    const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : process.env[name];
  } catch {
    return process.env[name];
  }
}

const sts = new STSClient({ region: REGION });
const { Account: accountId } = await sts.send(new GetCallerIdentityCommand({}));
const bucket = `elixir-mcp-code-${accountId}`;

// 1. Code bucket -------------------------------------------------------------
const s3 = new S3Client({ region: REGION });
try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`bucket exists: ${bucket}`);
} catch {
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    }),
  );
  console.log(`created bucket: ${bucket}`);
}

// 2. App secret --------------------------------------------------------------
const secrets = new SecretsManagerClient({ region: REGION });
try {
  await secrets.send(new DescribeSecretCommand({ SecretId: SECRET_NAME }));
  console.log(`secret exists: ${SECRET_NAME} (left untouched)`);
} catch {
  const jmapToken = await envValue("ELIXIR_MCP_JMAP_TOKEN");
  if (!jmapToken) {
    console.error(
      "ELIXIR_MCP_JMAP_TOKEN missing from .env; add the Fastmail API token first.",
    );
    process.exit(2);
  }
  await secrets.send(
    new CreateSecretCommand({
      Name: SECRET_NAME,
      Description:
        "elixir-mcp app secrets: db password, session secret, JMAP token",
      SecretString: JSON.stringify({
        db_password: urlSafeSecret(24),
        session_secret: urlSafeSecret(32),
        jmap_token: jmapToken,
      }),
    }),
  );
  console.log(`created secret: ${SECRET_NAME}`);
}

// 3. Gateway IAM user --------------------------------------------------------
const iam = new IAMClient({ region: REGION });
try {
  await iam.send(new GetUserCommand({ UserName: GW_USER }));
  console.log(`iam user exists: ${GW_USER}`);
} catch {
  await iam.send(new CreateUserCommand({ UserName: GW_USER }));
  console.log(`created iam user: ${GW_USER}`);
}
await iam.send(
  new PutUserPolicyCommand({
    UserName: GW_USER,
    PolicyName: "elixir-mcp-gateway",
    PolicyDocument: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "sqs:ReceiveMessage",
            "sqs:DeleteMessage",
            "sqs:ChangeMessageVisibility",
            "sqs:GetQueueUrl",
            "sqs:GetQueueAttributes",
          ],
          Resource: [
            `arn:aws:sqs:${REGION}:${accountId}:elixir-mcp-cr-requests-live`,
            `arn:aws:sqs:${REGION}:${accountId}:elixir-mcp-cr-requests-bulk`,
          ],
        },
        {
          Effect: "Allow",
          Action: ["sqs:SendMessage", "sqs:GetQueueUrl"],
          Resource: `arn:aws:sqs:${REGION}:${accountId}:elixir-mcp-cr-results`,
        },
        {
          Effect: "Allow",
          Action: "cloudwatch:PutMetricData",
          Resource: "*",
          Condition: {
            StringLike: { "cloudwatch:namespace": "ElixirMCP/Gateway/*" },
          },
        },
      ],
    }),
  }),
);
const { AccessKeyMetadata: keys } = await iam.send(
  new ListAccessKeysCommand({ UserName: GW_USER }),
);
if (keys.length === 0) {
  const { AccessKey } = await iam.send(
    new CreateAccessKeyCommand({ UserName: GW_USER }),
  );
  const envPath = path.join(repoRoot, ".env");
  await appendFile(
    envPath,
    `AWS_ACCESS_KEY_ID=${AccessKey.AccessKeyId}\nAWS_SECRET_ACCESS_KEY=${AccessKey.SecretAccessKey}\nAWS_REGION=${REGION}\n`,
  );
  await chmod(envPath, 0o600);
  console.log("gateway access key appended to .env (0600)");
} else {
  console.log("gateway access key exists (not rotated)");
}

console.log(`\nbootstrap complete. code bucket: ${bucket}`);
