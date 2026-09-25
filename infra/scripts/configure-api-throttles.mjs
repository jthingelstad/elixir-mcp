#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { API_THROTTLES } from "./api-throttle-config.mjs";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const checkOnly = process.argv.includes("--check");

if (REGION !== "us-east-1") {
  throw new Error(`refusing unexpected AWS region ${REGION}`);
}

function aws(...args) {
  return JSON.parse(
    execFileSync("aws", [...args, "--region", REGION, "--output", "json"], {
      encoding: "utf8",
    }),
  );
}

const identity = aws("sts", "get-caller-identity");
if (
  identity.Account !== "999153317627" ||
  !identity.Arn.includes(
    "assumed-role/ProjectsCloudEngineer/projects-cloud-engineer",
  )
) {
  throw new Error(`refusing unexpected AWS caller ${identity.Arn}`);
}

const apis = aws("apigatewayv2", "get-apis").Items ?? [];

for (const expected of API_THROTTLES) {
  const matches = apis.filter((api) => api.Name === expected.apiName);
  if (matches.length !== 1) {
    throw new Error(
      `${expected.apiName}: expected one API, found ${matches.length}`,
    );
  }

  const apiId = matches[0].ApiId;
  const current = aws(
    "apigatewayv2",
    "get-stage",
    "--api-id",
    apiId,
    "--stage-name",
    "$default",
  );
  const settings = current.DefaultRouteSettings ?? {};
  const matchesExpected =
    settings.ThrottlingRateLimit === expected.rateLimit &&
    settings.ThrottlingBurstLimit === expected.burstLimit;

  if (!matchesExpected && !checkOnly) {
    aws(
      "apigatewayv2",
      "update-stage",
      "--api-id",
      apiId,
      "--stage-name",
      "$default",
      "--default-route-settings",
      JSON.stringify({
        DetailedMetricsEnabled: false,
        ThrottlingRateLimit: expected.rateLimit,
        ThrottlingBurstLimit: expected.burstLimit,
      }),
    );
  }

  const verified = aws(
    "apigatewayv2",
    "get-stage",
    "--api-id",
    apiId,
    "--stage-name",
    "$default",
  ).DefaultRouteSettings;
  const ok =
    verified?.ThrottlingRateLimit === expected.rateLimit &&
    verified?.ThrottlingBurstLimit === expected.burstLimit;
  if (!ok) {
    throw new Error(`${expected.apiName}: throttle verification failed`);
  }

  console.log(
    `${expected.apiName}: rate=${expected.rateLimit}/s burst=${expected.burstLimit}`,
  );
}
