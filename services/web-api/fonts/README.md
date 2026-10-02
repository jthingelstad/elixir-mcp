# Fonts for the share picture

The battle page's share picture (`/battle/<short id>.png`,
`src/share-image.mjs`) is drawn on the server, and its renderer reads
TrueType or OpenType, not the WOFF2 the site serves. These two files are
the same **Inter** (© 2016 The Inter Project Authors,
<https://github.com/rsms/inter>, SIL Open Font License 1.1, licence in
`Inter-OFL.txt`) as `apps/web/public/assets/fonts/Inter-*.woff2`:
every subset the site ships (Latin, Latin Extended, Cyrillic, Greek,
Vietnamese), merged into one face and fixed at one weight.

| File | Weight |
| --- | --- |
| `Inter-Regular.ttf` | 400 |
| `Inter-Bold.ttf` | 700 |

They were cut with fontTools from the site's variable WOFF2:
`varLib.instancer` at `wght` 400 and 700, the layout tables dropped
(GSUB, GPOS, GDEF, STAT: the picture needs no kerning or ligatures),
then the seven subsets merged with `fontTools.merge`. Re-cut them the
same way if the site's Inter files change.

The display face is the site's own `Clash_Regular.otf`, read from
`apps/web/public/assets/fonts/` (Supercell Fan Kit; see the README
there). The build copies all three into the web API's bundle
(`infra/scripts/build.mjs`).
