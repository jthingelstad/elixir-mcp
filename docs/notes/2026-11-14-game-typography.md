# 2026-11-14 — Game titles and a readable interface

Jamie rejected the neutral title face in the supplied phone screenshot:
“I prefer to use the Clash Royale font to anchor back to the game for main
titles. And then use a better font for the other areas.” This supersedes
the earlier title-face choice. The phone-first social experience and the
hold on deployment remain.

Main titles use the existing official Clash Royale Regular file at weight
400, without synthetic bold or negative tracking. The front page, Docs,
Home, Find, player and clan page names, Settings and the shared page head
use that semantic main-title role. Smaller PageHead sections, list names,
body text and controls use Rubik. Numbers and tags keep their existing
readability rules, and the sign-in code stays mono.

Rubik is an engineering pairing choice: rounded corners suit the game
face, with a legible interface at the existing 16/14/12px roles. Six
unmodified Google Fonts variable WOFF2 script subsets cover 400–700;
Latin is 35,324 bytes and the other subsets load only when needed. The
OFL and provenance ship beside them. Everything is self-hosted. Inter
stays for scripts Rubik lacks, and system fallbacks remain.

The email shell progressively adds the same game title and Rubik body
faces. Its only style block declares local font faces, hidden from the
Word-based Outlook renderer; layout is still inline tables. Unsupported
clients use inline Arial Black title and Trebuchet MS / Arial body stacks.
This deliberately relaxes the former no-style-block engineering default
only for optional fonts. No external CSS or font host is introduced. Live read-only inspection
found that existing font responses have no CORS header, so `FontCors`
adds `Access-Control-Allow-Origin: *` only to successful public font
GET/HEAD responses on the default static behavior. Private app/API doors
have no association and keep their existing headers. This supports mail
and sandboxed archives without credentials or per-reader URLs.
[Can I email's font-face test](https://www.caniemail.com/features/css-at-font-face/)
documents the limited support and Outlook's fallback issue; this is not
a claim that Gmail or every email client renders the custom fonts.

The first local sign-in email captures could load the login tracking
pixel. The capture harness was corrected to strip those pixels and abort
all off-origin requests before the final comparisons. No email was sent
and no production application data was written.

## Evidence and product questions

No new product question remains: the title face is Jamie's explicit
choice. Rubik, script fallback and progressive email fonts are engineering
implementation choices under that direction. Source words, routes, data,
layout hierarchy and image crops remain unchanged. The official Clash
font matches main byte-for-byte (SHA-256
`0a4fcf70dfa5e4bcb8887eb73b701cf2d216bba1cec6bbb30cc06e5a86dc1afe`).

[Before/after gallery](../design/game-type/README.md) covers nine app/site
surfaces plus digest and sign-in email at 390 and 1280px, first screen
and full page. Before CSS is compiled from the exact base commit, with
the same fixed clock and invented fixtures. All 22 body-text comparisons
match after whitespace normalization, and none overflows.

The in-app browser could not attach a webview on two attempts; local
Playwright supplied actual viewport captures instead. Six new journeys
cover the front door -> Create an account -> sign-in form at 320, 390 and
1280px with loaded or blocked fonts. They prove actual local font loading,
regular-weight titles, readable fields and working navigation. The
existing Clan loaded/fallback density and mail reflow checks remain.

`cfn-lint --non-zero-exit-code error infra/template.yaml` reports no
errors. Its five warnings are identical to the base template, verified
with a separate base lint. The actual edge function is executed from the
template in offline tests: only GET/HEAD public font successes receive
CORS, application/API paths and error responses stay unchanged, security
headers are retained, and no credentials header is added. No new IAM
permission or parameter is introduced. The template change takes the
platform lane on a later authorized deployment.

Node 24 `npm run verify` passed static checks, all 30 test units and
Lambda builds. The complete `ELIXIR_E2E_PORT=8844 npm run e2e` passed
all 516 journeys without retries, including the six new font journeys.
The focused 24 browser checks also passed. All 88 comparison PNGs are in
the gallery. Nothing was deployed and no email was sent.
