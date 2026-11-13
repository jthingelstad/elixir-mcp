/**
 * One of the verify run's scratch-database slots, held for this vitest
 * run (packages/ingest/test/helpers.mjs, holdSlot). The journeys' scratch
 * database is made in a beforeAll, and vitest times hooks: waiting there
 * for a slot other units hold read as a 60 s setup failure. globalSetup
 * has no timeout, so the wait happens here. Outside infra/scripts/test.mjs
 * there are no slots and this returns at once.
 */
import { holdSlot } from "../../../packages/ingest/test/helpers.mjs";

export default async function setup() {
  return holdSlot();
}
