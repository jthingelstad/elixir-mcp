#!/usr/bin/env node
/**
 * Import the deck-archetype vocabulary from the sibling cr-agent-api-docs
 * checkout into the record. The Lambdas have no internet, so the operator's machine reads
 * ../cr-agent-api-docs/data/card-roles.json and data/deck-aliases.json,
 * refuses a sibling whose two data files are uncommitted (it checks
 * `git status` on them, not whether the commit is pushed: push the
 * reference first, so the version is a commit anyone can read), sends the rows to the migrate Lambda
 * ({card_roles_import}), and refreshes fixtures/card-roles.snapshot.json
 * so the tests run in CI without the sibling. Run by deploy.mjs after
 * migrations; runnable alone:
 *
 *   AWS_PROFILE=cloud-engineer node infra/scripts/import-card-roles.mjs
 *   node infra/scripts/import-card-roles.mjs --snapshot-only   (no AWS)
 */

import {
  readVocabulary,
  saveVocabularySnapshot,
} from "./lib/reference-vocabulary.mjs";
import { importReferenceSeed } from "./lib/reference-seed-import.mjs";
export { readVocabulary } from "./lib/reference-vocabulary.mjs";
const vocabulary = readVocabulary();
saveVocabularySnapshot(vocabulary);
if (!process.argv.includes("--snapshot-only")) {
  const { LambdaClient } = await import("@aws-sdk/client-lambda");
  await importReferenceSeed(
    new LambdaClient({ region: "us-east-1" }),
    vocabulary,
  );
}
