# Fonts

## Inter

The `Inter-*.woff2` files are **Inter** (© 2016 The Inter Project Authors,
<https://github.com/rsms/inter>), licensed under the SIL Open Font License 1.1;
the licence is `Inter-OFL.txt`, beside them. One variable file per script subset,
as Google Fonts splits it, wired up by the `Inter` `@font-face` rules in
`packages/design/src/tokens.css`. They are served from this site rather than a font
CDN so a page load tells no third party what a reader read.

## Clash — Supercell Fan Content

The `.otf` files here are **Supercell's official "Clash" display font**, obtained from
the Supercell Fan Kit and used as fan kit assets under Supercell's Fan Content Policy.

- Font: **Clash**, © 2016 Supercell, designed by John Roshell (Comicraft).
- "Clash" is a trademark of Supercell.
- Source: Supercell Fan Kit — <https://fankit.supercell.com/> (Clash Royale fonts).

Weight present:

| File | Weight |
| --- | --- |
| `Clash_Regular.otf` | Regular |

**Regular** is wired up by the `Clash Royale` `@font-face` in
`packages/design/styles.css` (the stylesheet both halves of the site share) and the
browser share-card compositor. Unused weights are not shipped in the public bundle.

The file lives here, in the app's `public/`, and reaches the static site through the
merged build (`infra/scripts/build-site.mjs`), which is why both halves render the
display face in production. Running `apps/site` on its own falls back to Inter.

> This material is unofficial and is not endorsed by Supercell. For more information
> see Supercell's Fan Content Policy: <www.supercell.com/fan-content-policy>.

## Why this file lives in the repo

The font is served locally (bundled with the site's static assets) so the display
typeface renders reliably without a runtime dependency on a third-party CDN, and so it
is available to canvas/WebGL text rendering, which requires same-origin resources.

## Compliance notes

- The font is used **unmodified**. It is referenced via `@font-face` in
  `packages/design/styles.css` (family `Clash Royale`) and by the browser share-card compositor;
  the file itself is not altered. The policy prohibits modifying Supercell Assets.
- This is a **non-commercial fan project** (a Clash Royale elixir-cost learning app).
  No fees are charged.
- History: this repo previously shipped a third-party lookalike font ("Supercell Magic"
  © Active Images, 2009) that is **not** a genuine Supercell asset. It was replaced with
  this official Fan Kit font so the app uses only authentic, policy-covered Supercell art.

We acknowledge Supercell's ownership of this font and believe this use is within the Fan
Content Policy. Supercell may revoke this permission at any time; if asked, we will
remove this asset.
