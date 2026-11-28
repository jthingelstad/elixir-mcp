# 2026-11-28 — Turnstile refusal: one sentence, and a reload that works

Jamie agreed on 2026-11-28 that a person Turnstile refuses sees one plain
sentence, the same on every one of his sites:

> We couldn’t confirm you’re not a bot. Reload the page and try again.

It is `TURNSTILE_REFUSED_MESSAGE` in `packages/auth/src/turnstile.mjs`;
the website's copy moved beside the other constants it copies from the
server (`TURNSTILE_REFUSED` in `apps/web/src/turnstile.js`), and the copy
test in `apps/web/test/turnstile.test.jsx` now holds it to the server's
word for word. Elixir is still in `observe`, so nobody sees it yet.

"Reload the page" was not true on the OAuth email step. Its refusal was
the answer to a POST to `/oauth/authorize`: a reload asked to resend the
same form, which still had no token and was refused again, and a reload
as a GET (the address bar) had no authorization request left and said
"Can't authorize". Now, under enforce, the refusal is a 303 to the email
step's GET, rebuilt from the request the POST validated (`client_id`,
`redirect_uri`, `state`, `code_challenge`, `scope`, `resource`), with
`switch=1`, so a browser signed in as someone else still gets the email
step, and `turnstile=refused`. That GET validates the request again and
shows the sentence above the form with a fresh widget; a reload is the
same GET. Only the exact value `refused` selects the fixed sentence;
nothing in the link reaches the page as text. Nothing the person typed
goes in the URL, so they type their address again. The refusal is still
logged once, as `turnstile_refused`, at the POST.

The website's door is unchanged apart from the words: `/signin` is a GET
page, so a reload already gives a fresh page and widget, and it is the
only way to retry a Cloudflare script that failed to load.

No site docs or What's new entry: the text is not visible to anyone
while the mode is `observe` (`AGENTS.md`, "Docs ship with the change"
covers user-visible behaviour). No contract, migration, MCP or JSON API
change.
