# Fonts

## Rubik

Rubik is the interface face for body text, controls, lists and smaller
headings. Its slightly rounded corners pair with the official Clash face
on main titles. Copyright 2015 The Rubik Project Authors
(<https://github.com/googlefonts/rubik>), SIL Open Font License 1.1;
`Rubik-OFL.txt` is beside the unmodified font files.

The six `Rubik-*.woff2` files are Google Fonts' variable 400–700 script
subsets, obtained from the official CSS API on 2026-11-14:
<https://fonts.googleapis.com/css2?family=Rubik:wght@400..700&display=swap>.
The family and metadata are published at
<https://github.com/google/fonts/tree/main/ofl/rubik>. Requests at runtime
stay on Elixir's own origin. The Latin file is about 35 KB; other scripts
load only when their characters are used. Inter remains the fallback for
scripts Rubik does not contain, including Greek and Vietnamese.

Mail progressively uses the same pair in clients that support webfonts,
with inline Trebuchet MS / Arial body and Arial Black title fallbacks.
Fonts are ordinary static assets, never reader-specific URLs. The game
font file and official card art remain unmodified.

## Inter

The `Inter-*.woff2` files are **Inter** (© 2016 The Inter Project Authors,
<https://github.com/rsms/inter>), licensed under the SIL Open Font License 1.1;
the licence is `Inter-OFL.txt`, beside them. One variable file per script subset,
as Google Fonts splits it, retained as the fallback through the `Inter` `@font-face` rules in
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
`packages/design/src/tokens.css` (the stylesheet both halves of the site share) and the
browser share-card compositor. Unused weights are not shipped in the public bundle.

The file lives here, in the app's `public/`, and reaches the static site through the
merged build (`infra/scripts/build-site.mjs`), which is why both halves render the
display face in production. Running `apps/site` on its own falls back to system fonts.

> This material is unofficial and is not endorsed by Supercell. For more information
> see Supercell's Fan Content Policy: <www.supercell.com/fan-content-policy>.

## Why this file lives in the repo

The font is served locally (bundled with the site's static assets) so the display
typeface renders reliably without a runtime dependency on a third-party CDN, and so it
is available to canvas/WebGL text rendering, which requires same-origin resources.

## Compliance notes

- The font is used **unmodified**. It is referenced via `@font-face` in
  `packages/design/src/tokens.css` (family `Clash Royale`) and by the browser share-card compositor;
  the file itself is not altered. The policy prohibits modifying Supercell Assets.
- This is a **non-commercial fan project** (the social layer of Clash Royale).
  No fees are charged.
- History: this repo previously shipped a third-party lookalike font ("Supercell Magic"
  © Active Images, 2009) that is **not** a genuine Supercell asset. It was replaced with
  this official Fan Kit font so the app uses only authentic, policy-covered Supercell art.

We acknowledge Supercell's ownership of this font and believe this use is within the Fan
Content Policy. Supercell may revoke this permission at any time; if asked, we will
remove this asset.
