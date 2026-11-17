/**
 * Every test ends with its tree unmounted and React's scheduler drained,
 * while jsdom's window still exists (react-settle.js says why).
 */
import { afterEach } from "vitest";
import { settleReact } from "./react-settle.js";

afterEach(async () => {
  // Server-render tests run without a window and mount nothing.
  if (typeof window === "undefined") return;
  await settleReact();
});
