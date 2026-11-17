# Fresh product review, 2026-11-17

The independent product review is [#1125](https://github.com/jthingelstad/elixir-mcp/issues/1125). These are the built app and the repository’s invented e2e fixtures, never production accounts. Before is `62875ab5d`; after is this change. Widths are actual Playwright viewports, not crops of a desktop window. Browser plugin not available in the session, so the repository’s Playwright setup was used.

The walkthrough covers Timeline, Find and its tabs, Clan Feed and Members, Profile, player Timeline/Follows/Record, Stats, Notifications, Settings, a battle, a shared post, a new account, the public homepage and docs at 320, 390 and 1280px. Screenshots and body text for the full walkthrough were inspected locally. The selected evidence below captures the finding and resulting change.

| Timeline | Before | After |
| --- | --- | --- |
| 320px | [Before](before/timeline-320.png) | [After](after/timeline-320.png) |
| 390px | [Before](before/timeline-390.png) | [After](after/timeline-390.png) |
| 1280px | [Before](before/timeline-1280.png) | [After](after/timeline-1280.png) |

Mode and Post share a phone row, recovering more than one 44px row above the first story. Show and New stay visible. The desktop’s quiet composer remains in place. The [quiet 320px feed](after/quiet-320.png) keeps both controls; the [390px composer](after/composer-390.png) gives focus to the words.

Other review evidence: [new account](before/new-account-390.png), [Find](before/find-390.png), [shared battle post](before/shared-post-320.png). Find’s hostile sample name is escaped text. Older fixture-only identity mismatches, missing auxiliary reads and historical season clocks are not presented as production defects.

## Checked

- Correct page identity, meaningful content, no framework error overlay or page errors, and no horizontal overflow in the walkthrough captures.
- The failing baseline regression measures separate Mode/Post rows on phones and lost focus after Cancel on desktop.
- Keyboard opening, Cancel, reopening, asking a question and a fixture-only successful send restore focus at 320, 390 and 1280px. Buttons retain accessible names and 44px targets; axe finds no serious or critical violations in the changed flow.
- Reduced motion, quiet-feed and composer states, plus a 200% root font-size check on both phone widths, stay within the viewport. The first focus implementation was refined after the browser exposed that the desktop opener was already disconnected before the field mounted.

No production post, comment, cheer, follow or mail was manufactured. This is fixture-based browser QA, not a live latency measurement, a physical phone test or a claim that natural posting has been accepted in production.
