import { test } from "node:test";
import assert from "node:assert/strict";
import {
  endpointPolicy,
  grantWebEndpoints,
} from "../../../infra/scripts/lib/web-release.mjs";

const distributionArn = "arn:aws:cloudfront::123456789012:distribution/EXAMPLE";
const outputs = Object.fromEntries(
  ["WebApi", "Mcp", "Collector"].flatMap((door) => [
    [`${door}WebFunctionName`, `example-${door}`],
    [
      `${door}WebEndpointArn`,
      `arn:aws:lambda:us-east-1:123456789012:web-function/example-${door}/endpoint/live`,
    ],
    [`${door}WebRevisionId`, "revision1"],
  ]),
);
test("CloudFront grants name exactly one distribution and the live endpoint", () => {
  const policy = endpointPolicy(outputs.WebApiWebEndpointArn, distributionArn);
  assert.equal(policy.Statement[0].Resource, outputs.WebApiWebEndpointArn);
  assert.equal(policy.Statement[0].Action, "lambda:InvokeWebFunctionEndpoint");
  assert.equal(
    policy.Statement[0].Condition.ArnEquals["aws:SourceArn"],
    distributionArn,
  );
});
test("deployment installs missing policies and verifies explicit immutable routing", async () => {
  const policies = new Map();
  const web = {
    send: async (command) => {
      const { resourceArn } = command.input;
      switch (command.constructor.name) {
        case "GetResourcePolicyCommand":
          if (!policies.has(resourceArn))
            throw Object.assign(new Error(), {
              name: "ResourceNotFoundException",
            });
          return { policy: policies.get(resourceArn), revisionId: "policy1" };
        case "PutResourcePolicyCommand":
          policies.set(resourceArn, command.input.policy);
          return {};
        default:
          return {
            state: "Active",
            authType: "IamAuth",
            endpointType: "HomeRegion",
            autoDeploymentMode: "Disabled",
            revisionWeights: [{ revisionId: "revision1", weight: 100 }],
          };
      }
    },
  };
  const receipt = await grantWebEndpoints({ web, outputs, distributionArn });
  assert.equal(policies.size, 3);
  assert.equal(receipt.Mcp.revision, "revision1");
  await grantWebEndpoints({ web, outputs, distributionArn });
  policies.set(
    outputs.WebApiWebEndpointArn.split("/endpoint/")[0],
    JSON.stringify({ Statement: [{ Principal: "*" }] }),
  );
  await assert.rejects(
    grantWebEndpoints({ web, outputs, distributionArn }),
    /unowned/,
  );
});
