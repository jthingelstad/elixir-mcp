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
import { participationObjects } from "../packages/tools/src/participation-table.mjs";

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

export function makeDoor({
  url,
  token,
  fetchImpl = fetch,
  timeoutMs = 20_000,
}) {
  let seq = 0;
  async function rpc(method, params) {
    const started = performance.now();
    const controller = new AbortController();
    const deadline = started + timeoutMs;
    const beforeDeadline = async (work, onTimeout = () => {}) => {
      const remaining = Math.max(1, deadline - performance.now());
      let timer;
      try {
        return await Promise.race([
          work,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error(`${method}: request timeout`);
              controller.abort(error);
              void onTimeout();
              reject(error);
            }, remaining);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    const res = await beforeDeadline(
      fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
        // The server has an 18 s analytical budget. Keep the acceptance runner
        // bounded when a connection or proxy fails to deliver its whole response.
        signal: controller.signal,
      }),
    );
    const ms = Math.round(performance.now() - started);
    let text;
    if (!res.body?.getReader) {
      text = await beforeDeadline(res.text(), () => res.body?.cancel());
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        text = "";
        for (;;) {
          const chunk = await beforeDeadline(reader.read(), () =>
            reader.cancel(),
          );
          if (chunk.done) break;
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    }
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
    // clans_participation answers an agent as a table (#124). The cases
    // read its rows as the objects /api/v1 serves, which it decodes to
    // exactly; `raw` keeps what the door sent.
    return {
      body: participationObjects(body),
      raw: body,
      isError: result?.isError === true,
      ms,
    };
  }
  async function toolsList() {
    const { result } = await rpc("tools/list", {});
    return result?.tools ?? [];
  }
  return { rpc, call, toolsList };
}
