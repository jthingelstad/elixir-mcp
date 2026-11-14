# Game titles and readable text

Main titles use the authentic Clash Royale Regular face, with Rubik on
body text, buttons, lists and smaller headings. The colors, source words,
routes and hierarchy stay the same.

These 88 PNGs cover nine app/site surfaces plus digest and sign-in email
at actual 390 × 844 and 1280 × 844 viewports, first screen and full page.
Before CSS is compiled from base `5ff51ef55`; the JavaScript is unchanged.
Both use the same existing invented fixtures and fixed clock
(`ELIXIR_DESIGN_NOW=2026-11-14T14:00:00Z`). No live member captures.
Final captures strip mail pixels and block all off-origin requests.

| Surface | Phone | Desktop | Full phone | Full desktop |
| --- | --- | --- | --- | --- |
| Site | [Before](before/site-390.png) / [After](after/site-390.png) | [Before](before/site-1280.png) / [After](after/site-1280.png) | [Before](before/site-390-full.png) / [After](after/site-390-full.png) | [Before](before/site-1280-full.png) / [After](after/site-1280-full.png) |
| Docs | [Before](before/docs-390.png) / [After](after/docs-390.png) | [Before](before/docs-1280.png) / [After](after/docs-1280.png) | [Before](before/docs-390-full.png) / [After](after/docs-390-full.png) | [Before](before/docs-1280-full.png) / [After](after/docs-1280-full.png) |
| Signin | [Before](before/signin-390.png) / [After](after/signin-390.png) | [Before](before/signin-1280.png) / [After](after/signin-1280.png) | [Before](before/signin-390-full.png) / [After](after/signin-390-full.png) | [Before](before/signin-1280-full.png) / [After](after/signin-1280-full.png) |
| Home | [Before](before/home-390.png) / [After](after/home-390.png) | [Before](before/home-1280.png) / [After](after/home-1280.png) | [Before](before/home-390-full.png) / [After](after/home-390-full.png) | [Before](before/home-1280-full.png) / [After](after/home-1280-full.png) |
| Find | [Before](before/find-390.png) / [After](after/find-390.png) | [Before](before/find-1280.png) / [After](after/find-1280.png) | [Before](before/find-390-full.png) / [After](after/find-390-full.png) | [Before](before/find-1280-full.png) / [After](after/find-1280-full.png) |
| Player | [Before](before/player-390.png) / [After](after/player-390.png) | [Before](before/player-1280.png) / [After](after/player-1280.png) | [Before](before/player-390-full.png) / [After](after/player-390-full.png) | [Before](before/player-1280-full.png) / [After](after/player-1280-full.png) |
| Stats | [Before](before/stats-390.png) / [After](after/stats-390.png) | [Before](before/stats-1280.png) / [After](after/stats-1280.png) | [Before](before/stats-390-full.png) / [After](after/stats-390-full.png) | [Before](before/stats-1280-full.png) / [After](after/stats-1280-full.png) |
| Clan | [Before](before/clan-390.png) / [After](after/clan-390.png) | [Before](before/clan-1280.png) / [After](after/clan-1280.png) | [Before](before/clan-390-full.png) / [After](after/clan-390-full.png) | [Before](before/clan-1280-full.png) / [After](after/clan-1280-full.png) |
| Settings | [Before](before/settings-390.png) / [After](after/settings-390.png) | [Before](before/settings-1280.png) / [After](after/settings-1280.png) | [Before](before/settings-390-full.png) / [After](after/settings-390-full.png) | [Before](before/settings-1280-full.png) / [After](after/settings-1280-full.png) |
| Mail Tracking_Report | [Before](before/mail-tracking_report-390.png) / [After](after/mail-tracking_report-390.png) | [Before](before/mail-tracking_report-1280.png) / [After](after/mail-tracking_report-1280.png) | [Before](before/mail-tracking_report-390-full.png) / [After](after/mail-tracking_report-390-full.png) | [Before](before/mail-tracking_report-1280-full.png) / [After](after/mail-tracking_report-1280-full.png) |
| Mail Login | [Before](before/mail-login-390.png) / [After](after/mail-login-390.png) | [Before](before/mail-login-1280.png) / [After](after/mail-login-1280.png) | [Before](before/mail-login-390-full.png) / [After](after/mail-login-390-full.png) | [Before](before/mail-login-1280-full.png) / [After](after/mail-login-1280-full.png) |

[Text and overflow comparison](comparison.json): all 22 scenes preserve
the text after whitespace normalization; none overflows. Six new journeys
exercise the actual Create an account -> sign-in form navigation at 320,
390 and 1280px, with loaded and blocked fonts. Existing roster font-failure
and all-mail layout checks remain. The in-app browser failed to attach a
webview on two attempts; the captures use Playwright's real viewports.

Email custom fonts are progressive, not promised in every mail client.
They use Elixir's own static assets and a guarded font-only style block;
inline Arial Black / Trebuchet MS / Arial fallbacks handle unsupported or
blocked fonts. The sign-in code remains mono. No font or image is rasterized
to replace readable text, and the official game font is unchanged.
