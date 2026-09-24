import { useState } from "react";
import { api } from "../../api.js";
import { useInvalidate, useMyClans } from "../../lib/queries.js";
import { useScope } from "../../lib/scope.js";

const TAG_OK = /^#?[0289PYLQGRJCUVOo]{3,12}$/;

/** "3 of 5", or just the count when the tier has no ceiling. */
const of = (slot) =>
  slot
    ? slot.limit == null
      ? `${slot.used}`
      : `${slot.used} of ${slot.limit}`
    : "";

/**
 * What an agent tracks, on its own console (2026-09-23; Jamie: "there is no
 * way to add a randomly tracked account to an agent but there should be.
 * Or a clan agent may be asked to track a competitive clan").
 *
 * The clan it ACTS FOR is marked and cannot be removed; any other of its
 * clans can be made that one instead, which is how an agent is re-pointed.
 * Its players are watched, never "me". Everything here spends the person's
 * recording slots, one pool across them and their agents, so the counts are
 * the pool's.
 */
export function AgentTracking({ agent }) {
  const scope = useScope();
  const { data } = useMyClans();
  const clans = data?.clans ?? null;
  const players = agent.claims ?? [];
  const pool = agent.entitlements ?? {};
  const invalidate = useInvalidate();
  const [clanTag, setClanTag] = useState("");
  const [clanScope, setClanScope] = useState("activity");
  const [playerTag, setPlayerTag] = useState("");
  const [err, setErr] = useState("");

  const clanAction = async (body) => {
    setErr("");
    const r = await api.myClanAction(body, scope);
    if (!r.ok)
      setErr(
        r.data?.message ??
          (r.data?.error === "primary_clan"
            ? "That is the clan it acts for. Make another of its clans that one first."
            : r.data?.error === "last_clan"
              ? "An agent acts for a clan: its last one stays."
              : "That did not work."),
      );
    invalidate();
    return r.ok;
  };
  const playerAction = async (body) => {
    setErr("");
    const r = await api.agentPlayerAction(body, scope);
    if (!r.ok) setErr(r.data?.message ?? "That did not work.");
    invalidate();
    return r.ok;
  };

  return (
    <>
      <div className="mb-[18px]">
        <h1 className="page__title">Tracking</h1>
        <p className="page__lede">
          What this agent tracks: the clan it acts for, any other clan it
          watches, and the players it follows. Tracked means recorded, in your
          slots: you and your agents share them, and a player or clan counts
          once however many of you track it.
        </p>
      </div>

      <section className="panel mb-[14px]">
        <div className="panel__head">
          <span className="panel-title">Clans</span>
          <span className="ml-auto text-[12px] text-ink-faint">
            your slots: activity {of(pool.activity_clans)} · comprehensive{" "}
            {of(pool.comprehensive_clans)}
          </span>
        </div>
        <div className="table__scroll" tabIndex={0}>
          <table className="table">
            <thead>
              <tr>
                <th>CLAN</th>
                <th>SCOPE</th>
                <th>ON ITS TIMELINE</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(clans ?? []).map((c) => (
                <tr key={c.clan_tag}>
                  <td>
                    <span className="font-semibold">
                      {c.name ?? c.clan_tag}
                    </span>{" "}
                    <span className="mono text-ink-faint">{c.clan_tag}</span>
                    {c.is_primary && (
                      <span className="chip chip--ok ml-2">acts for</span>
                    )}
                  </td>
                  <td>{c.scope}</td>
                  <td>
                    <button
                      className="btn btn--sm"
                      aria-label={`Timeline ${c.notify ? "on" : "off"} for ${c.name ?? c.clan_tag}`}
                      onClick={() =>
                        clanAction({
                          clan_tag: c.clan_tag,
                          action: c.notify ? "notify_off" : "notify_on",
                        })
                      }
                    >
                      {c.notify ? "on" : "off"}
                    </button>
                  </td>
                  <td className="text-right">
                    {!c.is_primary && (
                      <span className="inline-flex gap-2">
                        <button
                          className="btn btn--sm"
                          onClick={() =>
                            clanAction({
                              clan_tag: c.clan_tag,
                              action: "primary",
                            })
                          }
                        >
                          Make it the clan it acts for
                        </button>
                        <button
                          className="btn btn--sm"
                          onClick={() =>
                            clanAction({
                              clan_tag: c.clan_tag,
                              action: "remove",
                            })
                          }
                        >
                          Remove
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="panel__body flex flex-wrap gap-2"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (!TAG_OK.test(clanTag.trim())) {
              setErr("That doesn't look like a CR tag.");
              return;
            }
            if (
              await clanAction({
                action: "add",
                clan_tag: clanTag.trim(),
                scope: clanScope,
              })
            )
              setClanTag("");
          }}
        >
          <input
            className="mono flex-[1_1_8rem]"
            aria-label="Clan tag"
            placeholder="#CLANTAG"
            value={clanTag}
            onChange={(ev) => setClanTag(ev.target.value)}
          />
          <select
            className="select"
            aria-label="Scope"
            value={clanScope}
            onChange={(ev) => setClanScope(ev.target.value)}
          >
            <option value="activity">activity</option>
            <option value="comprehensive">comprehensive</option>
          </select>
          <button className="btn" type="submit">
            Track a clan
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel__head">
          <span className="panel-title">Players</span>
          <span className="ml-auto text-[12px] text-ink-faint">
            your slots: {of(pool.player_slots)}
          </span>
        </div>
        {players.length === 0 ? (
          <div className="panel__body text-ink-faint">
            It follows no player of its own. Its clan&rsquo;s members are on its
            timeline already.
          </div>
        ) : (
          <div className="table__scroll" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  <th>PLAYER</th>
                  <th>ON ITS TIMELINE</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.player_tag}>
                    <td>
                      <span className="font-semibold">
                        {p.name ?? p.player_tag}
                      </span>{" "}
                      <span className="mono text-ink-faint">
                        {p.player_tag}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn--sm"
                        aria-label={`Timeline ${p.notify ? "on" : "off"} for ${p.name ?? p.player_tag}`}
                        onClick={() =>
                          playerAction({
                            player_tag: p.player_tag,
                            action: p.notify ? "notify_off" : "notify_on",
                          })
                        }
                      >
                        {p.notify ? "on" : "off"}
                      </button>
                    </td>
                    <td className="text-right">
                      <button
                        className="btn btn--sm"
                        onClick={() =>
                          playerAction({
                            player_tag: p.player_tag,
                            action: "remove",
                          })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form
          className="panel__body flex flex-wrap gap-2"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (!TAG_OK.test(playerTag.trim())) {
              setErr("That doesn't look like a CR tag.");
              return;
            }
            if (await playerAction({ player_tag: playerTag.trim() }))
              setPlayerTag("");
          }}
        >
          <input
            className="mono flex-[1_1_10rem]"
            aria-label="Player tag"
            placeholder="#20JJJ2CCRU"
            value={playerTag}
            onChange={(ev) => setPlayerTag(ev.target.value)}
          />
          <button className="btn" type="submit">
            Track a player
          </button>
        </form>
      </section>
      {err && <p className="field-error mt-3">{err}</p>}
    </>
  );
}
