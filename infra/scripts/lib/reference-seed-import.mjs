import { InvokeCommand } from "@aws-sdk/client-lambda";

/** Ordinary import, using the caller's one bound vocabulary snapshot. */
export async function importReferenceSeed(lambda, vocabulary) {
  const { roles, aliases, roles_version, source_commit } = vocabulary;
  const invoked = await lambda.send(
    new InvokeCommand({
      FunctionName: "elixir-mcp-migrate",
      Payload: JSON.stringify({
        card_roles_import: { roles, aliases, roles_version, source_commit },
      }),
    }),
  );
  const result = JSON.parse(Buffer.from(invoked.Payload).toString() || "null");
  if (
    invoked.FunctionError ||
    result?.error ||
    result?.roles !== roles.length ||
    result?.aliases !== aliases.length ||
    result?.roles_version !== roles_version ||
    result?.source_commit !== source_commit
  )
    throw new Error("reference import failed");
  console.error(`imported: ${JSON.stringify(result)}`);
  return result;
}
