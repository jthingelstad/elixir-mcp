/** Lambda entrypoint for the results-queue consumer. */

import { makeHandler } from "./handler.mjs";

export const handler = makeHandler({ databaseUrl: process.env.DATABASE_URL });
