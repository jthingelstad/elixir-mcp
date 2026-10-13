import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { GetWebFunctionEndpointCommand } from "@aws-sdk/client-lambda-web";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { clientMeetsMinimum } from "../../../packages/collector-door/src/door.mjs";
import {
  acquireLock,
  releaseLock,
  lockFileFor,
  holdUntilExit,
} from "./production-lock.mjs";

/** Resolve the repository from the entry script, never its caller's cwd. */
export function collectorNamingLock(scriptUrl, tag) {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(scriptUrl)),
    "../..",
  );
  const file = lockFileFor(repoRoot);
  return {
    acquire: () =>
      acquireLock({
        file,
        holder: "op:collector_release",
        purpose: `name ${tag}`,
        worktree: repoRoot,
        head: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: repoRoot,
          encoding: "utf8",
        }).trim(),
      }),
    holdUntilExit: (held) => holdUntilExit({ file, lock: held }),
    release: (held) => releaseLock({ file, lockId: held.lock_id }),
  };
}

/** Read the constant from code, never execute a downloaded bundle. */
export function minimumFromSource(source) {
  const matches = [...source.matchAll(/\bmin_client_version\s*:\s*"([^"]*)"/g)];
  if (matches.length !== 1 || !/^\d+\.\d+\.\d+$/.test(matches[0][1]))
    throw new Error("Deployed collector minimum is missing or ambiguous");
  return matches[0][1];
}

function unpackSource(bytes) {
  const dir = mkdtempSync(path.join(tmpdir(), "collector-minimum-"));
  try {
    const zip = path.join(dir, "collector.zip");
    writeFileSync(zip, bytes);
    return execFileSync("unzip", ["-p", zip, "index.mjs"], {
      encoding: "utf8",
      maxBuffer: 20 << 20,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The stable deployed revision, not this checkout, is naming authority. */
export async function readDeployedCollectorMinimum({
  cf,
  web,
  s3,
  unpack = unpackSource,
}) {
  const response = await cf.send(
    new DescribeStacksCommand({ StackName: "elixir-mcp" }),
  );
  const stack = response.Stacks?.[0];
  if (
    !stack ||
    ![
      "CREATE_COMPLETE",
      "UPDATE_COMPLETE",
      "UPDATE_ROLLBACK_COMPLETE",
    ].includes(stack.StackStatus)
  )
    throw new Error("Collector stack is not stable; nothing named");
  const params = Object.fromEntries(
    stack.Parameters.map((p) => [p.ParameterKey, p.ParameterValue]),
  );
  const outputs = Object.fromEntries(
    stack.Outputs.map((p) => [p.OutputKey, p.OutputValue]),
  );
  if (
    !["0", "1"].includes(params.CollectorMinEnforce) ||
    params.CodeBucket !== "elixir-mcp-code-999153317627" ||
    !/^code\/collector\/[a-f0-9]{16}\.zip$/.test(
      params.CollectorCodeKey ?? "",
    ) ||
    !params.CollectorCodeVersion ||
    params.CollectorCodeVersion === "null" ||
    outputs.CollectorWebFunctionName !== "elixir-mcp-collector-web" ||
    !outputs.CollectorWebRevisionId
  )
    throw new Error(
      "Missing or unexpected deployed collector authority; nothing named",
    );
  const endpoint = await web.send(
    new GetWebFunctionEndpointCommand({
      functionName: outputs.CollectorWebFunctionName,
      endpointName: "live",
    }),
  );
  if (
    endpoint.state !== "Active" ||
    endpoint.updateStatus === "InProgress" ||
    endpoint.authType !== "IamAuth" ||
    endpoint.autoDeploymentMode !== "Disabled" ||
    endpoint.revisionWeights?.length !== 1 ||
    endpoint.revisionWeights[0].weight !== 100 ||
    endpoint.revisionWeights[0].revisionId !== outputs.CollectorWebRevisionId
  )
    throw new Error(
      "Collector endpoint is not pinned to the deployed revision; nothing named",
    );
  const object = await s3.send(
    new GetObjectCommand({
      Bucket: params.CodeBucket,
      Key: params.CollectorCodeKey,
      VersionId: params.CollectorCodeVersion,
    }),
  );
  const bytes = await object.Body.transformToByteArray();
  if (object.VersionId !== params.CollectorCodeVersion)
    throw new Error(
      "Collector source version differs from the deployed version; nothing named",
    );
  const source = unpack(bytes);
  return {
    minimum: minimumFromSource(source),
    enforced: params.CollectorMinEnforce === "1",
  };
}

/** Hold one lock from the deployed guard through all naming effects. */
export async function guardCollectorNaming({
  tag,
  dryRun,
  whoami,
  lock,
  readMinimum,
  name,
  log = console.error,
}) {
  const caller = await whoami();
  if (
    caller.Account !== "999153317627" ||
    !caller.Arn?.includes(
      "assumed-role/ProjectsCloudEngineer/projects-cloud-engineer",
    )
  )
    throw new Error(
      "Collector naming requires the cloud-engineer account and role",
    );
  if (!/^v\d+\.\d+\.\d+$/.test(tag))
    throw new Error("Collector release tag must be vX.Y.Z");
  let held;
  if (!dryRun) {
    held = lock.acquire();
    if (!held.ok) throw Object.assign(new Error(held.reason), { exitCode: 3 });
    lock.holdUntilExit(held.lock);
  }
  try {
    const authority = await readMinimum();
    if (
      !/^\d+\.\d+\.\d+$/.test(authority.minimum) ||
      typeof authority.enforced !== "boolean"
    )
      throw new Error("Invalid deployed collector minimum; nothing named");
    if (authority.enforced && !clientMeetsMinimum(tag, authority.minimum))
      throw new Error(
        `Release ${tag} is below the deployed collector minimum ${authority.minimum}; deploy a Jamie-approved lower minimum first. Nothing named.`,
      );
    log(
      `  deployed minimum: ${authority.minimum}, enforcement ${authority.enforced ? "on" : "off"}`,
    );
    if (!dryRun) await name();
  } finally {
    if (held?.ok) lock.release(held.lock);
  }
}
