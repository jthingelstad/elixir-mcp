# 2026-11-11 — The sponsorship ask is removed

Jamie, 2026-11-11: "Let's remove the sponsorship stuff for now." Elixir
is being reframed as the social layer of Clash Royale, a service Jamie
pays for himself rather than one that asks for money.

Removed:

- The `/support` page (`apps/site/src/support.njk`) and its styles, its
  footer link (`packages/ui/src/family.json`, read by the site and the
  app), the app's `STATIC_LINKS.support`, and its line in `llms.txt`.
- The "free and sponsor-supported" line at the foot of every site page
  (`base.njk`) and every app page (`Shell.jsx`).
- The sponsor line in every email's footer (`packages/mail` shell), and
  its `support` argument.
- The repository's GitHub Sponsors button (`.github/FUNDING.yml`).
- The sponsorship sentences in the Terms and Email docs (the policy
  wording on Jamie's word above), `docs/EMAIL.md` and
  `docs/ENGINEERING.md`.

`/support` now answers the site's ordinary 404, as the retired `/data`
sub-pages did: it is a static path, which `apps/web/src/lib/moved.js`
(app paths only) cannot redirect, and mail already sent names it only in
the footer line. Old Updates entries keep their mentions as history.

The sponsorship clauses in `docs/DECISIONS.md` and `docs/product/` are
left to the VISION rewrite (#751), which drops them. "Human sponsor" in the integration docs means the
person an integration belongs to, not money, and stays.

Tests: `public-site.test.mjs` pins that no current page links `/support`
or GitHub Sponsors and that `llms.txt` lists neither; the mail tests pin
that no footer carries the line. Nothing a tool serves changed, so the
deploy runs no acceptance family. MCP and JSON API unchanged.
