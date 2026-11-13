# 2026-11-13 — Who sees what on Policy, closed Actions for leaders, the digest's Clan news switch

Three of Jamie's rulings of 2026-11-13 ("I agree with all your
recommendations on the product decisions."), one pull request. No
migration, MCP and the JSON API unchanged.

## The Policy tab says who sees what about you

Each rule card on Clan's Policy tab ends with a quiet line
(`.kit-rule__sees`) from `seesFor(key, values)` in
`apps/web/src/clan/components/HouseRules.jsx`, read from the saved
values. Standing draws the same cards without it. Each line follows what
the server sends:

| Rule | Line | Backed by |
| --- | --- | --- |
| About this clan | Nothing here is about you: every member reads it, and so does Elixir's clan directory. | `readClanDirectory`; `policyView` answers every member |
| What this clan counts | Every member sees your war decks, donations and battles each week. | `weekView` (`/week`, "every member's"), `WEEK_AREAS` participants |
| Minimums | Every member sees on Standing where you are against them. / Only you and the Leader and Co-Leaders see where you are against them. | `standing()`: `rows` only when Elder is ranked and `members_see_standing` is on (a leader always); `you` is the reader's own; `manageView` is `requireLeader` |
| Becoming an Elder | (ranked, on) Every member sees on Standing who's rising and who's slipping, with their numbers. / (ranked, off) Only you and the Leader and Co-Leaders see where you stand. Then, always: A promotion or demotion is shared with the clan once it's done. | the same `standing()` gate; `sharing.mjs` `role_change_made`, everyone verified in the clan |
| When you go quiet | Only you and the Leader and Co-Leaders see your days without a battle, whether you're at risk(, and your away). If they post the clan's Actions to Discord, a removal goes there too. A removal is shared with the clan once it's done. | `standing().you` (own inactivity, days idle, hold), `manageView` board, removal Actions' `leaders` audience, `discordShareable`, `sharing.mjs` `member_away` (leaders only) and `departure_classified` (everyone verified, on a completed removal); the roster shows a last-seen date, never a day count |
| Newcomers | Elders and the Leader and Co-Leaders get an Action naming you when you join. | `ACTION_TYPES.welcome.audience = "elders"` |

Under the cards: Elders read the Elders' notes about a member, the Leader
and Co-Leaders read every note (`notesFor`), and closed Actions and past
versions are the leaders'.

`policyView` now sends `versions: []` to anyone who is not the leader or
a co-leader (`isLeader`, as `can_edit`). The Run editor, the only reader
of the list, is the leaders' already. Pinned in
`packages/clan/test/manage.test.mjs` for a member and an Elder.

## Closed Actions are the leaders'

`mayRead(card, who)` in `packages/clan/src/manage/service.mjs`: an
Action the reader may act on, open, or closed with a verified leader or
co-leader reading. `actionsView`'s `recent`, `actionByNumber` and
`comment` all use it; a refused one is 404 `no_action`, as an Action that
is not yours. The Feed's Waiting dropped its "Closed in the last 30 days"
fold; leaders keep Run's Waiting and Decided. Pinned for a member and an
Elder in `packages/clan/test/manage.test.mjs`.

A member who completes their own away Action on its page sees it as
"No action" afterwards: the page's text now says a closed Action is for
the leaders.

## The digest's Clan news switch

Settings › Emails shows **Clan news** under the digest. It writes the
retired `clan_report` kind's existing `account_email_pref` row through
`PUT /api/me/email` (`{kind: "tracking_report", clan_part}`), which the
digest's fold already read (`foldedOff`); `GET /api/me/email` returns
`clan_part` on `tracking_report`. No new column. Every email leaves it
alone, because `setPref("all")` touches only the active kinds.

`build-digest.mjs` behaviour change [engineering]: with the clan part off
the digest has no clan blocks at all, and a followed clanmate's join,
departure or role change is told under them. Before, `clan_report` off
only stopped a digest whose only news was the clan's. A reader who
turned the old clan report off before the merge reads this way from the
next digest.
