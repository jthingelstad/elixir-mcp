# 2026-11-18: Post about a recorded milestone

Jamie authorized a Post action on an own verified recorded Timeline promotion,
Mastery or first Evo win, carrying the actual achievement alongside the author's
words. Engineering chose one compact, immutable attachment with the original
canonical item identity, kind, recorded time, named player, factual sentence and
game-only source locator. The snapshot contains no client facts, private Clan
state, People events or account fields. The original achievement remains a game
record; the new post is authored content with its own creation time and thread.

Supported public game kinds are badge/Mastery levels, legendary badges, upward
Arena moves, Ranked promotions, trophy bests, collection/career steps, card
unlocks/forms/max levels/first wins, King Tower levels and challenge achievements.
The whitelist is shared between the display affordance and source normalizer.
The source independently re-resolves the selected record and selects an own
verified primary/alt named by it. An atomic INSERT predicate checks that ownership
again after moderation. Editing words cannot replace or remove the achievement.

The Post affordance sits above the unified social row and also works in expanded
Mastery groups. Opening focuses the writing field; Cancel or success returns to
its trigger. A milestone replaces deck/cards/battle as the one attachment. Words
remain required and use existing five-per-day/one-per-minute plain-post limits,
moderation, current post audiences, blocks and delivery choices. No new scheduled
message, push, Discord action or agent write is introduced.

The canonical posts reader normalizes the stored shape once. Member pages,
public one-item shares and their pictures, person MCP, private RSS and the existing
digest preserve the same factual sentence and original time. Names and sentences
are escaped at HTML/SVG/XML output. No card or badge art is altered.

0304 adds a nullable JSONB column with a five-second lock timeout, no rewrite,
backfill or index. The coordinating read-only production census on 2026-11-18
showed eight estimated live posts and an 8,192-byte heap page. Scratch migrations
pin the schema fingerprint. MCP 14.1.0 adds nullable facts.moment to post/1;
JSON API 6.0.0 is unchanged.

Validation evidence is recorded in the PR: real handler regressions fail before
source changes, including another player's/private Clan record, forged facts and
ownership lost during moderation. Real canonical reads cover follower and blocked
member/MCP/RSS/digest audiences; share preview and web rendering retain the
attachment and escape hostile names. Screenshots and keyboard/accessibility checks
cover 320, 390 and 1280 with reduced motion. Production behavior remains unverified
until the coordinating deployment and natural acceptance.
