/** Cheers and the RSS link (social slice 7's second part, #765).
 *
 *  `PUT /api/me/cheers` sets, changes or takes back the signed-in person's
 *  cheer on a timeline item: the contract header required, a person only
 *  (an agent is refused, and no agent console reaches it:
 *  AGENT_SCOPED_ROUTES does not list it), rate limited.
 *
 *  `GET /api/me/cheers?player=<tag>` or `?battle=<ref>` answers which of a
 *  player page's or a battle page's actual recorded items and their counts.
 *  Read separately, so the
 *  page itself and the public battle JSON stay as they are.
 *
 *  `/api/me/rss` is the person's private RSS link: GET says whether it is
 *  on, POST makes or resets it (answering the link, the one time it is
 *  shown), DELETE turns it off. `GET /api/rss/<token>` is the feed itself:
 *  the token is its credential, and a token that opens nothing is a 404
 *  (class "private link" in the public-boundary test). */
import { checkRateLimit } from "@elixir-mcp/auth";
import { normalizeTag } from "@elixir-mcp/contracts";
import { subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { readFeedWeek } from "@elixir-mcp/tools/activity/home-feed";
import { readPostTimeline } from "@elixir-mcp/tools/activity/posts";
import { json } from "../http.mjs";
import { annotateFeed } from "../feed.mjs";
import {
  CHEERS_PER_HOUR,
  CHEER_READS_PER_HOUR,
  aboutSomeoneElse,
  cheeredAt,
  cheersOnPage,
  ownFeedItem,
  readCheerBody,
  setCheer,
} from "../cheers.mjs";
import { factAfter } from "../passport-hooks.mjs";
import {
  FEED_ITEMS,
  FEED_READS_PER_HOUR,
  FEED_RESETS_PER_HOUR,
  accountForToken,
  etagMatches,
  feedEtag,
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

/** A cheer on someone else's item, as a Cheerleader fact. Never throws:
 *  the hook's failures are logged and the cheer stands. */
async function cheerFact(db, accountId, item) {
  let at = null;
  try {
    if (!(await aboutSomeoneElse(db, accountId, item))) return;
    at = await cheeredAt(db, accountId, item.id);
  } catch {
    console.error(
      JSON.stringify({ at: "passport_hook_failed", hook: "cheerleader" }),
    );
    return;
  }
  if (!at) return;
  await factAfter(db, accountId, "cheerleader", {
    stamp_id: "cheerleader",
    source: `cheer:${item.id}`,
    event_at: at,
  });
}

export function cheersRoutes({ resolveAccount, posts = false, wake = null }) {
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
      // Taking a cheer back needs nothing more; giving one resolves the
      // actual recorded item and its current member audience.
      let shown = null;
      if (asked.cheer !== null) {
        shown = await ownFeedItem(db, {
          accountId: account.accountId,
          itemId: asked.itemId,
          tags: asked.tags,
          subjects: await subjectsFor(db, account.accountId),
          posts,
          item: body?.item ?? null,
        });
        if (!shown)
          return json(404, {
            error: "not_found",
            message: "That Timeline item is not available.",
          });
      }
      const answer = await setCheer(
        db,
        account.accountId,
        asked.itemId,
        asked.cheer,
        shown,
      );
      // Cheerleader (#1015), after the cheer is stored: one local day,
      // from the cheer's first stored instant. The item is its source, so
      // a retry, another emoji or a cheer taken back and given again is
      // the same cheer. Taking one back never revokes a day.
      if (shown) await cheerFact(db, account.accountId, shown);
      return json(200, answer);
    },

    // A member game page's recorded items and their shared cheer counts.
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
      const toMs = Date.now();
      // Home's stored week, read as the feed may carry it: never the
      // account's administration, a leaders-only fact or a people line
      // (readFeedWeek). A poll is a select, not a build.
      const week = await readFeedWeek(db, owner.account_id, {
        timezone: owner.timezone ?? "UTC",
        now: toMs,
        wake,
        need: FEED_ITEMS,
      });
      const { subjects } = week;
      const postPage = posts
        ? await readPostTimeline(db, owner.account_id, {
            subjects,
            fromMs: toMs - 7 * 86_400_000,
            toMs,
            basis: "observed",
            timezone: owner.timezone ?? "UTC",
            limit: 50,
          })
        : { items: [] };
      const items = await annotateFeed(
        db,
        feedItems([...week.items, ...postPage.items]),
        subjects,
      );
      const body = renderRss(items);
      const etag = feedEtag(body);
      const headers = {
        // The link is private: no shared cache keeps it, so a reset
        // stops it at once.
        "cache-control": "private, max-age=300",
        etag,
        "x-robots-tag": "noindex",
      };
      // A reader that holds these items already is told so, with no body
      // (checked after the token and the hour's cap, so a 304 says nothing
      // a 200 would not).
      if (etagMatches(event.headers?.["if-none-match"], etag))
        return { statusCode: 304, headers, body: "" };
      return {
        statusCode: 200,
        headers: {
          "content-type": "application/rss+xml; charset=utf-8",
          ...headers,
        },
        body,
      };
    },
  };
}
