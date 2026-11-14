# 2026-11-14 — The docs after the social-layer pivot

An audit of the public docs, the guides, the skills and the product
briefs against `VISION.md`, the What's new entries of 2026-11-11 to
2026-11-13 and the code. Most surfaces had already moved with their
changes; what was left was small:

- **Public docs.** Stats' page and `llms.txt` drop the "Ladder until
  2026-11-12" history (no history in product pages). Sign in with Elixir
  lists Drop's scope as `cr:read account:email`, which is what Drop asks
  for (`ELIXIR_SIGN_IN_SCOPE` in `../drop.poapkings.com`, since Jamie's
  2026-11-12 "Drop: no writes to Elixir"); it listed `recordings:write`.
  Users and agents: Home's welcome steps, and the digest's Weekly, Daily
  or Off. Protocol says what the stored feedback areas `console` and
  `ladder` mean now (the website; Stats).
- **Guides and skills.** "Console" as the name of the web app becomes
  "the web app"; Ladder becomes Stats where it names the surface (the
  code keeps `ladder`); ENGINEERING says follow where it said track; the
  consistency facets' "Collector quota" row, whose credits retired on
  2026-10-12, becomes the role quotas row.
- **DECISIONS.** "Settings has one prefix" said `/console/*` still held a
  CloudFront behaviour; `infra/template.yaml` has none for it.
- **Briefs.** `docs/product/mail.md` carries a banner: the digest's
  weekly day is Monday (Jamie, 2026-11-13), not Wednesday.

No tool, contract or behaviour changed. MCP and JSON API unchanged.
