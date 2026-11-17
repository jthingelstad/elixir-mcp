/**
 * Comments' moderation key (2026-11-17, docs/notes/2026-11-17-moderation-secret.md):
 * Elixir's own Anthropic key for the check before each comment, in its own
 * Secrets Manager secret, `elixir-mcp/moderation` ({moderation_api_key}).
 * Read here at runtime, the way web push reads its VAPID pair: one
 * GetSecretValue on first use, kept in memory, never an environment
 * variable, never a log line.
 *
 * No key (the secret missing, unreadable or malformed) is `null`, and the
 * model worker answers every check `moderation_off`, so nothing posts. The
 * cause is logged once, by name only, never the value or the SDK's message.
 *
 * Rotation without a deploy: a key is re-read an hour after it was read,
 * and sooner after Anthropic refuses it as unauthenticated (`rejected()`),
 * but never more than once each five minutes. A failed read waits the same
 * five minutes before the next try, so a missing secret is not asked for on
 * every check.
 */

/** A key read this long ago is read again on next use. */
export const MODERATION_KEY_MAX_AGE_MS = 60 * 60 * 1000;
/** The least time between two reads after a failure or a refused key. */
export const MODERATION_KEY_RETRY_MS = 5 * 60 * 1000;

/** A key's shape: printable, no spaces, of a sane length. Checked so a
 *  pasted placeholder or a stray newline is "malformed", not a 401 loop. */
const KEY_SHAPE = /^[\x21-\x7e]{20,512}$/;

/** The cause a failed read is logged with: a fixed word, or the SDK
 *  error's name (ResourceNotFoundException, AccessDeniedException), never
 *  its message. */
function causeOf(err) {
  const name = String(err?.name ?? "");
  return /^[A-Za-z]{1,64}$/.test(name) ? name : "read_failed";
}

/**
 * `getSecret()` returns the SecretString (or throws). Returns `{ get,
 * rejected }`: `get()` resolves to the key or null and never throws;
 * `rejected()` asks for a re-read because the provider refused the key.
 */
export function moderationKeyFromSecret(
  getSecret,
  {
    now = Date.now,
    log = (...a) => console.error(...a),
    maxAgeMs = MODERATION_KEY_MAX_AGE_MS,
    retryMs = MODERATION_KEY_RETRY_MS,
  } = {},
) {
  let key = null;
  let readAt = null;
  let stale = false;
  let reading = null;
  const logged = new Set();

  function fail(cause) {
    key = null;
    if (logged.has(cause)) return;
    logged.add(cause);
    log("moderation_key_unavailable", cause);
  }

  async function read() {
    let text;
    try {
      text = await getSecret();
    } catch (err) {
      return fail(causeOf(err));
    } finally {
      readAt = now();
      stale = false;
    }
    let parsed;
    try {
      parsed = JSON.parse(String(text ?? ""));
    } catch {
      return fail("moderation_secret_shape");
    }
    const value = parsed?.moderation_api_key;
    if (typeof value !== "string" || !KEY_SHAPE.test(value))
      return fail("moderation_secret_shape");
    key = value;
    logged.clear();
  }

  function due() {
    if (readAt === null) return true;
    const age = now() - readAt;
    if (age < 0) return true;
    if (!key || stale) return age >= retryMs;
    return age >= maxAgeMs;
  }

  return {
    async get() {
      if (due()) {
        reading ??= read().finally(() => {
          reading = null;
        });
        await reading;
      }
      return key;
    },
    rejected() {
      stale = true;
    },
  };
}
