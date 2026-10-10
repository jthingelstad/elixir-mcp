import { ago } from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
import { manageApi } from "../api.js";
import { useModel } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";
import { CLAN } from "../lib/base.js";

const day = (ts) => (ts ? ts.slice(0, 10) : "");
const n = (x) => (x === null || x === undefined ? "—" : x.toLocaleString());
/** Dollars a leader can read: cents, or the first figures of a fraction. */
function usd(x) {
  if (x === null || x === undefined) return "—";
  if (x === 0) return "$0.00";
  if (x < 0.01) return `$${Number(x.toPrecision(2))}`;
  return `$${x.toFixed(2)}`;
}

/**
 * The clan's own model (2026-09-25): bring your own tokens. A leader or
 * co-leader adds the clan's Anthropic API key; the clan's model then
 * drafts recruiting and action messages for a leader to edit, never a
 * judgment about a member. The key is checked with Anthropic, kept
 * sealed and never shown again; it is used only while the person who
 * added it leads the clan, and every use is listed here.
 *
 * The key's model list refreshes itself: when the server says it is due
 * (`refresh_due`, about once a day), the page asks for a refresh after it
 * has drawn and reloads if the list changed. The page never waits on it,
 * and the clan's chosen model never changes by itself: a model the key no
 * longer lists stays chosen, marked as not offered.
 *
 * Spend (2026-10-10): the server prices each use's tokens at Anthropic's
 * list rates, so the month reads as about what it cost; a leader may set
 * a monthly cap, and drafting stops once the estimate reaches it.
 */
export function Model({ clan }) {
  const { state, load } = useModel(clan.clan_tag);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cap, setCap] = useState(null);
  const [capMessage, setCapMessage] = useState("");
  const refreshAsked = useRef(false);
  const due = Boolean(state.data?.refresh_due);
  useEffect(() => {
    if (!due || refreshAsked.current) return;
    refreshAsked.current = true;
    manageApi
      .refreshModels(clan.clan_tag)
      .then((r) => {
        if (r.ok && (r.data?.refreshed || r.data?.reason === "key_refused"))
          load();
      })
      .catch(() => {
        // A failed refresh leaves the list the page already shows.
      });
  }, [due, clan.clan_tag, load]);

  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  if (state.forbidden)
    return (
      <div className="callout callout--warn" role="alert">
        <span>The clan&rsquo;s model is for the leader and co-leaders.</span>
      </div>
    );
  if (state.error)
    return (
      <div className="callout callout--warn" role="alert">
        <span>Elixir Clan did not answer. Try again in a minute.</span>
      </div>
    );
  const d = state.data;
  if (!d) return <p className="page__lede">Reading…</p>;
  const listed = (d.models ?? []).some((m) => m.id === d.model);

  const saveKey = async (e) => {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setMessage("");
    const r = await manageApi.setModelKey(clan.clan_tag, key.trim());
    setBusy(false);
    // The key leaves the page either way: it is never kept in the browser.
    setKey("");
    if (!r.ok) {
      setMessage(
        r.data?.message ?? "Anthropic did not answer. Try again in a minute.",
      );
      return;
    }
    trackEvent("clan.model_key_set");
    load();
  };
  const choose = async (model) => {
    setBusy(true);
    const r = await manageApi.chooseModel(clan.clan_tag, model);
    setBusy(false);
    if (!r.ok) setMessage(r.data?.message ?? "That did not save.");
    load();
  };
  const saveCap = async (e, value) => {
    e?.preventDefault();
    setBusy(true);
    setCapMessage("");
    const r = await manageApi.setSpendCap(clan.clan_tag, value);
    setBusy(false);
    if (!r.ok) {
      setCapMessage(r.data?.message ?? "That did not save.");
      return;
    }
    setCap(null);
    trackEvent(
      value === null ? "clan.model_cap_removed" : "clan.model_cap_set",
    );
    load();
  };
  const savedCap = d.spend_cap_usd == null ? "" : String(d.spend_cap_usd);
  const capValue = cap ?? savedCap;
  const month = d.uses.month;
  const remove = async () => {
    if (!window.confirm("Remove the clan's key? Nothing will use it again."))
      return;
    setBusy(true);
    await manageApi.removeModelKey(clan.clan_tag);
    setBusy(false);
    trackEvent("clan.model_key_removed");
    load();
  };

  return (
    <div className="grid max-w-[720px] gap-4">
      <p className="page__lede m-0">
        Elixir Clan pays for no model. With your clan&rsquo;s own Anthropic key,
        a model drafts the recruiting pitch in Recruit and messages on Actions:
        welcomes, promotions, demotions, awards, policy announcements and a chat
        line after a removal decision. It never decides what should happen to a
        member. It is told the game&rsquo;s numbers for the clan, what the clan
        is for, how it runs and its own words. Member names, tags and private
        notes stay local. Welcome drafts can use the Action&rsquo;s frozen
        return or recorded career detail. Departure drafts use a leader&rsquo;s
        confirmed Kicked or Left classification and recorded tenure when known,
        without private reasons. Keep member details out of a Leader Message
        note; chat drafts use fixed tone choices. Everything it writes is a
        draft you review and edit, then save or copy into the game. Nothing is
        posted automatically. Drafts use the clan’s saved recruiting words as
        its voice; add those in Recruit and choose the tone on the action.
      </p>

      {d.set ? (
        <section className="panel">
          <div className="panel__head flex-wrap gap-2">
            <span>The clan&rsquo;s key</span>
            <span
              className={`chip ${d.usable ? "chip--ok" : "chip--warn"}`}
              role="status"
            >
              {d.usable ? "in use" : "not in use"}
            </span>
          </div>
          <div className="panel__body fields">
            <span className="label">Key</span>
            <span>
              <code>{d.hint}</code>
            </span>
            <span className="label">Added by</span>
            <span>
              {d.set_by_name ?? d.set_by} · {day(d.set_at)}
            </span>
            <span className="label">Model</span>
            <span>
              <select
                className="input"
                aria-label="Model"
                value={d.model}
                disabled={busy}
                onChange={(e) => choose(e.target.value)}
              >
                {d.model && !listed ? (
                  <option value={d.model} disabled>
                    {d.model} (not offered by this key now)
                  </option>
                ) : null}
                {d.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </span>
            <span className="label">Model list</span>
            <span>
              {d.models_refreshed_at
                ? `From Anthropic, ${day(d.models_refreshed_at)}`
                : "From Anthropic, when the key was added"}
              {d.models_refresh_error
                ? ` · the check on ${day(d.models_refresh_error.at)} failed; it is tried again a day later`
                : ""}
            </span>
            <span className="label">Today</span>
            <span>
              {d.uses.today} of {d.per_day} uses
            </span>
            <span className="label">This month</span>
            <span>
              {month.count} uses · {n(month.input_tokens)} tokens in,{" "}
              {n(month.output_tokens)} out · about {usd(month.spend_usd)}
              {d.spend_cap_usd != null
                ? ` of the ${usd(d.spend_cap_usd)} cap`
                : ""}
            </span>
            <label className="label" htmlFor="model-cap">
              Monthly cap
            </label>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => saveCap(e, capValue.trim())}
            >
              <span aria-hidden="true">$</span>
              <input
                id="model-cap"
                className="input w-28"
                type="number"
                inputMode="decimal"
                min="0.01"
                max={d.max_spend_cap_usd}
                step="0.01"
                placeholder="No cap"
                value={capValue}
                disabled={busy}
                onChange={(e) => setCap(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn--sm"
                disabled={busy || !capValue.trim() || capValue === savedCap}
              >
                Save cap
              </button>
              {d.spend_cap_usd != null ? (
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={busy}
                  onClick={(e) => saveCap(e, null)}
                >
                  Remove cap
                </button>
              ) : null}
            </form>
          </div>
          {capMessage ? (
            <p className="field-error mx-3 my-0" role="alert">
              {capMessage}
            </p>
          ) : null}
          <p className="page-head__note mx-3 my-0">
            Spend is an estimate: each use&rsquo;s tokens at Anthropic&rsquo;s
            list prices as of {d.prices_as_of}
            {month.spend_estimated
              ? ", with a model newer than those priced at the dearest of its kind"
              : ""}
            . With a cap, the clan&rsquo;s model drafts nothing more once this
            month&rsquo;s (UTC) estimate reaches it; a draft that starts under
            the cap may finish a little over it. Your Anthropic bill is the real
            figure.
          </p>
          {d.cap_reached ? (
            <div className="callout callout--warn m-3" role="status">
              <span>
                This month&rsquo;s spend, about {usd(month.spend_usd)}, has
                reached the {usd(d.spend_cap_usd)} cap, so the clan&rsquo;s
                model is not drafting. Raise or remove the cap, or wait for the
                month to turn.
              </span>
            </div>
          ) : null}
          {d.model && !listed && !d.refused_at ? (
            <div className="callout callout--warn m-3" role="status">
              <span>
                The chosen model, {d.model}, is not one this key offers now. It
                stays chosen until you pick another; drafts may fail until then.
              </span>
            </div>
          ) : null}
          {d.refused_at ? (
            <div className="callout callout--warn m-3" role="alert">
              <span>
                Anthropic stopped accepting this key on {day(d.refused_at)}. Add
                it again, or a new one, below.
              </span>
            </div>
          ) : !d.readable ? (
            <div className="callout callout--warn m-3" role="alert">
              <span>This key needs to be added again.</span>
            </div>
          ) : d.owner_leads === false ? (
            <div className="callout callout--warn m-3" role="alert">
              <span>
                {d.set_by_name ?? d.set_by} added this key and no longer leads
                the clan, so it is not used. Add your own below, or remove it.
              </span>
            </div>
          ) : null}
          <div className="panel__body pt-0">
            <button
              type="button"
              className="btn btn--sm"
              disabled={busy}
              onClick={remove}
            >
              Remove the key
            </button>
          </div>
        </section>
      ) : null}

      <form className="grid gap-2" onSubmit={saveKey}>
        <label className="field-label font-semibold" htmlFor="model-key">
          {d.set ? "Replace it with a key of yours" : "Add the clan's key"}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="model-key"
            className="input flex-[1_1_280px]"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !key.trim()}
          >
            {busy ? "Checking…" : "Check and save"}
          </button>
        </div>
        {message ? (
          <p className="field-error m-0" role="alert">
            {message}
          </p>
        ) : null}
        <p className="page-head__note m-0">
          An API key from the Anthropic Console. It is checked with Anthropic
          (which spends nothing), kept encrypted and never shown again, and used
          only while you lead this clan: your Anthropic account pays for each
          use, so set a spend limit there too (a monthly cap here is Elixir
          Clan&rsquo;s own stop, not Anthropic&rsquo;s). At most {d.per_day}{" "}
          uses a day.
        </p>
      </form>

      {d.uses.recent.length ? (
        <section>
          <div className="label mb-2">Recent uses</div>
          <div tabIndex={0} className="table__scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>By</th>
                  <th>For</th>
                  <th>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {d.uses.recent.map((u) => (
                  <tr key={`${u.at}-${u.by}`}>
                    <td>{ago(u.at)}</td>
                    <td>{u.by_name ?? u.by}</td>
                    <td>
                      {d.purposes[u.purpose]?.label ?? u.purpose}
                      {u.ok ? "" : ` (failed${u.code ? `: ${u.code}` : ""})`}
                    </td>
                    <td>
                      {n(u.input_tokens)} in · {n(u.output_tokens)} out
                      {u.spend_usd != null
                        ? ` · about ${usd(u.spend_usd)}`
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="page-head__note">Kept {d.keep_days} days.</p>
        </section>
      ) : null}
    </div>
  );
}
