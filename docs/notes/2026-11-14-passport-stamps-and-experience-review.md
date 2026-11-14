# 2026-11-14 — Passport Stamps design and phone experience review

Jamie approved the typography direction and asked for a product scan and
Stamp specification that a later session can build. This change adds the
product brief, eleven-definition catalog, native local prototype, visual
reference, phone captures, implementation handoff and ready-to-paste Claude
prompt. It changes no production behavior, storage, API contract or mail.

Jamie established the passport metaphor, visibility on all accounts, and
verification/map setup as earnable milestones. These supersede the older
domain plan's exclusions and optional verified-only public row. Engineering
defaults are labeled in the brief and build handoff, including signed-in
member visibility, owner-only progress and the eleven-definition catalog.
Current gold verification remains separate from a dated earned Stamp.
Country/region/city are valid map choices; Not now finishes the profile
choice without earning On the Map, and email Off counts toward All Set.

The phone review records Bell, quiet-feed/setup, Profile and navigation
follow-ups. Those recommendations are not silently implemented here. Implementation is
tracked in #1015, phone follow-ups in #1016 and Bell in #1009.
No What's new entry or public behavior docs are added for a design-only
proposal. App/mail fonts and verification from the previous merged work
remain the baseline. Stamps introduce no email or feed content.

Validation: existing design capture's two browser cases; native in-app
browser inspection; prototype viewport/state, accessibility, privacy and
focus interactions; repository verify gate (static checks, all 30 unit workspaces and Lambda
bundles). The docs-only e2e scope gate returned false. Screens use local invented
fixtures and block off-origin requests. No production write, live mail,
backfill or deployment was performed. Exact results accompany the galleries.
