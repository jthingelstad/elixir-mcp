/** Highlights (social slice 4, #762): a person posts one of their
 *  verified players' battles to that player's timeline with their own
 *  words, and may share it as /h/<share id>.
 *
 *  The writes are the signed-in person's own (`/api/me/highlights`, the
 *  contract header required, never an agent's console). The post's page,
 *  picture and JSON are public, class "record" in the public-boundary
 *  test: the page is the app shell with the post's preview tags written
 *  into it, as /battle/<id> is. A deleted post is a 404 at once from
 *  here; the edge keeps an answer a minute, so a deleted post's link
 *  stops opening within about a minute. */
import { json, UUID_RE } from "../http.mjs";
import {
  createHighlight,
  deleteHighlight,
  editHighlight,
  highlightsOn,
  readPublicPost,
  shareHighlight,
} from "../highlight.mjs";
import { namedShell, previewOf } from "./battle.mjs";

const reply = (r, ok) =>
  r.error
    ? json(r.status, { error: r.error, message: r.message })
    : json(r.status, ok(r));

const page = (statusCode, body, maxAge) => ({
  statusCode,
  headers: {
    "content-type": "text/html; charset=utf-8",
    "cache-control": `public, max-age=${maxAge}`,
  },
  body,
});

/** How a shared post unfurls: whose post it is and their words, over the
 *  battle's own preview. Plain strings; namedShell escapes each. */
function postPreview(read) {
  const battle = previewOf(read);
  const h = read.highlight;
  const who = h.name ?? h.player_tag;
  const words = String(h.words ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const clipped =
    [...words].length > 180
      ? `${[...words].slice(0, 179).join("").trimEnd()}…`
      : words;
  return {
    title: `${who} on Elixir: ${battle.title}`,
    description: clipped
      ? `“${clipped}”  ${battle.description}`
      : battle.description,
  };
}

/** The post's picture: the battle's, with the owner's name, words and the
 *  post's link in its foot. A minute at the edge, so a deleted post's
 *  picture goes when its page does. */
async function picture(db, shareId, shareImage) {
  const text = (statusCode, body, maxAge) => ({
    statusCode,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
    },
    body,
  });
  if (!shareImage) return text(503, "The share picture is not set up.", 0);
  const read = await readPublicPost(db, shareId, { around: false });
  if (read.status !== 200) return text(404, "No post at this address.", 60);
  const png = await shareImage(read);
  return {
    statusCode: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=60",
    },
    body: Buffer.from(png).toString("base64"),
    isBase64Encoded: true,
  };
}

export function highlightRoutes({ resolveAccount, siteShell, shareImage }) {
  const person = (db, event, write) =>
    resolveAccount(db, event, { requireContractHeader: write });
  const unauthenticated = () => json(401, { error: "unauthenticated" });
  const idOf = (event) => {
    const id = String(event.pathParam ?? "");
    return UUID_RE.test(id) ? id : null;
  };
  const notFound = () =>
    json(404, { error: "not_found", message: "No such highlight." });

  return {
    // The battle page's panel: may I highlight this battle, as whom, and
    // what have I posted on it.
    "GET /api/me/highlights": async (db, event) => {
      const account = await person(db, event, false);
      if (!account) return unauthenticated();
      const battle = event.queryStringParameters?.battle;
      if (!battle)
        return json(400, {
          error: "bad_request",
          message: "Name the battle: ?battle=<id or link>.",
        });
      return reply(await highlightsOn(db, account.accountId, battle), (r) => ({
        battle_id: r.battle_id,
        can_highlight_as: r.can_highlight_as,
        highlights: r.highlights,
      }));
    },

    "POST /api/me/highlights": async (db, event, body) => {
      const account = await person(db, event, true);
      if (!account) return unauthenticated();
      return reply(
        await createHighlight(db, account.accountId, {
          battle: body.battle,
          player_tag: body.player_tag,
          words: body.words,
        }),
        (r) => ({ highlight: r.highlight }),
      );
    },

    "PUT /api/me/highlights/*": async (db, event, body) => {
      const account = await person(db, event, true);
      if (!account) return unauthenticated();
      const id = idOf(event);
      if (!id) return notFound();
      return reply(
        await editHighlight(db, account.accountId, id, { words: body.words }),
        (r) => ({ highlight: r.highlight }),
      );
    },

    "DELETE /api/me/highlights/*": async (db, event) => {
      const account = await person(db, event, true);
      if (!account) return unauthenticated();
      const id = idOf(event);
      if (!id) return notFound();
      return reply(await deleteHighlight(db, account.accountId, id), () => ({
        deleted: true,
      }));
    },

    "POST /api/me/highlights/share": async (db, event, body) => {
      const account = await person(db, event, true);
      if (!account) return unauthenticated();
      const id = String(body.highlight_id ?? "");
      if (!UUID_RE.test(id)) return notFound();
      return reply(await shareHighlight(db, account.accountId, id), (r) => ({
        highlight: r.highlight,
      }));
    },

    // A shared post's page, PUBLIC (DECISIONS "Everyone signs in; shared
    // posts stay public"): the app shell with the post's preview tags.
    "GET /h/*": async (db, event) => {
      const ref = String(event.pathParam ?? "");
      if (ref.endsWith(".png"))
        return picture(db, ref.slice(0, -".png".length), shareImage);
      if (!siteShell)
        return page(503, "<!doctype html><title>Elixir</title>", 0);
      const shell = await siteShell();
      const read = await readPublicPost(db, ref);
      if (read.status !== 200) return page(404, shell, 60);
      return page(
        200,
        namedShell(shell, read, {
          ...postPreview(read),
          url: read.highlight.url,
          image: read.highlight.image,
        }),
        60,
      );
    },

    // The post's JSON, PUBLIC: the battle as its page reads it, and the
    // owner's game name and words. No account, nickname or sender.
    "GET /api/public/highlights/*": async (db, event) => {
      const read = await readPublicPost(db, event.pathParam);
      if (read.status !== 200)
        return json(
          404,
          { error: "not_found" },
          { "cache-control": "public, max-age=60" },
        );
      const body = { ...read };
      delete body.status;
      return json(200, body, { "cache-control": "public, max-age=60" });
    },
  };
}
