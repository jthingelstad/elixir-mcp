import { ConfirmAction, Panel, Row, Rows, Tag, TagText } from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../../api.js";
import { useInvalidate, useMyClans } from "../../lib/queries.js";
import { useScope } from "../../lib/scope.js";
import { scopeLabel } from "../../lib/words.js";

const TAG_OK = /^#?[0289PYLQGRJCUVOo]{3,12}$/;

/** "3 of 5", or just the count when the limits have no ceiling. */
const of = (slot) =>
  slot
    ? slot.limit == null
      ? `${slot.used} used`
      : `${slot.used} of ${slot.limit}`
    : "";

/**
 * What an agent tracks: its What it reads tab (2026-09-23; Jamie: "there is
 * no way to add a randomly tracked account to an agent but there should be.
 * Or a clan agent may be asked to track a competitive clan").
 *
 * The clan it ACTS FOR is marked and cannot be removed; any other of its
 * clans can be made that one instead, which is how an agent is re-pointed.
 * Its players are watched, never "me". Everything here spends the person's
 * places, one pool across them and their agents, so the counts are the
 * pool's.
 */
export function AgentFollowing({ agent }) {
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
    return r;
  };
  const playerAction = async (body) => {
    setErr("");
    const r = await api.agentPlayerAction(body, scope);
    if (!r.ok) setErr(r.data?.message ?? "That did not work.");
    invalidate();
    return r;
  };

  return (
    <>
      <p className="m-0">
        What this agent follows: the clan it acts for, any other clan it
        watches, and the players it follows. Followed means recorded, in your
        places: you and your agents share them, and a player or clan counts once
        however many of you follow it.
      </p>
      <Panel
        title="Clans"
        titleAs="h2"
        action={
          <span className="hint">
            Your places: the clan only {of(pool.activity_clans)}, every member{" "}
            {of(pool.comprehensive_clans)}
          </span>
        }
      >
        <Rows>
          {(clans ?? []).map((c) => {
            const name = c.name ?? c.clan_tag;
            return (
              <Row
                key={c.clan_tag}
                title={
                  <>
                    {c.name ?? <Tag tag={c.clan_tag} />}{" "}
                    {c.is_primary ? (
                      <span className="chip chip--ok">Acts for</span>
                    ) : null}
                  </>
                }
                detail={scopeLabel(c.scope)}
                right={
                  <span className="st-row-actions">
                    <button
                      type="button"
                      className="btn btn--sm"
                      aria-pressed={Boolean(c.notify)}
                      aria-label={`On its timeline: ${c.notify ? "on" : "off"}, for ${name}`}
                      onClick={() =>
                        clanAction({
                          clan_tag: c.clan_tag,
                          action: c.notify ? "notify_off" : "notify_on",
                        })
                      }
                    >
                      {c.notify ? "On its timeline" : "Off its timeline"}
                    </button>
                    {c.is_primary ? null : (
                      <>
                        <button
                          type="button"
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
                        <ConfirmAction
                          label="Remove"
                          title={`Remove ${name} from this agent?`}
                          body="The agent stops following it. If only this agent follows it, recording stops. History stays for at least a year after the last person stops following."
                          confirm="Remove"
                          run={() =>
                            clanAction({
                              clan_tag: c.clan_tag,
                              action: "remove",
                            })
                          }
                        />
                      </>
                    )}
                  </span>
                }
              />
            );
          })}
        </Rows>
        <form
          className="panel__body st-form"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (!TAG_OK.test(clanTag.trim())) {
              setErr("That doesn't look like a CR tag.");
              return;
            }
            const r = await clanAction({
              action: "add",
              clan_tag: clanTag.trim(),
              scope: clanScope,
            });
            if (r.ok) setClanTag("");
          }}
        >
          <label>
            Clan tag
            <input
              className="mono"
              placeholder="#CLANTAG"
              value={clanTag}
              onChange={(ev) => setClanTag(ev.target.value)}
            />
          </label>
          <label>
            What to record
            <select
              className="select"
              value={clanScope}
              onChange={(ev) => setClanScope(ev.target.value)}
            >
              <option value="activity">{scopeLabel("activity")}</option>
              <option value="comprehensive">
                {scopeLabel("comprehensive")}
              </option>
            </select>
          </label>
          <button className="btn btn--sm" type="submit">
            Follow a clan
          </button>
        </form>
      </Panel>

      <Panel
        title="Players"
        titleAs="h2"
        action={
          <span className="hint">
            Your places: players {of(pool.player_slots)}
          </span>
        }
      >
        {players.length === 0 ? (
          <p className="panel__body m-0 text-ink-faint">
            It follows no player of its own. Its clan&rsquo;s members are on its
            timeline already.
          </p>
        ) : (
          <Rows>
            {players.map((p) => {
              const name = p.name ?? p.player_tag;
              return (
                <Row
                  key={p.player_tag}
                  title={p.name ?? <Tag tag={p.player_tag} />}
                  detail={p.name ? <Tag tag={p.player_tag} /> : null}
                  right={
                    <span className="st-row-actions">
                      <button
                        type="button"
                        className="btn btn--sm"
                        aria-pressed={Boolean(p.notify)}
                        aria-label={`On its timeline: ${p.notify ? "on" : "off"}, for ${name}`}
                        onClick={() =>
                          playerAction({
                            player_tag: p.player_tag,
                            action: p.notify ? "notify_off" : "notify_on",
                          })
                        }
                      >
                        {p.notify ? "On its timeline" : "Off its timeline"}
                      </button>
                      <ConfirmAction
                        label="Remove"
                        title={`Remove ${name} from this agent?`}
                        body="The agent stops following them. If only this agent follows them, recording stops. History stays for at least a year after the last person stops following."
                        confirm="Remove"
                        run={() =>
                          playerAction({
                            player_tag: p.player_tag,
                            action: "remove",
                          })
                        }
                      />
                    </span>
                  }
                />
              );
            })}
          </Rows>
        )}
        <form
          className="panel__body st-form"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (!TAG_OK.test(playerTag.trim())) {
              setErr("That doesn't look like a CR tag.");
              return;
            }
            const r = await playerAction({ player_tag: playerTag.trim() });
            if (r.ok) setPlayerTag("");
          }}
        >
          <label>
            Player tag
            <input
              className="mono"
              placeholder="#2PYQ8GJ0"
              value={playerTag}
              onChange={(ev) => setPlayerTag(ev.target.value)}
            />
          </label>
          <button className="btn btn--sm" type="submit">
            Follow a player
          </button>
        </form>
      </Panel>
      {err ? (
        <p className="field-error" role="alert">
          <TagText>{err}</TagText>
        </p>
      ) : null}
    </>
  );
}
