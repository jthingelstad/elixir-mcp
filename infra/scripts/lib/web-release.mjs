import {
  GetResourcePolicyCommand,
  PutResourcePolicyCommand,
  GetWebFunctionEndpointCommand,
} from "@aws-sdk/client-lambda-web";

const WEB_DOORS = ["WebApi", "Mcp", "Collector"];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const equalPolicy = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function endpointPolicy(endpointArn, distributionArn) {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "ElixirCloudFrontLive",
        Effect: "Allow",
        Principal: { Service: "cloudfront.amazonaws.com" },
        Action: "lambda:InvokeWebFunctionEndpoint",
        Resource: endpointArn,
        Condition: { ArnEquals: { "aws:SourceArn": distributionArn } },
      },
    ],
  };
}

/** The CF registry ResourcePolicy type excludes Web Function ARNs. Deploy
 * owns this narrow grant while holding the same production lock as the stack. */
export async function grantWebEndpoints({ web, outputs, distributionArn }) {
  const receipt = {};
  for (const door of WEB_DOORS) {
    const endpointArn = outputs[`${door}WebEndpointArn`];
    if (!endpointArn?.endsWith("/endpoint/live"))
      throw new Error(`Missing ${door} live endpoint`);
    const resourceArn = endpointArn.split("/endpoint/")[0];
    const desired = endpointPolicy(endpointArn, distributionArn);
    let existing;
    try {
      existing = await web.send(new GetResourcePolicyCommand({ resourceArn }));
    } catch (error) {
      if (error.name !== "ResourceNotFoundException") throw error;
    }
    if (existing?.policy) {
      const actual = JSON.parse(existing.policy);
      if (!equalPolicy(actual, desired)) {
        throw new Error(
          `${door} has an unowned resource policy; refusing to replace it`,
        );
      }
    } else {
      await web.send(
        new PutResourcePolicyCommand({
          resourceArn,
          policy: JSON.stringify(desired),
          ...(existing?.revisionId ? { revisionId: existing.revisionId } : {}),
        }),
      );
    }
    const read = await web.send(new GetResourcePolicyCommand({ resourceArn }));
    if (!equalPolicy(JSON.parse(read.policy), desired))
      throw new Error(`${door} policy read-back differs`);
    const endpoint = await web.send(
      new GetWebFunctionEndpointCommand({
        functionName: outputs[`${door}WebFunctionName`],
        endpointName: "live",
      }),
    );
    if (
      endpoint.state !== "Active" ||
      endpoint.authType !== "IamAuth" ||
      endpoint.endpointType !== "HomeRegion" ||
      endpoint.autoDeploymentMode !== "Disabled" ||
      endpoint.revisionWeights?.length !== 1 ||
      endpoint.revisionWeights[0].weight !== 100 ||
      endpoint.revisionWeights[0].revisionId !== outputs[`${door}WebRevisionId`]
    )
      throw new Error(
        `${door} is not active and pinned to the deployed revision`,
      );
    receipt[door] = {
      revision: outputs[`${door}WebRevisionId`],
      policyRevision: read.revisionId,
    };
  }
  return receipt;
}
