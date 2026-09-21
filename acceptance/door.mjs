/**
 * The door, as the acceptance suite speaks to it: one POST per call with
 * a bearer token, timed. Stateless JSON-RPC - no initialize, no session,
 * no SDK (the boards client proved the shape). The token is an AGENT
 * principal's, read-only scope, bound to its own door under /a/<id>/mcp;
 * it comes from acceptance/.env (ignored by git) and is never printed.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadEnv(file = path.join(here, ".env")) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const env = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !m[1].startsWith("#")) env[m[1]] = m[2];
  }
  if (!env.ELIXIR_MCP_URL || !env.ELIXIR_MCP_TOKEN) return null;
  return env;
}

export function makeDoor({ url, token, fetchImpl = fetch }) {
  let seq = 0;
  async function rpc(method, params) {
    const started = performance.now();
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
    });
    const ms = Math.round(performance.now() - started);
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        `${method}: non-JSON answer (HTTP ${res.status}): ${text.slice(0, 200)}`,
      );
    }
    if (body.error)
      throw new Error(
        `${method}: ${body.error.message ?? JSON.stringify(body.error)}`,
      );
    return { result: body.result, ms, status: res.status };
  }
  /** tools/call, unwrapped: `{ body, isError, ms }`. A refusal is an
   *  answer here, not a throw - several checks assert a refusal. */
  async function call(name, args = {}) {
    let result;
    let ms;
    try {
      ({ result, ms } = await rpc("tools/call", { name, arguments: args }));
    } catch (err) {
      // A JSON-RPC level refusal (scope, unknown tool) is an answer the
      // suite asserts on, not a throw.
      return {
        body: { error: { code: "rpc_error", message: err.message } },
        isError: true,
        ms: null,
      };
    }
    const text = result?.content?.[0]?.text;
    let body = result?.structuredContent;
    if (body === undefined) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { text };
      }
    }
    return { body, isError: result?.isError === true, ms };
  }
  async function toolsList() {
    const { result } = await rpc("tools/list", {});
    return result?.tools ?? [];
  }
  return { rpc, call, toolsList };
}
