# 2026-11-12 — Docs catch up with the 2026-11-12 rulings

Docs only, no code. PRs #816 to #841 carried out Jamie's rulings of
2026-11-12; this change brings DECISIONS, the mail docs, the product
briefs and the skills level with them. Nothing here is a new ruling: each
amended line keeps its meaning and its tag, and the engineering detail
added cites the pull request it comes from.

## DECISIONS

- **Amended in place:** "A person's own web reads are unmetered" and "The
  hourly bucket stays for web reads" (Explore folded; Stats reads through
  `POST /api/me/stats`, Find and a player's Record through
  `POST /api/explore`); "Home paints first" (the feed is
  `GET /api/me/home/feed`, thirty a page from the stored `home_feed`; the
  Latest route is gone); "Whether the timeline is stored" (exactly what is
  read live over the stored row: highlights, attested facts, cheers, the
  chips' counts and New; the bell's `bell_week`); "Invite clanmates is not
  on Home" (now under Find › Your clan, #835); "Console folds into You,
  player pages and Settings" (where each page went, #819, #822, and a
  tagless first sign-in lands on Home's welcome steps); "The service page
  is signed-in" (Settings ▸ Admin ▸ Service; `/data/service` redirects).
- **Engineering detail added** to the lines for Stats opening for followed
  players (#833), the welcome checklist (#830), retiring the approval era
  (#827) and Recruit and Scout for elders and up (#817).
- **The digest line** now says what its clan part tells, which of the
  clan report's lines carry into it and which ended (#823). Two carry,
  renamed for the digest: "A clan's departure in mail says departed, even
  after a leader says removed" and "A clan part only when the clan has
  news". Three ended with the report and are removed: "The clan report's
  You line", "Gone quiet is a date; a removal stays clan-visible" and "A
  report's trend compares only recorded weeks". "A week's battles have one
  count" now names only Clan's The week. Arena week and the milestone
  mail stay tagged `[engineering]`.

## Mail

- `docs/EMAIL.md`: the digest is the one scheduled mail to members; the
  collector and Actions mails are operational, to a role, outside it;
  links, the player door and the Settings › Emails page as they are.
- `docs/product/mail.md` rewritten for the mail set as it is (four kinds),
  each paragraph tagged from DECISIONS, VISION and the notes.

## Briefs, READMEs and skills

- `ladder.md`: Stats serves your own players and those you follow.
- `structure.md`: Invite clanmates on Find, A11, A19, A30, D9, D11 and Q4
  annotated, Explore folded, Admin under Settings, Recruit for elders up.
- `README.md` names Stats; the discord-review, tool-change and ops skills
  name Settings ▸ Admin, the digest and the retired clan report.

## Left out, unsourced

No ruling found for: a tracked clan whose notifications are off no longer
reaching its tracker by mail (flagged in #823); whether the bell carries
your own firsts; posting a shared post to a clan's Discord (unbuilt).
These sit under the mail brief's Open, not in DECISIONS.

The served docs (`apps/site/src/docs/`) are untouched; nothing here needs
a deploy.
