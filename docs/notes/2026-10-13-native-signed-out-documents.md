# 2026-10-13 — Signed-out documents complete their native render

Live smoke caught the signed-out deep-link wall reading `window.location`
during server rendering. React's production Suspense boundary hid that error
behind an unfinished document, including Ladder's invitation. Read the route
from the universal router and save the sign-in return path after browser mount.
Initial server rendering and hydration also explicitly await synchronous router
loading so cold chunks and redirects settle before the document is rendered.

Regression coverage now starts with a cold, signed-out Ladder request and the
Console redirect root, checks useful initial HTML and rejects unfinished
Suspense markup before hydration. Existing session, email, code and magic-link
behavior remains. MCP 11.13.0 and JSON API 3.2.0 unchanged; this finishes the
Web Functions migration's smoke and full transport acceptance.
