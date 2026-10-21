import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkWebEndpointGrants,
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

test("the pre-switch check reads every live grant, writes nothing, and refuses a missing or foreign one", async () => {
  const resource = (door) =>
    outputs[`${door}WebEndpointArn`].split("/endpoint/")[0];
  const own = (door) =>
    JSON.stringify(
      endpointPolicy(outputs[`${door}WebEndpointArn`], distributionArn),
    );
  const policies = new Map(
    ["WebApi", "Mcp", "Collector"].map((door) => [resource(door), own(door)]),
  );
  const sent = [];
  const web = {
    send: async (command) => {
      sent.push(command.constructor.name);
      const { resourceArn } = command.input;
      if (command.constructor.name !== "GetResourcePolicyCommand")
        throw new Error(`the check sent ${command.constructor.name}`);
      if (!policies.has(resourceArn))
        throw Object.assign(new Error(), { name: "ResourceNotFoundException" });
      return { policy: policies.get(resourceArn), revisionId: "policy1" };
    },
  };
  assert.deepEqual(
    await checkWebEndpointGrants({ web, outputs, distributionArn }),
    {
      ok: true,
      receipt: {
        WebApi: { policyRevision: "policy1" },
        Mcp: { policyRevision: "policy1" },
        Collector: { policyRevision: "policy1" },
      },
    },
  );
  assert.deepEqual(sent, Array(3).fill("GetResourcePolicyCommand"));

  // The same grant written in another key order is still the deploy's own.
  const reordered = JSON.parse(own("Mcp"));
  policies.set(
    resource("Mcp"),
    JSON.stringify({
      Statement: reordered.Statement,
      Version: reordered.Version,
    }),
  );
  assert.equal(
    (await checkWebEndpointGrants({ web, outputs, distributionArn })).ok,
    true,
  );

  // Removed outside a deploy, or replaced: both refuse, each door named.
  policies.delete(resource("WebApi"));
  policies.set(
    resource("Collector"),
    JSON.stringify({ Statement: [{ Principal: "*" }] }),
  );
  const refused = await checkWebEndpointGrants({
    web,
    outputs,
    distributionArn,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.problems.length, 2);
  assert.match(refused.problems[0], /^WebApi: .* has no resource policy/);
  assert.match(
    refused.problems[1],
    /^Collector: .* not the deploy's own grant/,
  );

  // A grant for another distribution is foreign too.
  policies.set(resource("WebApi"), own("WebApi"));
  policies.set(resource("Collector"), own("Collector"));
  const other = await checkWebEndpointGrants({
    web,
    outputs,
    distributionArn: "arn:aws:cloudfront::123456789012:distribution/OTHER",
  });
  assert.equal(other.ok, false);
  assert.equal(other.problems.length, 3);

  // A policy that is not JSON is not the deploy's own.
  policies.set(resource("Mcp"), "{not json");
  assert.match(
    (
      await checkWebEndpointGrants({ web, outputs, distributionArn })
    ).problems.join("\n"),
    /^Mcp: .* not the deploy's own grant/,
  );
  policies.set(resource("Mcp"), own("Mcp"));

  // A door the live stack does not serve yet has nothing to check; one
  // whose output is not the live endpoint is a problem, and any other
  // read error is not swallowed.
  const withoutCollector = Object.fromEntries(
    Object.entries(outputs).filter(
      ([key]) => key !== "CollectorWebEndpointArn",
    ),
  );
  assert.deepEqual(
    (
      await checkWebEndpointGrants({
        web,
        outputs: withoutCollector,
        distributionArn,
      })
    ).receipt.Collector,
    "not live yet",
  );
  const draft = {
    ...outputs,
    McpWebEndpointArn: outputs.McpWebEndpointArn.replace(/live$/, "draft"),
  };
  assert.match(
    (
      await checkWebEndpointGrants({ web, outputs: draft, distributionArn })
    ).problems.join("\n"),
    /^Mcp: .* is not the live endpoint/,
  );
  await assert.rejects(
    checkWebEndpointGrants({
      web: {
        send: async () => {
          throw Object.assign(new Error("denied"), {
            name: "AccessDeniedException",
          });
        },
      },
      outputs,
      distributionArn,
    }),
    /denied/,
  );
});
