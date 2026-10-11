/**
 * Anthropic's API on a clan's own key (bring your own tokens, 2026-09-25):
 * the model list, which is how a key is checked when a leader adds it (it
 * spends nothing), and one message whose answer is a single tool call, so
 * a model's words arrive in the shape the engine checks. Elixir
 * Clan funds no model use; every call here is on the key it is handed.
 *
 * Timed into the request's trace (`timedModel`): the call, its time, its
 * status and its tokens. Never the key, the prompt or the answer. A
 * refusal carries Anthropic's own error type and message, which name the
 * problem (an invalid key, a low balance, an unknown model), never a key.
 *
 * The request is the same for every model: no temperature, top_p or
 * top_k, no thinking setting, no assistant prefill. The use's `effort`
 * (`output_config.effort`, which all three 5.5 models take; 2026-10-11)
 * is sent as the engine set it, so a model change never changes how hard
 * a use thinks. The tool is strict (`strict: true`, set by the engine),
 * so its answer matches its schema. The tool is asked for, not forced
 * (2026-10-11): Claude Opus 5.5, the model the leaders' drafts run on,
 * answers a 400 to a forced `tool_choice` and always thinks, so the
 * request names the tool in the system prompt, allows one call (`auto`,
 * no parallel calls), and adds `THINKING_ROOM` to the engine's
 * `max_tokens`, which sizes the answer alone. An answer with no call is
 * `no_answer`, never words. Nothing here depends on the model id: the
 * model Elixir Clan chose for the use is sent as it is.
 *
 * The system prompt is two blocks: the use's instructions, then the
 * clan's context (`context`, the same for every request of the clan),
 * marked for Anthropic's prompt cache. Tools, instructions and context
 * are the cached prefix; a clan's second request within five minutes
 * reads it at a twentieth of the price. A prefix under the model's
 * minimum (512 tokens on the 5.5 models) is simply not cached.
 */

import { timedModel } from "./trace.mjs";

const ANTHROPIC_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";
/** The relay's wait for Anthropic (2026-10-11): a medium-effort Opus
 *  draft that thinks may take most of a minute. The relay runs it under a
 *  90 s Lambda; the person's request never waits for it (drafts are
 *  collected, `model-bridge.mjs`). A request may ask for less. */
export const MODEL_TIMEOUT_MS = 55_000;
/** Tokens a model that thinks may spend before its tool call; billed
 *  only when used. */
export const THINKING_ROOM = 4096;

/**
 * The body of one message (exported for its tests): the instructions,
 * then the clan's context as the cached block, the packet as the user's
 * turn, the strict tool, and the use's effort.
 */
export function messageBody({
  model,
  system,
  context = "",
  prompt,
  tool,
  max_tokens,
  effort = null,
}) {
  const blocks = [
    {
      type: "text",
      text: `${system}\n\nAnswer directly: call the ${tool.name} tool once, and write nothing else.`,
    },
  ];
  if (context) blocks.push({ type: "text", text: context });
  blocks.at(-1).cache_control = { type: "ephemeral" };
  return {
    model,
    max_tokens: max_tokens + THINKING_ROOM,
    system: blocks,
    messages: [{ role: "user", content: prompt }],
    tools: [tool],
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    ...(effort ? { output_config: { effort } } : {}),
  };
}

export function createAnthropicClient({
  fetch = globalThis.fetch,
  url = ANTHROPIC_URL,
  timeoutMs = MODEL_TIMEOUT_MS,
} = {}) {
  async function call(key, path, init, waitMs = timeoutMs) {
    let res;
    try {
      res = await fetch(`${url}${path}`, {
        ...init,
        headers: {
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(waitMs),
      });
    } catch (e) {
      return {
        ok: false,
        status: 0,
        code: e?.name === "TimeoutError" ? "timeout" : "network",
      };
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      // An answer that is not JSON is judged by its status alone.
    }
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        code: body?.error?.type ?? "error",
        message: String(body?.error?.message ?? "").slice(0, 300) || null,
      };
    return { ok: true, status: res.status, body };
  }

  return {
    /** The models a key can reach: `{ ok, models: [{ id, name }] }`. */
    models(key) {
      return timedModel("models", async () => {
        const r = await call(key, "/v1/models?limit=100", { method: "GET" });
        if (!r.ok) return r;
        return {
          ok: true,
          status: r.status,
          models: (r.body?.data ?? [])
            .filter((m) => typeof m?.id === "string")
            .map((m) => ({ id: m.id, name: m.display_name ?? m.id })),
        };
      });
    },

    /**
     * One message answered by one call of `tool`: `{ ok, input, model,
     * usage }`, or a refusal. `system`, `context`, `prompt`, `tool`,
     * `effort` and `max_tokens` come from the engine (`words.mjs`,
     * `activity.mjs`); `timeoutMs` may shorten the wait.
     *
     * The answer is the `tool_use` block, found by its type: a model may
     * put a thinking or text block first. A safety refusal
     * (`stop_reason: "refusal"`, code `refusal`) or a `max_tokens` stop
     * (code `max_tokens`) is never an answer, even with a tool call in it:
     * a cut-off call's input is partial, and the engine would fill what is
     * missing with its plain template, a draft nobody wrote.
     */
    write(
      key,
      {
        model,
        system,
        context = "",
        prompt,
        tool,
        max_tokens,
        effort = null,
        timeoutMs: wait = null,
      },
    ) {
      return timedModel("messages", async () => {
        const r = await call(
          key,
          "/v1/messages",
          {
            method: "POST",
            body: JSON.stringify(
              messageBody({
                model,
                system,
                context,
                prompt,
                tool,
                max_tokens,
                effort,
              }),
            ),
          },
          Number.isFinite(wait) && wait > 0
            ? Math.min(wait, timeoutMs)
            : timeoutMs,
        );
        if (!r.ok) return r;
        const u = r.body?.usage ?? {};
        const usage = {
          input_tokens: u.input_tokens ?? null,
          output_tokens: u.output_tokens ?? null,
          cache_creation_input_tokens: u.cache_creation_input_tokens ?? null,
          cache_read_input_tokens: u.cache_read_input_tokens ?? null,
        };
        const stop = r.body?.stop_reason ?? null;
        if (stop === "refusal")
          return {
            ok: false,
            status: r.status,
            code: "refusal",
            message:
              "The model declined to write this draft. Your words are unchanged; write them yourself or try again.",
            usage,
          };
        if (stop === "max_tokens")
          return {
            ok: false,
            status: r.status,
            code: "max_tokens",
            message:
              "The model ran out of room before it finished the draft. Your words are unchanged; try again.",
            usage,
          };
        const use = (r.body?.content ?? []).find(
          (c) => c?.type === "tool_use" && c.name === tool.name,
        );
        if (!use)
          return {
            ok: false,
            status: r.status,
            code: "no_answer",
            message: `The model stopped without an answer (${r.body?.stop_reason ?? "unknown"}).`,
            usage,
          };
        return {
          ok: true,
          status: r.status,
          input: use.input ?? null,
          model: r.body?.model ?? model,
          usage,
        };
      });
    },
  };
}
