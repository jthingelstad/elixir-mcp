# 2026-11-17 — Room for the Timeline, and a way back from writing

The fresh product walkthrough is [#1125](https://github.com/jthingelstad/elixir-mcp/issues/1125). It covers the built app with invented fixtures at 320, 390 and 1280px, plus the public site and docs. Its screenshots are in the [review evidence](../design/fresh-social-review/README.md).

## Defaults taken

- **How much should controls take from the first story?** VISION makes friends’ play the reason to open Elixir. Mode and Post share one phone row, recovering more than one 44px row in the reviewed complete-setup fixture. Show and New stay visible above it. Larger text can wrap the row rather than overlap its controls.
- **What happens when the feed is quiet or cannot load?** The page head owns Mode, beside Post, so neither depends on a successful populated feed. Standalone feeds keep their own mode picker. There is one picker, not two.
- **Where should the keyboard go after writing?** The writing field receives focus on opening. Cancel and a successful local send restore the same visible entry point. The desktop start button is recreated when the form closes, so the composer restores its new node after commit. No focus is restored on leaving the page.

These are layout and keyboard defaults. The post audience, moderation, limits, mail, push, RSS and MCP are unchanged. No game facts, schema, MCP contract or JSON API changed (MCP 13.11.0, JSON API 5.1.0).

## Verification

The new browser regressions fail on the baseline: phone Mode and Post occupy different rows, and desktop Cancel leaves focus on the body. They exercise keyboard opening, Cancel, reopening, a question, a fixture-only successful send, accessible names, 44px targets, axe, reduced motion and no horizontal overflow at all three widths. Existing mode, posts and freshness journeys cover filtering, refusals and the title’s position.

The rendered pass includes normal and quiet feeds, composer states and 200% root text on the two phone widths. Screenshots were inspected and the focus implementation refined after the first pass exposed that the old desktop opener was already disconnected before the field mounted. There are no live verification writes.

The consistency trace follows the Web and public-doc facets: HomePage, HomeFeed, the post composer, shared CSS, timeline docs, the decision and these regressions. No other surface owns this phone control row or composer. Native SSR/hydration remains under the full e2e gate. Production natural posting is left unverified because exercising it would write live data.

CI also checked the existing suggested-people first-screen guard at 375px without posts. Separating Mode from the Show chips initially inherited the page head’s 8px row gap instead of the filters’ 4px gap, leaving the third person just under the tabs on Linux. The phone’s Show and action rows share a 4px gap inside their own group, with freshness spacing preserved; the existing guards stay unchanged.

The full browser gate exposed an existing animation-settling flake in the large-text journeys: a transition canceled by an async update rejects its `finished` promise. A deterministic canceled-animation case reproduces that AbortError on the old helper. The helper now waits for all outcomes, then checks the next frame for replacement animations before measuring; the layout assertions remain unchanged.
