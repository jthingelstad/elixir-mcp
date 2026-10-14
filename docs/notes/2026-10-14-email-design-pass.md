# Every Elixir email: design and content pass

Jamie asked for a design pass on all mail after the second application UI
pass. This changes presentation, truthful service copy and offline preview
coverage, not recipients, schedule, preferences, delivery or account powers.
MCP 11.13.0 and JSON API 3.2.0 stay unchanged. No tool declaration or served
response changed, so MCP acceptance is not applicable.

## Scope and design

The single SES sender consumes product bodies from packages/mail and service
bodies from services/email-relay. Reviewed seven active product kinds, the
collector upgrade and historical replay branches, website and code-only
OAuth sign-in, welcome, all operator-notice categories and the generic
fallback. Retired card-of-week and top-100 generation remains refused;
old unsubscribe and archived-send compatibility is unchanged. Buttondown
is the separately consented product-news channel, not an Elixir template.

The shared dark palette, existing logo and unchanged hosted art remain.
Plain source text replaces a pill; the gold top bar and repeated frames go.
Figures have two open columns at most. Headings use normal case and semantic
heading elements. War standings use three fluid columns with finish status
under fame. Coverage keeps its complete words in an unboxed note, and the
footer separates reason, choices, record links and send id. Primary HTML
buttons no longer repeat a visible raw URL; text alternatives retain URLs.

Arena alt records name each mode without a second pooled record. Repeated
visible player tags become link titles/destinations. Action rows keep the
ordering, counts and new markers and lead to the one Actions page. Feedback
leads with the answer or question, then the original excerpt. Collectors
keep states, errors, contribution and self-report security qualifications.
Operator details wrap instead of forcing a wide layout.

## Review findings closed

- Activity-scope clan facts coalesced unknown battles/active members to zero.
  The composer retains null and the renderer suppresses those figures even
  for older stored activity-scope facts. Zero in a comprehensive record is
  still zero; unknown remains unknown.
- Raw roster departures said left without a leader's classification. Body,
  subject and bounce wording now say departed.
- OAuth mail promised a consent page and a link even for the code-only family
  flow. It names the client neutrally and describes only what is included.
  Code-first subject/preheader, expiry and fragment token handling remain.
- Welcome's footer said access approved; it now says the account is ready.
  Its primary link opens Tracking, matching the text's next step.
- Feedback questions had an answered title; question title/action now agree.
- The gallery replaced actual service text with HTML-derived text and hid
  the owner notice's missing plain-text disclaimer. It now shows actual
  service text, with the disclaimer present in both alternatives.
- Engineering docs still described the removed preferences grid; corrected.

## Product questions and brief answers

Who gets mail and when? The Mail brief's seven kinds, service mail,
preferences and schedule remain. No recipient gate or send code changed.
What may be simplified? Presentation and repetition; facts, coverage,
mode separation, attribution, action authority and record links remain.
What does unknown mean? The record's null is unknown, never a zero.
Does preview count as a send/open? No: fixture render, pixel stripped,
no outbox/SES write. Archived mail is not rewritten.

## Verification and fidelity

The gallery includes 47 specimens rather than only 13. It renders all
current event paths plus sparse, activity-only, partial, quiet, long-text
and stored-facts cases, and each service notice. A scratch-database
regression covers the activity-only composer; mail tests cover null/older
zero facts, question titles, code-only copy, escaping and actual text.
Browser layout checks cover every specimen with images blocked at 320,
390, 820, 1280 and 844px landscape. The existing large-clan output guard
remains below 95 KB. No real test email, model call, webhook or event was
created.

Generated report and code-only concepts established the hierarchy. Existing
logo, brand gold, semantic blue/rose record colors, original art and real
facts replace the generator's invented marks, data and full-record colors.
These are intentional constraints, not product changes. The final visual
comparison covers source/header hierarchy, typography, open figures,
container/row model, palette/art, primary-link and coverage/footer grouping.
The exact table/inline layout is used in the local gallery; no raster mockup
ships. Browser rendering is checked in IAB; repository Playwright supplies
repeatable width checks (the Browser plugin is not available). Native mail
clients' proprietary rendering is not simulated by Chromium.
