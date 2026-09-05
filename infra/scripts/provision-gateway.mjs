#!/usr/bin/env node
/**
 * Owner-side collector provisioning (0034). Run LOCALLY with owner AWS
 * credentials — the NAT-free VPC lambdas cannot reach the IAM API, and
 * no public lambda should hold IAM powers:
 *
 *   AWS_PROFILE=jamie node infra/scripts/provision-gateway.mjs <gateway-name>
 *
 * Creates (idempotently) the per-gateway IAM user elixir-mcp-gw-<name>
 * with the standard queue/metrics policy, mints a fresh access key,
 * renders the collector .env (CR_API_TOKEN left as a placeholder — the
 * operator pastes their own key, the one exception by design), and
 * stages it via the migrate lambda for the operator's ONE-TIME download
 * from Account > Collector. The secret is never printed.
 */

import {
  IAMClient,
  CreateUserCommand,
  PutUserPolicyCommand,
  CreateAccessKeyCommand,
  ListAccessKeysCommand,
  DeleteAccessKeyCommand,
} from "@aws-sdk/client-iam";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const REGION = "us-east-1";
const name = process.argv[2];
if (!name || !/^[a-z0-9][a-z0-9-]{1,30}$/.test(name)) {
  console.error(
    "usage: provision-gateway.mjs <gateway-name>  (lowercase, hyphens)",
  );
  process.exit(2);
}
const userName = `elixir-mcp-gw-${name}`;

const iam = new IAMClient({ region: REGION });
const sts = new STSClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });

const { Account } = await sts.send(new GetCallerIdentityCommand({}));
const arn = (q) => `arn:aws:sqs:${REGION}:${Account}:${q}`;
const policy = {
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
        arn("elixir-mcp-cr-requests-live"),
        arn("elixir-mcp-cr-requests-bulk"),
      ],
    },
    {
      Effect: "Allow",
      Action: ["sqs:SendMessage", "sqs:GetQueueUrl"],
      Resource: arn("elixir-mcp-cr-results"),
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
};

try {
  await iam.send(new CreateUserCommand({ UserName: userName }));
  console.error(`created IAM user ${userName}`);
} catch (err) {
  if (err.name !== "EntityAlreadyExistsException") throw err;
  console.error(`IAM user ${userName} already exists — reusing`);
}
await iam.send(
  new PutUserPolicyCommand({
    UserName: userName,
    PolicyName: "elixir-mcp-gateway",
    PolicyDocument: JSON.stringify(policy),
  }),
);

// Re-provisioning replaces old keys (IAM caps at 2 per user).
const { AccessKeyMetadata } = await iam.send(
  new ListAccessKeysCommand({ UserName: userName }),
);
for (const k of AccessKeyMetadata ?? []) {
  await iam.send(
    new DeleteAccessKeyCommand({
      UserName: userName,
      AccessKeyId: k.AccessKeyId,
    }),
  );
  console.error(`rotated out old key ${k.AccessKeyId}`);
}
const { AccessKey } = await iam.send(
  new CreateAccessKeyCommand({ UserName: userName }),
);

const env = [
  `# elixir-mcp collector config for "${name}" - generated ${new Date().toISOString()}`,
  `# ONE-TIME download: this file is deleted from the server the moment you fetch it.`,
  `# Paste your own Clash Royale API key below (the one exception, by design).`,
  `CR_API_TOKEN=PASTE_YOUR_CR_KEY_HERE`,
  `ELIXIR_MCP_GATEWAY_NAME=${name}`,
  `AWS_ACCESS_KEY_ID=${AccessKey.AccessKeyId}`,
  `AWS_SECRET_ACCESS_KEY=${AccessKey.SecretAccessKey}`,
  `AWS_REGION=${REGION}`,
].join("\n");

// The gateway_id is appended server-side? No - the migrate op targets by
// name; fetch the id there and include it. Simplest: the op returns the
// id, but the env must CONTAIN it, so stage in two steps: ask the op to
// substitute. Keep it simpler still: the op stores env verbatim; we ask
// it for the gateway_id first via the same op's refusal path? No -
// include a placeholder the op fills.
const payload = {
  gateway_provision: {
    name,
    iam_user_name: userName,
    env: env + `\nELIXIR_MCP_GATEWAY_ID=__GATEWAY_ID__`,
  },
};
const invoked = await lambda.send(
  new InvokeCommand({
    FunctionName: "elixir-mcp-migrate",
    Payload: Buffer.from(JSON.stringify(payload)),
  }),
);
const result = JSON.parse(Buffer.from(invoked.Payload).toString() || "null");
if (invoked.FunctionError) {
  console.error(`staging FAILED: ${JSON.stringify(result)}`);
  process.exit(1);
}
console.error(
  `staged one-time config for gateway "${result.name}" (${result.gateway_id}).`,
);
console.error(
  "The operator can now download it ONCE from Account > Collector.",
);
