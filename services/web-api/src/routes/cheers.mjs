/** Cheers and the RSS link (social slice 7's second part, #765).
 *
 *  `PUT /api/me/cheers` sets, changes or takes back the signed-in person's
 *  cheer on a timeline item: the contract header required, a person only
 *  (an agent is refused, and no agent console reaches it:
 *  AGENT_SCOPED_ROUTES does not list it), rate limited.
 *
 *  `GET /api/me/cheers?player=<tag>` or `?battle=<ref>` answers which of a
 *  player page's or a battle page's items take cheers for this reader (the
 *  ones in their own feed now) and their counts. Read separately, so the
 *  page itself and the public battle JSON stay as they are.
 *
 *  `/api/me/rss` is the person's private RSS link: GET says whether it is
 *  on, POST makes or resets it (answering the link, the one time it is
 *  shown), DELETE turns it off. `GET /api/rss/<token>` is the feed itself:
 *  the token is its credential, and a token that opens nothing is a 404
 *  (class "private link" in the public-boundary test). */
import { checkRateLimit } from "@elixir-mcp/auth";
import { normalizeTag } from "@elixir-mcp/contracts";
import { buildTimeline, subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { json } from "../http.mjs";
import { annotateFeed } from "../feed.mjs";
import {
  CHEERS_PER_HOUR,
  CHEER_READS_PER_HOUR,
  cheersOnPage,
  inOwnFeed,
  readCheerBody,
  setCheer,
} from "../cheers.mjs";
import {
  FEED_READS_PER_HOUR,
  FEED_RESETS_PER_HOUR,
  accountForToken,
  feedItems,
  feedLinkState,
  removeFeedLink,
  renderRss,
  resetFeedLink,
} from "../feed-link.mjs";

const unauthenticated = () => json(401, { error: "unauthenticated" });
const notEntitled = () =>
  json(403, {
    error: "not_entitled",
    message: "Cheers and the RSS link are a person's own; an agent has none.",
  });
const limited = () =>
  json(
    429,
    { error: "rate_limited", message: "Too many in an hour. Try again later." },
    { "retry-after": "600" },
  );

const text = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  },
  body,
});

export function cheersRoutes({ resolveAccount }) {
  const person = async (db, event, write) => {
    const account = await resolveAccount(db, event, {
      requireContractHeader: write,
    });
    if (!account) return { refused: unauthenticated() };
    if (account.kind === "agent") return { refused: notEntitled() };
    return { account };
  };

  return {
    "PUT /api/me/cheers": async (db, event, body) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      const asked = readCheerBody(body);
      if (asked.error) return json(400, asked);
      if (
        !(await checkRateLimit(db, {
          bucket: `cheer#${account.accountId}`,
          max: CHEERS_PER_HOUR,
        }))
      )
        return limited();
      // Taking a cheer back needs nothing more; giving one needs the item
      // in the person's own feed now.
      if (asked.cheer !== null) {
        const shown = await inOwnFeed(db, {
          accountId: account.accountId,
          itemId: asked.itemId,
          tags: asked.tags,
          subjects: await subjectsFor(db, account.accountId),
        });
        if (!shown)
          return json(404, {
            error: "not_found",
            message: "That item is not in your feed now.",
          });
      }
      return json(
        200,
        await setCheer(db, account.accountId, asked.itemId, asked.cheer),
      );
    },

    // A page's cheers: which of its items are in the reader's feed now.
    "GET /api/me/cheers": async (db, event) => {
      const { account, refused } = await person(db, event, false);
      if (refused) return refused;
      const q = event.queryStringParameters ?? {};
      let player = null;
      if (q.player != null) {
        try {
          player = normalizeTag(String(q.player));
        } catch {
          return json(400, { error: "invalid_tag" });
        }
      }
      const battle = player ? null : String(q.battle ?? "").trim();
      if (!player && !battle)
        return json(400, {
          error: "bad_request",
          message: "Name a player or a battle.",
        });
      if (
        !(await checkRateLimit(db, {
          bucket: `cheerread#${account.accountId}`,
          max: CHEER_READS_PER_HOUR,
        }))
      )
        return limited();
      const page = await cheersOnPage(db, {
        accountId: account.accountId,
        subjects: await subjectsFor(db, account.accountId),
        player,
        battle,
      });
      if (!page) return json(404, { error: "not_found" });
      return json(200, page);
    },

    "GET /api/me/rss": async (db, event) => {
      const { account, refused } = await person(db, event, false);
      if (refused) return refused;
      return json(200, await feedLinkState(db, account.accountId));
    },

    "POST /api/me/rss": async (db, event) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      if (
        !(await checkRateLimit(db, {
          bucket: `rsslink#${account.accountId}`,
          max: FEED_RESETS_PER_HOUR,
        }))
      )
        return limited();
      return json(200, await resetFeedLink(db, account.accountId));
    },

    "DELETE /api/me/rss": async (db, event) => {
      const { account, refused } = await person(db, event, true);
      if (refused) return refused;
      return json(200, await removeFeedLink(db, account.accountId));
    },

    // The feed: the token opens one person's own timeline, read as Home
    // reads it but not interactively (no leaders-only facts), and never
    // the account's administration.
    "GET /api/rss/*": async (db, event) => {
      const owner = await accountForToken(db, event.pathParam);
      if (!owner) return text(404, "No feed at this address.");
      if (
        !(await checkRateLimit(db, {
          bucket: `rss#${owner.account_id}`,
          max: FEED_READS_PER_HOUR,
        }))
      )
        return text(429, "Too many reads in an hour.", {
          "retry-after": "900",
        });
      const subjects = await subjectsFor(db, owner.account_id);
      const toMs = Date.now();
      const built = await buildTimeline(db, subjects, {
        fromMs: toMs - 7 * 86_400_000,
        toMs,
        timezone: owner.timezone ?? "UTC",
        accountId: owner.account_id,
        // Never the account's administration: left out at the read, so it
        // spends none of the timeline's cap either.
        accountLines: false,
      });
      const items = await annotateFeed(db, feedItems(built.timeline), subjects);
      return {
        statusCode: 200,
        headers: {
          "content-type": "application/rss+xml; charset=utf-8",
          // The link is private: no shared cache keeps it, so a reset
          // stops it at once.
          "cache-control": "private, max-age=300",
          "x-robots-tag": "noindex",
        },
        body: renderRss(items),
      };
    },
  };
}
