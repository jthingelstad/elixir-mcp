/**
 * The clan's own model (2026-09-25): bring your own tokens. Elixir Clan
 * funds no model use (VISION, principle 8); a leader or co-leader adds
 * the clan's Anthropic API key, and the clan's model may then write words
 * for the uses the engine names (`PURPOSES` in `words.mjs`), never a
 * judgment about a member.
 *
 * The key:
 *  - is checked with Anthropic before it is kept (the model list: it
 *    spends nothing); an Admin key is refused;
 *  - is kept sealed (AES-256-GCM, a key derived from the app's secret for
 *    this use only, bound to the clan and the person who added it) in its
 *    own item, outside the clan's index, and is never shown again: people
 *    see its last four characters, who added it and when;
 *  - is used only while the person who added it is a leader or co-leader
 *    of the clan: it is their account that pays;
 *  - is used only by leaders and co-leaders, at most `USES_PER_DAY` times a
 *    day per clan, and every use is recorded (who, what for, the model,
 *    the tokens), kept `USE_KEEP_DAYS` days for the leaders to read.
 *
 * Rotating the app's session secret makes every kept key unreadable; the
 * page then asks for it again.
 *
 * The key's model list (what the picker offers) refreshes itself (Jamie,
 * 2026-10-08: "yes Clan should refresh that list automatically"): when a
 * leader opens Settings and the list is a day old, the page asks for a
 * refresh after it has drawn, and a draft that finds its model gone makes
 * the list due at once. It is the same read as adding a key (the model
 * list spends nothing), at most once a day per clan otherwise. A refresh
 * replaces only the list: the clan's saved model never changes, even when
 * the key no longer lists it. A failed refresh keeps the old list.
 *
 * Spend (Jamie, 2026-10-10): each use's tokens are priced at Anthropic's
 * list rates (`prices.mjs`), so leaders see about what the month's uses
 * cost. A leader or co-leader may set a monthly cap in dollars: once the
 * month's (UTC) estimated spend reaches it, the clan's model drafts
 * nothing more until the month turns or the cap is raised or removed. A
 * draft that starts under the cap may finish a little over it. The cap is
 * Elixir Clan's own stop, never Anthropic's spend limit; it stays with
 * the clan when the key is replaced.
 */

import { createBox } from "../sealed.mjs";
import { PURPOSES, chooseModel } from "@elixir-mcp/clan-engine";
import { ManageError } from "./service.mjs";
import { PRICES_AS_OF, roundUsd, costOfUse } from "./prices.mjs";

export const USES_PER_DAY = 20;
/** The clan's Discord activity rewrites (`writeUnattended`): a day's
 *  cap of their own, apart from the leaders' drafts. Past it, the posts
 *  keep Elixir's own lines until the day turns (UTC). */
export const ACTIVITY_USES_PER_DAY = 50;
const ACTIVITY = "discord_activity";
/** How often a key's model list may be read again, success or not. */
export const MODELS_REFRESH_MS = 24 * 3600_000;
const USE_KEEP_DAYS = 90;
const LEADERS = new Set(["leader", "coLeader"]);
const KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;
/** The largest monthly cap a leader may set, in dollars. */
export const MAX_SPEND_CAP_USD = 1000;

/**
 * The same sealed key? Compared by its sealed bytes: two reads of the
 * stored item are never the same object (Postgres parses each one), so
 * identity said "changed" every time and no refresh ever ran.
 */
const sameSealed = (a, b) =>
  Boolean(a && b) && a.iv === b.iv && a.tag === b.tag && a.ct === b.ct;

/** About what a list of uses cost: `{ usd, estimated }`. */
function spendOf(calls) {
  let usd = 0;
  let estimated = false;
  for (const c of calls) {
    const cost = costOfUse(c.model, c.input_tokens, c.output_tokens);
    if (!cost) continue;
    usd += cost.usd;
    estimated ||= cost.estimated;
  }
  return { usd: roundUsd(usd), estimated };
}

/** Seal and open a clan's key under a key derived from the app secret. */
export function sealer(secret) {
  return createBox(secret, "clan model key v1");
}

const boundTo = (clanTag, playerTag) => `${clanTag}|${playerTag}`;

/** Anthropic's refusal of a key, in a leader's words. */
function refusedKey(r) {
  if (r.status === 401)
    return new ManageError(400, "key_refused", null, {
      message: "Anthropic did not accept this key.",
    });
  if (r.status === 403)
    return new ManageError(400, "key_refused", null, {
      message: "This key is not allowed to use Anthropic's API.",
    });
  if (r.status === 429)
    return new ManageError(429, "anthropic_busy", null, {
      message: "Anthropic asked us to slow down. Try again in a minute.",
    });
  return new ManageError(502, "anthropic_unavailable", null, {
    message: "Anthropic did not answer. Try again in a minute.",
  });
}

/**
 * The Claude models a key can reach: the one read both adding a key and
 * refreshing its list make. `{ ok: true, models }`, or Anthropic's refusal.
 */
async function keyModels(anthropic, key) {
  const r = await anthropic.models(key);
  if (!r.ok) return r;
  return {
    ok: true,
    status: r.status,
    models: r.models.filter((m) => /^claude-/.test(m.id)),
  };
}

export function createModelService({
  ledger,
  anthropic,
  secret,
  /** (token, clanTag) → the clans_roster answer, or null */
  rosterFor,
  now = () => Date.now(),
}) {
  if (!secret) throw new Error("the model service needs the app secret");
  const box = sealer(secret);
  const isLeader = (who) => LEADERS.has(who.role);
  const requireLeader = (who) => {
    if (!isLeader(who)) throw new ManageError(403, "leaders_only");
  };
  const iso = () => new Date(now()).toISOString();
  /** A list never checked (a key added before 2026-10-08) is due. */
  const refreshDue = (stored) =>
    !stored.models_checked_at ||
    now() - Date.parse(stored.models_checked_at) >= MODELS_REFRESH_MS;

  /**
   * Merge `fields` into the clan's key item as it is NOW, and only while
   * it is still the same key: a refresh never writes over a model a
   * leader chose, or a key replaced or removed, in the meantime.
   */
  async function updateKeyItem(clanTag, sealed, fields) {
    const current = await ledger.modelKey(clanTag);
    if (!current || !sameSealed(current.sealed, sealed)) return null;
    const next = { ...current, ...fields };
    await ledger.saveModelKey(clanTag, next);
    return next;
  }

  /**
   * May the clan's model be used now, under the clan's monthly cap? Every
   * use recorded with `ledger.addModelCall` (its model and tokens) counts
   * toward the month, whoever or whatever asked for it.
   */
  async function spendNow(clanTag, stored = null) {
    const item = stored ?? (await ledger.modelKey(clanTag));
    const cap = item?.spend_cap_usd ?? null;
    const month = iso().slice(0, 7);
    const spent = spendOf(await ledger.modelCalls(clanTag, month));
    return {
      allowed: cap === null || spent.usd < cap,
      cap_usd: cap,
      spend_usd: spent.usd,
      month,
    };
  }

  /** Is the person who added the key still a leader here? null: unknown. */
  async function ownerLeads(clanTag, stored, token) {
    const roster = token ? await rosterFor(token, clanTag) : null;
    if (!roster) return null;
    const m = (roster.members ?? []).find(
      (x) => x.player_tag === stored.set_by,
    );
    return Boolean(m && LEADERS.has(m.role));
  }

  return {
    spendNow,

    /** Cheap, for pages that offer a use: is there a key, and is it good? */
    async summary(clanTag) {
      const stored = await ledger.modelKey(clanTag);
      return {
        set: Boolean(stored),
        refused: Boolean(stored?.refused_at),
        model: stored?.model ?? null,
      };
    },

    /** What leaders see about the key: never the key. */
    async status(clanTag, who, token) {
      requireLeader(who);
      const stored = await ledger.modelKey(clanTag);
      const t = now();
      const today = new Date(t).toISOString().slice(0, 10);
      const month = today.slice(0, 7);
      const calls = await ledger.modelCalls(clanTag, month);
      const spend = spendOf(calls);
      const cap = stored?.spend_cap_usd ?? null;
      const base = {
        clan_tag: clanTag,
        purposes: PURPOSES,
        per_day: USES_PER_DAY,
        keep_days: USE_KEEP_DAYS,
        max_spend_cap_usd: MAX_SPEND_CAP_USD,
        prices_as_of: PRICES_AS_OF,
        activity_per_day: ACTIVITY_USES_PER_DAY,
        uses: {
          // The leaders' drafts against their daily limit; the activity
          // channel's rewrites have their own.
          today: calls.filter(
            (c) => c.at.startsWith(today) && c.purpose !== ACTIVITY,
          ).length,
          activity_today: calls.filter(
            (c) => c.at.startsWith(today) && c.purpose === ACTIVITY,
          ).length,
          month: {
            count: calls.length,
            input_tokens: calls.reduce((s, c) => s + (c.input_tokens ?? 0), 0),
            output_tokens: calls.reduce(
              (s, c) => s + (c.output_tokens ?? 0),
              0,
            ),
            spend_usd: spend.usd,
            spend_estimated: spend.estimated,
          },
          recent: calls
            .slice(-10)
            .reverse()
            .map((c) => {
              const cost = costOfUse(c.model, c.input_tokens, c.output_tokens);
              return {
                at: c.at,
                by: c.by,
                by_name: c.by_name ?? null,
                purpose: c.purpose,
                model: c.model,
                ok: c.ok,
                code: c.code ?? null,
                input_tokens: c.input_tokens ?? null,
                output_tokens: c.output_tokens ?? null,
                spend_usd: cost ? roundUsd(cost.usd) : null,
              };
            }),
        },
        spend_cap_usd: cap,
        spend_cap_set_by_name: stored?.spend_cap_set_by_name ?? null,
        spend_cap_set_at: stored?.spend_cap_set_at ?? null,
        cap_reached: cap !== null && spend.usd >= cap,
      };
      if (!stored) return { ...base, set: false };
      const readable =
        box.open(stored.sealed, boundTo(clanTag, stored.set_by)) !== null;
      const leads = await ownerLeads(clanTag, stored, token);
      return {
        ...base,
        set: true,
        hint: stored.hint,
        set_by: stored.set_by,
        set_by_name: stored.set_by_name ?? null,
        set_at: stored.set_at,
        model: stored.model,
        models: stored.models ?? [],
        // Is the saved model still one the key lists? It stays chosen
        // either way; the picker says so.
        model_listed: (stored.models ?? []).some((m) => m.id === stored.model),
        models_refreshed_at: stored.models_refreshed_at ?? null,
        models_refresh_error: stored.models_refresh_error ?? null,
        refresh_due:
          readable &&
          !stored.refused_at &&
          leads === true &&
          refreshDue(stored),
        refused_at: stored.refused_at ?? null,
        readable,
        owner_leads: leads,
        usable: readable && !stored.refused_at && leads === true,
      };
    },

    /** Add (or replace) the clan's key: checked with Anthropic first. */
    async setKey(clanTag, who, { key, model = null } = {}) {
      requireLeader(who);
      const k = String(key ?? "").trim();
      if (/^sk-ant-admin/.test(k))
        throw new ManageError(400, "admin_key", null, {
          message:
            "That is an Admin key. Add an API key from the Anthropic Console instead.",
        });
      if (!KEY_SHAPE.test(k))
        throw new ManageError(400, "not_a_key", null, {
          message: "An Anthropic API key starts with sk-ant-.",
        });
      const r = await keyModels(anthropic, k);
      if (!r.ok) throw refusedKey(r);
      const { models } = r;
      const chosen =
        model && models.some((m) => m.id === model)
          ? model
          : chooseModel(models.map((m) => m.id));
      if (!chosen)
        throw new ManageError(400, "no_models", null, {
          message: "This key cannot reach any Claude model.",
        });
      // The clan's cap outlives the key it was set beside.
      const previous = await ledger.modelKey(clanTag);
      await ledger.saveModelKey(clanTag, {
        spend_cap_usd: previous?.spend_cap_usd ?? null,
        spend_cap_set_by: previous?.spend_cap_set_by ?? null,
        spend_cap_set_by_name: previous?.spend_cap_set_by_name ?? null,
        spend_cap_set_at: previous?.spend_cap_set_at ?? null,
        sealed: box.seal(k, boundTo(clanTag, who.player_tag)),
        hint: `sk-ant-…${k.slice(-4)}`,
        set_by: who.player_tag,
        set_by_name: who.name ?? null,
        set_at: iso(),
        model: chosen,
        models,
        models_checked_at: iso(),
        models_refreshed_at: iso(),
        models_refresh_error: null,
        refused_at: null,
      });
      return { ok: true, model: chosen };
    },

    /**
     * Choose which of the key's models writes: any on the key's list as it
     * was last read (when the key was added, or its latest refresh). A
     * clan's saved choice is never changed for it.
     */
    async setModel(clanTag, who, model) {
      requireLeader(who);
      const stored = await ledger.modelKey(clanTag);
      if (!stored) throw new ManageError(409, "no_model_key");
      if (!(stored.models ?? []).some((m) => m.id === model))
        throw new ManageError(400, "unknown_model", null, {
          message: "That model is not one this key can reach.",
        });
      await ledger.saveModelKey(clanTag, { ...stored, model });
      return { ok: true, model };
    },

    /**
     * Read the key's model list again, when it is due. The picker asks
     * for this after it has drawn, so a slow or failed read never holds
     * it up, and nothing on the drafting path waits for it. Bounded: the
     * attempt is recorded before the read, so another refresh waits
     * `MODELS_REFRESH_MS` whatever the outcome. Only the list and its
     * dates change. A 401 or 403 marks the key refused, as a draft does;
     * any other failure (429, an error, no answer, no Claude model)
     * keeps the old list and records the failure.
     */
    async refreshModels(clanTag, who, token) {
      requireLeader(who);
      const stored = await ledger.modelKey(clanTag);
      if (!stored) throw new ManageError(409, "no_model_key");
      const skip = (reason) => ({
        refreshed: false,
        reason,
        models: stored.models ?? [],
      });
      if (stored.refused_at) return skip("key_refused");
      if (!refreshDue(stored)) return skip("not_due");
      const key = box.open(stored.sealed, boundTo(clanTag, stored.set_by));
      if (!key) return skip("key_unreadable");
      // The key is used only while the person who added it leads here.
      if ((await ownerLeads(clanTag, stored, token)) !== true)
        return skip("owner_unconfirmed");
      const at = iso();
      if (
        !(await updateKeyItem(clanTag, stored.sealed, {
          models_checked_at: at,
        }))
      )
        return skip("key_changed");
      let r;
      try {
        r = await keyModels(anthropic, key);
      } catch {
        r = { ok: false, status: 0, code: "outcome_unknown" };
      }
      const failed = (code, extra = {}) =>
        updateKeyItem(clanTag, stored.sealed, {
          models_refresh_error: { at, code, status: r.status ?? null },
          ...extra,
        });
      if (!r.ok) {
        const refused = r.status === 401 || r.status === 403;
        await failed(r.code ?? "error", refused ? { refused_at: at } : {});
        return {
          ...skip(refused ? "key_refused" : "failed"),
          code: r.code ?? null,
        };
      }
      if (!r.models.length) {
        await failed("no_models");
        return { ...skip("failed"), code: "no_models" };
      }
      const next = await updateKeyItem(clanTag, stored.sealed, {
        models: r.models,
        models_refreshed_at: at,
        models_refresh_error: null,
      });
      if (!next) return skip("key_changed");
      return { refreshed: true, reason: null, models: next.models };
    },

    /**
     * Set the clan's monthly spend cap in dollars, or remove it (null).
     * Drafting stops once the month's estimated spend reaches it.
     */
    async setSpendCap(clanTag, who, cap) {
      requireLeader(who);
      const stored = await ledger.modelKey(clanTag);
      if (!stored) throw new ManageError(409, "no_model_key");
      let usd = null;
      if (cap !== null) {
        usd = typeof cap === "number" ? cap : Number(String(cap).trim());
        if (
          !Number.isFinite(usd) ||
          usd < 0.01 ||
          usd > MAX_SPEND_CAP_USD ||
          Math.abs(Math.round(usd * 100) - usd * 100) > 1e-6
        )
          throw new ManageError(400, "bad_spend_cap", null, {
            message: `A cap is a dollar amount from $0.01 to $${MAX_SPEND_CAP_USD}, to the cent.`,
          });
      }
      const next = await updateKeyItem(clanTag, stored.sealed, {
        spend_cap_usd: usd,
        spend_cap_set_by: usd === null ? null : who.player_tag,
        spend_cap_set_by_name: usd === null ? null : (who.name ?? null),
        spend_cap_set_at: usd === null ? null : iso(),
      });
      if (!next) throw new ManageError(409, "model_key_changed");
      return { ok: true, spend_cap_usd: usd };
    },

    /** Remove the clan's key. Its uses stay on record. */
    async removeKey(clanTag, who) {
      requireLeader(who);
      await ledger.removeModelKey(clanTag);
    },

    /**
     * Words from the clan's model for one purpose: the engine's request
     * (`words.mjs`) on the clan's key. Returns the tool's input; the
     * caller checks it and a person edits it.
     */
    async write(clanTag, who, token, request) {
      requireLeader(who);
      if (!PURPOSES[request?.purpose])
        throw new ManageError(400, "unknown_purpose");
      const stored = await ledger.modelKey(clanTag);
      if (!stored) throw new ManageError(409, "no_model_key");
      if (stored.refused_at) throw new ManageError(409, "model_key_refused");
      const key = box.open(stored.sealed, boundTo(clanTag, stored.set_by));
      if (!key) throw new ManageError(409, "model_key_unreadable");
      const leads = await ownerLeads(clanTag, stored, token);
      if (leads === false)
        throw new ManageError(409, "model_key_owner_left", null, {
          set_by_name: stored.set_by_name ?? stored.set_by,
        });
      if (leads !== true)
        throw new ManageError(503, "model_owner_unconfirmed", null, {
          message:
            "The recorded roster could not confirm who added this key. Try again shortly.",
        });
      const today = iso().slice(0, 10);
      // The Discord activity rewrites have a cap of their own.
      const drafts = (await ledger.modelCalls(clanTag, today)).filter(
        (c) => c.purpose !== ACTIVITY,
      );
      if (drafts.length >= USES_PER_DAY)
        throw new ManageError(429, "model_daily_limit", null, {
          per_day: USES_PER_DAY,
        });
      const budget = await spendNow(clanTag, stored);
      if (!budget.allowed)
        throw new ManageError(429, "model_spend_cap", null, {
          spend_cap_usd: budget.cap_usd,
          spend_usd: budget.spend_usd,
        });
      // Reserve before dispatch. A killed request, lost transport reply or
      // failed final ledger update still consumes and shows this attempt.
      const call = await ledger.addModelCall(clanTag, {
        at: iso(),
        by: who.player_tag,
        by_name: who.name ?? null,
        purpose: request.purpose,
        model: stored.model,
        ok: false,
        status: null,
        code: "outcome_pending",
        input_tokens: null,
        output_tokens: null,
        ttl: Math.floor(now() / 1000) + USE_KEEP_DAYS * 86400,
      });
      let r;
      try {
        r = await anthropic.write(key, {
          model: stored.model,
          system: request.system,
          prompt: request.prompt,
          tool: request.tool,
          max_tokens: request.max_tokens,
        });
      } catch {
        r = { ok: false, status: 0, code: "outcome_unknown" };
      }
      await ledger.finishModelCall(clanTag, call, {
        model: r.model ?? stored.model,
        ok: r.ok,
        status: r.status ?? null,
        code: r.ok ? null : (r.code ?? null),
        input_tokens: r.usage?.input_tokens ?? null,
        output_tokens: r.usage?.output_tokens ?? null,
      });
      if (r.ok)
        return { input: r.input, model: r.model, usage: r.usage ?? null };
      if (r.status === 401 || r.status === 403) {
        await ledger.saveModelKey(clanTag, { ...stored, refused_at: iso() });
        throw new ManageError(409, "model_key_refused");
      }
      if (r.status === 404) {
        // The saved model is gone for this key: the list is due now, so
        // the picker is current when a leader comes to choose another.
        // Best effort: the leader's answer is the 409 either way.
        await updateKeyItem(clanTag, stored.sealed, {
          models_checked_at: null,
        }).catch(() => null);
        throw new ManageError(409, "model_unavailable", null, {
          model: stored.model,
        });
      }
      if (r.status === 429 || r.status === 529)
        throw new ManageError(429, "anthropic_busy", null, {
          message: "Anthropic is busy. Try again in a minute.",
        });
      // An answer that is no draft (`anthropic.mjs`): the model declined,
      // or stopped before it finished. Never parsed into empty words.
      if (r.code === "refusal")
        throw new ManageError(422, "model_refused", null, {
          message:
            r.message ??
            "The model declined to write this draft. Your words are unchanged.",
        });
      if (r.code === "max_tokens")
        throw new ManageError(502, "model_cut_off", null, {
          message:
            r.message ??
            "The model stopped before it finished the draft. Your words are unchanged.",
        });
      throw new ManageError(502, "model_failed", null, {
        message:
          r.code === "outcome_unknown"
            ? "The draft's outcome is unknown and this attempt is counted. Check the use log in Settings before requesting another draft."
            : (r.message ?? "The model did not answer."),
      });
    },

    /**
     * Words from the clan's model that no person asks for and no person
     * reads before they are sent: the clan's activity rewritten for its
     * Discord channel (Jamie, 2026-10-10; `activityRewriteRequest`), the
     * one such purpose. The same key, owner, record and monthly cap as a
     * leader's draft, under its own day's cap. Never throws for the clan's state:
     * `{ ok: false, code }` and the caller posts Elixir's own lines.
     * `ownerLeads(playerTag)` says whether the key's owner leads the clan
     * now (true, false, or null when unknown).
     */
    async writeUnattended(clanTag, request, { ownerLeads: leadsNow }) {
      if (request?.purpose !== ACTIVITY)
        throw new ManageError(400, "unknown_purpose");
      const stored = await ledger.modelKey(clanTag);
      if (!stored) return { ok: false, code: "no_model_key" };
      if (stored.refused_at) return { ok: false, code: "model_key_refused" };
      const key = box.open(stored.sealed, boundTo(clanTag, stored.set_by));
      if (!key) return { ok: false, code: "model_key_unreadable" };
      const leads = await leadsNow(stored.set_by);
      if (leads === false) return { ok: false, code: "model_key_owner_left" };
      if (leads !== true) return { ok: false, code: "model_owner_unconfirmed" };
      const today = iso().slice(0, 10);
      const used = (await ledger.modelCalls(clanTag, today)).filter(
        (c) => c.purpose === ACTIVITY,
      ).length;
      if (used >= ACTIVITY_USES_PER_DAY)
        return { ok: false, code: "model_daily_limit" };
      // The leaders' monthly cap stops the rewrites too: every use counts.
      if (!(await spendNow(clanTag, stored)).allowed)
        return { ok: false, code: "model_spend_cap" };
      const call = await ledger.addModelCall(clanTag, {
        at: iso(),
        by: null,
        by_name: "Discord activity",
        purpose: ACTIVITY,
        model: stored.model,
        ok: false,
        status: null,
        code: "outcome_pending",
        input_tokens: null,
        output_tokens: null,
        ttl: Math.floor(now() / 1000) + USE_KEEP_DAYS * 86400,
      });
      let r;
      try {
        r = await anthropic.write(key, {
          model: stored.model,
          system: request.system,
          prompt: request.prompt,
          tool: request.tool,
          max_tokens: request.max_tokens,
        });
      } catch {
        r = { ok: false, status: 0, code: "outcome_unknown" };
      }
      await ledger.finishModelCall(clanTag, call, {
        model: r.model ?? stored.model,
        ok: r.ok,
        status: r.status ?? null,
        code: r.ok ? null : (r.code ?? null),
        input_tokens: r.usage?.input_tokens ?? null,
        output_tokens: r.usage?.output_tokens ?? null,
      });
      if (r.ok) return { ok: true, input: r.input, model: r.model };
      if (r.status === 401 || r.status === 403) {
        await ledger.saveModelKey(clanTag, { ...stored, refused_at: iso() });
        return { ok: false, code: "model_key_refused" };
      }
      if (r.status === 404) {
        await updateKeyItem(clanTag, stored.sealed, {
          models_checked_at: null,
        }).catch(() => null);
        return { ok: false, code: "model_unavailable" };
      }
      return { ok: false, code: r.code ?? "model_failed" };
    },
  };
}
