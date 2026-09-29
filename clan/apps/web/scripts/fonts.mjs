/**
 * The design stylesheet (the workspace's @elixir-mcp/design) names Inter
 * and the Clash display face at /assets/fonts/. They ship in the Console's
 * public tree (Inter under the SIL OFL; Clash a Supercell Fan Kit asset
 * whose README carries the Fan Content Policy note), so they are copied
 * from there at build time rather than committed twice. The destination
 * is gitignored.
 */

import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(here, "../../../../apps/web/public/assets/fonts");
const to = path.resolve(here, "../public/assets/fonts");

await mkdir(to, { recursive: true });
for (const file of await readdir(from)) {
  await cp(path.join(from, file), path.join(to, file));
}
console.error(`fonts: copied from ${path.relative(process.cwd(), from)}`);
