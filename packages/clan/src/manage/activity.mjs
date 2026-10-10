/**
 * The clan's activity in its Discord (Jamie, 2026-10-10): Social's
 * Discord item. A leader or co-leader connects a webhook of the clan's
 * own (not the Actions one), chooses which of the clan's timeline is
 * posted there, and may have the clan's own model rewrite the posts in a
 * voice the leaders describe. The rules of what is posted are the
 * engine's (`activity.mjs`); the connection is kept and synced in
 * packages/syndication, handed in here as `store`, so this service never
 * holds the webhook or its sealed form.
 *
 * `store`:
 *  - read(clanTag) → the connection as leaders see it, or null;
 *  - save(clanTag, change, { who, clanName }) → { view } | { error };
 *  - remove(clanTag) → whether there was one.
 */

import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_KEYS,
  VOICE_MAX,
  activityCategories,
  activityPolicy,
  cleanVoice,
} from "@elixir-mcp/clan-engine";
import { ManageError } from "./service.mjs";
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
};

export function createActivityService({ ledger, store, model = null }) {
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
      policy: activityPolicy(values),
      categories: ACTIVITY_CATEGORY_KEYS.map((k) => ({
        key: k,
        label: ACTIVITY_CATEGORIES[k].label,
        why: ACTIVITY_CATEGORIES[k].why,
      })),
      in_effect: activityCategories(saved?.categories ?? {}, values),
      // The rewrite needs the clan's own key (Settings, the clan's own
      // model); without one the page asks a leader to add it.
      model: key
        ? { available: true, set: key.set, refused: key.refused }
        : { available: false, set: false, refused: false },
      voice_max: VOICE_MAX,
      rewrites_per_day: ACTIVITY_USES_PER_DAY,
    };
  }

  return {
    async status(clanTag, who) {
      requireLeader(who);
      return view(clanTag);
    },

    /**
     * Connect or replace the webhook, switch posting on or off, switch a
     * category (true, false, or null for the policy's default), the
     * rewrite and the voice. Only what the body names changes.
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

    /** Disconnect: nothing more is posted; messages already there stay. */
    async remove(clanTag, who) {
      requireLeader(who);
      await store.remove(clanTag);
      return view(clanTag, null);
    },
  };
}
