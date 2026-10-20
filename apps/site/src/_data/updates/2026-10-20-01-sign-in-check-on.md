# The sign-in check now counts

The Cloudflare Turnstile check on the sign-in forms, which until today
was only recorded, now decides. A sign-in email no longer goes out when
the page's check is missing or failed, so a script cannot fill someone
else's inbox with sign-in mail.

For a person nothing changes: the check is usually invisible, and
Cloudflare may ask for a click. If your browser cannot load Cloudflare's
check, the form asks you to reload the page and try again.
[Limits](/docs/limits) says how far one check goes.

MCP 11.13.1 and JSON API 3.2.0, unchanged.
