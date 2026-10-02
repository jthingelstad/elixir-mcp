/** The share picture's renderer and fonts: the names they have beside
 *  the web API's code (`share/<name>` in its bundle) and the files in
 *  this repository they come from. One list, so the build that copies
 *  them (infra/scripts/build.mjs) and the tests that draw with them
 *  cannot name different files. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const SHARE_FILES = {
  wasm: "resvg.wasm",
  interRegular: "Inter-Regular.ttf",
  interBold: "Inter-Bold.ttf",
  clash: "Clash_Regular.otf",
};

/** Where each comes from in a checkout: absolute paths. */
export function shareSources() {
  const require = createRequire(import.meta.url);
  const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
  return {
    wasm: require.resolve("@resvg/resvg-wasm/index_bg.wasm"),
    interRegular: here("../fonts/Inter-Regular.ttf"),
    interBold: here("../fonts/Inter-Bold.ttf"),
    clash: here("../../../apps/web/public/assets/fonts/Clash_Regular.otf"),
  };
}
