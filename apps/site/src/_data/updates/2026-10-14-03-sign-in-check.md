# A quiet check on the sign-in forms

The sign-in forms, on this site and on the page an app sends you to when
it connects to Elixir, now carry Cloudflare Turnstile. It tells a person
from a script that types someone else's address to fill their inbox with
sign-in mail. It is usually invisible; Cloudflare may ask for a click.

For now Elixir only records the check: every sign-in email is still
sent, whatever its result. [Privacy](/docs/privacy) says what Cloudflare
sees, and [Limits](/docs/limits) how far one check goes.

MCP 11.13.0 and JSON API 3.2.0, unchanged.
