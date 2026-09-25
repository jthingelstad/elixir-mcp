#!/usr/bin/env node
/**
 * One-time account bootstrap (run with AWS_PROFILE=cloud-engineer, before the first
 * deploy — GATED like the deploy itself; creates S3/secret resources):
 *
 *  1. code bucket elixir-mcp-code-<account>
 *  2. app secret elixir-mcp/app: db_password + session_secret generated
 *     URL-SAFE here (the password rides a postgres:// URL in Lambda env),
 *     never through a terminal or agent. Later keys (buttondown_api_token,
 *     anthropic_api_key) are added by secret-add-keys.mjs.
 *
 * It creates no IAM principal and writes no credential: collectors hold
 * no AWS identity at all (docs/COLLECTOR-ZERO-TRUST.md) and enroll at the
 * collector door. Idempotent: existing resources are left alone and
 * reported.
 */

import crypto from "node:crypto";
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

const REGION = process.env.AWS_REGION ?? "us-east-1";
const SECRET_NAME = "elixir-mcp/app";

const urlSafeSecret = (bytes) =>
  crypto.randomBytes(bytes).toString("base64url").replace(/[-_]/g, "a");

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
  await secrets.send(
    new CreateSecretCommand({
      Name: SECRET_NAME,
      Description: "elixir-mcp app secrets: db password, session secret",
      SecretString: JSON.stringify({
        db_password: urlSafeSecret(24),
        session_secret: urlSafeSecret(32),
      }),
    }),
  );
  console.log(`created secret: ${SECRET_NAME}`);
}

console.log(`\nbootstrap complete. code bucket: ${bucket}`);
