# 2026-11-18 - Plain posts in person MCP and private RSS

Jamie approved bringing plain posts and questions to a person's authorized
MCP connection and private RSS. These are explicit delivery readers of
`packages/posts`, outside the game-record Timeline. They use the same
current player/account-follow audience, approved author, visible-only
moderation status, open reports and two-way blocks as the member reader.
Hidden own posts remain an app concern and never leave through these doors.

The existing `elixir_timeline` gains `post/1` in section `posts`, only for a
person principal. A clan agent receives none, even with `on_behalf_of`.
The delivery DTO carries words, question/answered flags, player name/tag,
normalized deck/cards and the signed-in member destination. No comment
text/counts, nickname, author account machinery, web permissions or public
share URL is included. The output schema allows only these post facts and standard item fields.
Its post/record union uses the registry validator’s supported `anyOf`,
`enum` and `pattern` keywords. Regressions call that validator directly
and reject injected comments, editing controls, nicknames, public-share
fields and publication permission.
`visibility: followers` and `publishable: false` keep a person-scoped read
out of existing publication consumers. No capability is created.

An observed window selects creation or latest edit at JSON millisecond
precision. An edit keeps its item ID, creation/display time and growing
revision. Occurred windows select creation. Filters run before counts and
caps; omitted posts remain counted without hydrating attachments beyond
one page. Existing reader pointers stay separate from the app's seen mark.
The recorder's `meta.timeline_pending` subject indicator is unchanged.

The private RSS token, resets, rate limit, seven-day window and fifty-item
cap are unchanged. Post descriptions include deck/card names and escape
all authored text and game names. Post links open the member destination,
which rechecks access after sign-in. Edits keep a GUID; the next read omits
removed or newly inaccessible content. A feed reader may retain downloaded
copies. No comment text is read for delivery, and the DTO omits public share fields.

Source work moves existing battle-post facts below the tool registry,
removing the posts-to-tools dependency before tools read canonical posts.
Member readers keep their existing direct audience predicate; bounded
external pages derive indexed candidate IDs from the same audience paths
and run status/report/block checks before their count and cap. No schema
migration or game read is added. The MCP environment uses the existing
combined Posts/Comments condition. The app's New count and watermark stay creation-only,
as does the existing digest's send window; neither treats edits as new.

Defaults decided in engineering: the person-only grant, followers scope,
no publication permission, allowlisted DTO and member destinations. These
match the approved delivery scope and require no legal wording change.

Browser QA used repository Playwright because the Browser plugin was not
available. The docs were captured, inspected and iterated at 320, 390 and
1280 pixels with images blocked, external requests suppressed and reduced
motion enabled. The new descriptive link was focused and followed by
keyboard into the MCP post section. No horizontal page overflow or page
errors appeared. The RSS reader app's presentation is outside Elixir;
its XML content, escaping and member destinations are covered at the route.

MCP 13.13.0, additive; JSON API 5.1.0 unchanged. No new tool, subscription,
mail kind, write action or actual delivery is introduced. Baseline-failing
regressions cover MCP and RSS posts; source, read-pointer, cap, edit,
moderation, block/report and creation-only New/digest checks cover the
existing readers. Production read-back belongs to the coordinated release.
