import { InvokeCommand } from "@aws-sdk/client-lambda";
import { readVocabulary } from "./reference-vocabulary.mjs";
import { importReferenceSeed } from "./reference-seed-import.mjs";

/** Same trusted reader as the import; fail before any reference refresh. */
export async function verifyReferenceSeed(
  lambda,
  vocabulary = readVocabulary(),
) {
  const { roles, aliases, roles_version, source_commit } = vocabulary;
  const invoked = await lambda.send(
    new InvokeCommand({
      FunctionName: "elixir-mcp-migrate",
      Payload: JSON.stringify({
        reference_seed_preview: {
          roles,
          aliases,
          roles_version,
          source_commit,
        },
      }),
    }),
  );
  const result = JSON.parse(Buffer.from(invoked.Payload).toString() || "null");
  if (
    invoked.FunctionError ||
    result?.error ||
    result?.preview !== true ||
    result?.readonly !== true
  )
    throw new Error(
      "reference seed preview failed; no reference refresh permitted",
    );
  console.error(`reference seed preview: ${JSON.stringify(result)}`);
  if (
    !/^[a-f0-9]{64}$/.test(result.live_sha256 ?? "") ||
    result.identical !== true ||
    result.live_sha256 !== result.proposed_sha256 ||
    result.version_compatible !== true
  )
    throw new Error(
      "reference seed differs from trusted repository; no reference refresh permitted",
    );
  return result;
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** A changed sibling or caller cannot replace the seed after its preview. */
export async function prepareReferenceSeedRefresh(
  lambda,
  vocabulary = readVocabulary(),
) {
  const bound = freeze(structuredClone(vocabulary));
  const receipt = await verifyReferenceSeed(lambda, bound);
  return {
    receipt,
    vocabulary: bound,
    refresh: () => importReferenceSeed(lambda, bound),
  };
}
