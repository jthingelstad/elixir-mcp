/**
 * The clan's activity in its Discord (Jamie, 2026-10-10): Social's
 * Discord item. A leader or co-leader connects a webhook of the clan's
 * own (not the Actions one), chooses which of the clan's timeline is
 * posted there, and may have the clan's own model edit the channel in a
 * voice the leaders describe. The rules of what is posted are the
 * engine's (`activity.mjs`); the connection is kept and synced in
 * packages/syndication, handed in here as `store`, so this service never
 * holds the webhook or its sealed form.
 *
 * `store`:
 *  - read(clanTag) → the connection as leaders see it, or null;
 *  - save(clanTag, change, { who, clanName }) → { view } | { error };
 *  - remove(clanTag) → whether there was one;
 *  - preview(clanTag, { voice }) → the newest stories, the editor's
 *    packets and the one request that edits them (`clanEditorPreview`),
 *    posting nothing.
 * `ratings` (2026-10-11): a leader's thumbs up or down on a post of the
 * channel, filed as feedback by the host (`{ rate, mine }`), or null.
 */

import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_KEYS,
  VOICE_MAX,
  activityCategories,
  activityPolicy,
  cleanVoice,
  editorAnswer,
} from "@elixir-mcp/clan-engine";
import { ManageError, rateWith, ratingsOf } from "./service.mjs";
import { ACTIVITY_USES_PER_DAY } from "./model.mjs";

const LEADERS = new Set(["leader", "coLeader"]);

const refusals = {
  webhook_invalid: new ManageError(400, "webhook_invalid", null, {
    message:
      "That is not a Discord webhook address. Copy it from the channel's Integrations settings.",
  }),
  webhook_required: new ManageError(400, "webhook_required", null, {
    message: "Connect a Discord webhook first.",
  }),
  // The hello line's first word (2026-10-11): the connection is kept,
  // switched off, so the page shows it and why.
  webhook_forum: new ManageError(400, "webhook_forum", null, {
    message:
      "That webhook belongs to a forum channel, which takes threads, not messages. Use a text channel's webhook, or post into one thread: add ?thread_id= and the thread's id (Discord's Developer Mode, Copy Thread ID) to the end of the webhook.",
  }),
  webhook_gone: new ManageError(400, "webhook_gone", null, {
    message:
      "Discord says that webhook no longer exists. Copy it again from the channel's settings, Integrations, Webhooks.",
  }),
};

export function createActivityService({
  ledger,
  store,
  model = null,
  ratings = null,
}) {
  const requireLeader = (who) => {
    if (!LEADERS.has(who.role) || who.verified === false)
      throw new ManageError(403, "leaders_only");
  };

  async function view(clanTag, connection = undefined) {
    const policy = await ledger.currentPolicy(clanTag);
    const values = policy?.values ?? null;
    const saved =
      connection === undefined ? await store.read(clanTag) : connection;
    const key = model ? await model.summary(clanTag) : null;
    return {
      clan_tag: clanTag,
      connection: saved,
      ratings: await ratingsOf(ratings, saved?.deliveries),
      policy: activityPolicy(values),
      categories: ACTIVITY_CATEGORY_KEYS.map((k) => ({
        key: k,
        label: ACTIVITY_CATEGORIES[k].label,
        why: ACTIVITY_CATEGORIES[k].why,
      })),
      in_effect: activityCategories(saved?.categories ?? {}, values),
      // The editor needs the clan's own key (Settings, the clan's own
      // model); without one the page asks a leader to add it. `name` is
      // the model Elixir Clan runs the editor on with this key, null
      // when the key reaches none of them.
      model: key
        ? {
            available: true,
            set: key.set,
            refused: key.refused,
            name: key.model_for?.discord_activity?.name ?? null,
          }
        : { available: false, set: false, refused: false, name: null },
      voice_max: VOICE_MAX,
      editor_runs_per_day: ACTIVITY_USES_PER_DAY,
    };
  }

  return {
    async status(clanTag, who) {
      requireLeader(who);
      return view(clanTag);
    },

    /** A leader's thumbs up or down on one post of the channel, with an
     *  optional note: feedback about that post, to Elixir. */
    async rate(clanTag, who, body = {}) {
      requireLeader(who);
      return rateWith(ratings, "clan_activity", clanTag, body);
    },

    /**
     * Connect or replace the webhook, switch posting on or off, switch a
     * category (true, false, or null for the policy's default), the
     * editor (`rewrite`) and the voice. Only what the body names changes.
     */
    async save(clanTag, who, body = {}, { clanName = null } = {}) {
      requireLeader(who);
      const change = {};
      if (body.url !== undefined) {
        if (typeof body.url !== "string")
          throw new ManageError(400, "bad_request");
        change.url = body.url.trim();
      }
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== "boolean")
          throw new ManageError(400, "bad_request");
        change.enabled = body.enabled;
      }
      if (body.categories !== undefined) {
        if (typeof body.categories !== "object" || body.categories === null)
          throw new ManageError(400, "bad_request");
        const { ruled_out: ruledOut } = activityPolicy(
          (await ledger.currentPolicy(clanTag))?.values ?? null,
        );
        change.categories = {};
        for (const [k, v] of Object.entries(body.categories)) {
          if (
            !ACTIVITY_CATEGORY_KEYS.includes(k) ||
            !(v === null || typeof v === "boolean")
          )
            throw new ManageError(400, "bad_request");
          if (v === true && ruledOut[k])
            throw new ManageError(409, "ruled_out", null, {
              message: ruledOut[k],
            });
          change.categories[k] = v;
        }
      }
      if (body.rewrite !== undefined) {
        if (typeof body.rewrite !== "boolean")
          throw new ManageError(400, "bad_request");
        if (body.rewrite) {
          const key = model ? await model.summary(clanTag) : null;
          if (!key?.set)
            throw new ManageError(409, "no_model_key", null, {
              message:
                "Add the clan's Anthropic API key under The clan's own model first.",
            });
          if (key.refused)
            throw new ManageError(409, "model_key_refused", null, {
              message:
                "Anthropic stopped accepting the clan's key. Add it again under The clan's own model.",
            });
        }
        change.rewrite = body.rewrite;
      }
      if (body.voice !== undefined) {
        if (body.voice !== null && typeof body.voice !== "string")
          throw new ManageError(400, "bad_request");
        change.voice = cleanVoice(body.voice);
      }
      const r = await store.save(clanTag, change, { who, clanName });
      if (r.error) throw refusals[r.error] ?? new ManageError(400, r.error);
      return view(clanTag, r.view);
    },

    /**
     * The last few stories as the clan's editor would tell them in
     * `voice` (the saved voice when absent): a leader's own use, counted
     * with the leaders' drafts, in one request with no lookups, that
     * posts and records nothing in Discord. Each story comes back with
     * Elixir's version and what the editor did with it: its post (and
     * the stories told in it), the post it is told in, its skip and
     * reason, or Elixir's version kept (and why, when a post or skip was
     * refused). A preview that outlasts the request is `{ pending }`;
     * asking again with it collects it.
     */
    async preview(clanTag, who, token, { voice, pending = null } = {}) {
      requireLeader(who);
      if (!model || !store.preview) throw new ManageError(404, "not_found");
      if (voice !== undefined && voice !== null && typeof voice !== "string")
        throw new ManageError(400, "bad_request");
      if (pending != null && typeof pending !== "string")
        throw new ManageError(400, "bad_request");
      const built = await store.preview(clanTag, {
        voice: voice === undefined ? undefined : cleanVoice(voice),
      });
      if (built.empty) return { empty: true, reason: built.reason, posts: [] };
      const answer = pending
        ? await model.collect(clanTag, who, pending)
        : await model.write(clanTag, who, token, built.request, {
            defer: true,
          });
      if (answer.pending) return { pending: answer.pending };
      const edited = editorAnswer(
        answer.input,
        built.stories,
        built.request.context,
      );
      return {
        empty: false,
        model: answer.model,
        posts: built.posts.map((p) => {
          const post = edited.posts.find((x) => x.keys.includes(p.key));
          const skip = edited.skips.find((x) => x.key === p.key);
          const lead = post?.key === p.key;
          return {
            key: p.key,
            kind: p.kind,
            at: p.at,
            elixir: p.elixir,
            post: lead ? post.text : null,
            with: lead ? post.keys.slice(1) : [],
            told_in: post && !lead ? post.key : null,
            skipped: skip?.reason ?? null,
            refused:
              post || skip
                ? null
                : (edited.rejected.find((r) => r.keys.includes(p.key))?.why ??
                  null),
          };
        }),
      };
    },

    /** Disconnect: nothing more is posted; messages already there stay. */
    async remove(clanTag, who) {
      requireLeader(who);
      await store.remove(clanTag);
      return view(clanTag, null);
    },
  };
}
