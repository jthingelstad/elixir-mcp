# 2026-11-17: The moderation key moves to a secret of its own

Comments are checked by Claude on Elixir's own Anthropic key
(`docs/notes/2026-11-16-comments.md`). As first built, the email relay got
that key as the environment variable `MODERATION_API_KEY`, a dynamic
reference to `moderation_api_key` in the app secret, while
`CommentsEnabled` was true. Jamie does not want the key in a Lambda
environment variable, where anyone who can read the function's
configuration can read it too. Comments were never turned on, and the key
was never added to the app secret.

## What changed

- The key lives in its own secret, `elixir-mcp/moderation` (us-east-1), a
  JSON string with `moderation_api_key`, made by hand beside
  `elixir-mcp/web-push`.
- The relay reads it the way it reads the VAPID pair
  (`services/email-relay/src/moderation-key.mjs`): one `GetSecretValue` on
  first use, kept in memory, never logged, never an environment variable.
  The stack tells the relay only the secret's name,
  `MODERATION_SECRET_ID`, and only while `CommentsEnabled` is true.
- The relay's role gets `secretsmanager:GetSecretValue` on
  `elixir-mcp/moderation-??????`, under `HasComments`, as the template's
  other switched grants are. No other function is granted it.
- The model worker (`packages/clan/src/model-bridge.mjs`) takes the key as
  a string, as tests pass it, or as the relay's source
  (`{ get, rejected }`).

## When there is no key

A missing, unreadable or malformed secret is no key: every check answers
`moderation_off`, as before when the variable was absent, so nothing
posts. The relay logs `moderation_key_unavailable` and the cause (a fixed
word, or the SDK error's name, never its message or the value) once per
cause per container. A failed read is tried again after five minutes, not
on every check.

## Rotation

A key is read again an hour after it was read, and after Anthropic answers
a check 401 (`authentication_error`), at most once each five minutes. So a
new value written to the secret is in use within the hour, or within five
minutes of the old key being revoked, without a deploy. A deploy with
`--param=SecretEpoch=<date>` replaces the containers and picks it up at
once. Web push still keeps its pair for a container's life: a VAPID change
is for a leak only, and needs a deploy for the web-api's public half
anyway.

## What a deploy changes

- The relay loses the `MODERATION_API_KEY` variable (it was never set,
  since `CommentsEnabled` is false) and, while comments are off, gains
  nothing else.
- With `CommentsEnabled=true`, the relay gets `MODERATION_SECRET_ID:
  elixir-mcp/moderation` and its role the one read above.

No MCP, `/api/v1`, schema or policy page change.
`services/mcp/test/infra-controls.test.mjs` holds the template to no key in
any environment variable and the one switched grant;
`services/email-relay/test/moderation-key.test.mjs` holds the read, the
cache, the refusal re-read, `moderation_off` and that the value is never
logged or stored.
