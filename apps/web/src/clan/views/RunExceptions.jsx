import {
  ErrorState,
  Link,
  Panel,
  Row,
  Rows,
  Tag,
  useClock,
} from "@elixir-mcp/ui";
import { useState } from "react";
import { clanPath } from "../lib/base.js";
import { useExceptions } from "../lib/queries.js";
import { PageHead } from "../components/PageHead.jsx";
import {
  ExceptionForm,
  KINDS,
  KIND_ORDER,
  endsLine,
} from "../components/Exceptions.jsx";

const ROLE = { member: "Member", elder: "Elder" };

/**
 * Run, Exceptions (2026-11-23): the members the rules leave alone, and
 * how. The ones leaders set, each with its end date and who can see it;
 * the ones the rules make by themselves (leadership, Elders when the
 * rules leave them out of kicks, members who marked themselves away);
 * and a form to add one. The server refuses this read's leader half to
 * everyone else.
 */
export function RunExceptions({ clan, navigate }) {
  const { calendar } = useClock();
  const { state } = useExceptions(clan.clan_tag);
  const [editing, setEditing] = useState(null); // exception_id
  const [adding, setAdding] = useState(false);
  const run = `${clanPath(clan.clan_tag)}/run`;
  const head = (
    <PageHead
      title="Exceptions"
      lede="Members the rules leave alone. You pick who can see each one."
    />
  );
  if (state.error && !state.data)
    return (
      <div className="grid gap-4">
        {head}
        <ErrorState title="Exceptions could not be read just now">
          Try again in a moment.
        </ErrorState>
      </div>
    );
  const d = state.data;
  if (!d)
    return (
      <div className="grid gap-4">
        {head}
        <p className="page__lede">Loading…</p>
      </div>
    );
  if (!d.leader)
    return (
      <div className="grid gap-4">
        {head}
        <p className="page__lede">
          Only the Leader and Co-Leaders can set exceptions.
        </p>
      </div>
    );

  // A member's own Away is automatic; one a leader set is a leader's.
  const own = (e) => e.kind === "away" && e.set_by === e.player_tag;
  const set = d.exceptions
    .filter((e) => !own(e))
    .sort(
      (a, b) =>
        String(a.player_name ?? a.player_tag).localeCompare(
          String(b.player_name ?? b.player_tag),
        ) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    );
  const nameOf = (e) => e.player_name ?? e.player_tag;
  const leadership = d.automatic.leadership;
  const elders = d.automatic.elders;
  const away = d.automatic.away;
  const autoCount =
    leadership.length +
    (elders.shielded ? elders.members.length : 0) +
    away.length;
  const names = (list) =>
    list.map((m) => m.name ?? m.player_name ?? m.player_tag).join(", ");

  return (
    <div className="grid gap-4">
      {head}
      <Panel
        titleAs="h3"
        title={`Set by leaders · ${set.length}`}
        action={
          adding ? null : (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                setAdding(true);
                setEditing(null);
              }}
            >
              Add
            </button>
          )
        }
      >
        {adding ? (
          <div className="kit-panel__body">
            <ExceptionForm
              clanTag={clan.clan_tag}
              members={d.members}
              running={d.exceptions}
              onDone={() => setAdding(false)}
              onCancel={() => setAdding(false)}
            />
          </div>
        ) : null}
        {set.length === 0 ? (
          <div className="kit-panel__body">
            <p className="m-0 page__lede">
              None yet. Every member is judged by the rules.
            </p>
          </div>
        ) : (
          <Rows>
            {set.map((e) =>
              editing === e.exception_id ? (
                <div key={e.exception_id} className="kit-row">
                  <ExceptionForm
                    clanTag={clan.clan_tag}
                    member={{
                      player_tag: e.player_tag,
                      name: e.player_name,
                      role: e.role,
                    }}
                    existing={e}
                    onDone={() => setEditing(null)}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              ) : (
                <Row
                  key={e.exception_id}
                  title={
                    <>
                      {nameOf(e)}
                      {e.role ? (
                        <span className="page-head__note">
                          {" "}
                          · {ROLE[e.role] ?? e.role}
                        </span>
                      ) : null}
                      <span className="chip chip--info ml-1.5">
                        {KINDS[e.kind]?.label ?? e.kind}
                      </span>
                    </>
                  }
                  detail={
                    <>
                      {e.note ? <>&ldquo;{e.note}&rdquo; </> : null}
                      <span className="page-head__note">
                        {e.set_by_name ?? <Tag tag={e.set_by} />} ·{" "}
                        {endsLine(e, calendar)}
                      </span>
                    </>
                  }
                  right={
                    editing === null && !adding ? (
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => setEditing(e.exception_id)}
                      >
                        Change
                      </button>
                    ) : null
                  }
                />
              ),
            )}
          </Rows>
        )}
      </Panel>

      <Panel titleAs="h3" title={`Automatic · ${autoCount}`}>
        <div className="kit-panel__body">
          <p className="m-0 page-head__note">
            You can&rsquo;t change these here.
          </p>
        </div>
        <Rows>
          <Row
            title={`Leader and Co-Leaders · ${leadership.length}`}
            detail={
              <>
                No kick, no demotion, not ranked for Elder. Leaders are never
                judged by the rules.
                {leadership.length ? ` ${names(leadership)}.` : ""}
              </>
            }
          />
          {elders.shielded ? (
            <Row
              title={`Elders · ${elders.members.length}`}
              detail={
                <>
                  {d.removal_enabled
                    ? "Your rules don't kick Elders."
                    : "Your rules don't kick anyone."}
                  {elders.members.length ? ` ${names(elders.members)}.` : ""}
                </>
              }
              right={
                <Link
                  to={`${run}/inactivity`}
                  navigate={navigate}
                  className="btn btn--sm"
                >
                  Change in Rules
                </Link>
              }
            />
          ) : (
            <Row
              title="Elders"
              detail="Elders can be kicked like anyone else. Your rules say so."
              right={
                <Link
                  to={`${run}/inactivity`}
                  navigate={navigate}
                  className="btn btn--sm"
                >
                  Change in Rules
                </Link>
              }
            />
          )}
          <Row
            title={`Away · ${away.length}`}
            detail={
              <>
                They marked themselves away. No kick until they&rsquo;re back.
                {away.length
                  ? ` ${away
                      .map((a) => `${nameOf(a)} to ${calendar(a.until)}`)
                      .join(", ")}.`
                  : ""}{" "}
                {d.away_max_days > 0
                  ? `Up to ${d.away_max_days} days, set in Rules.`
                  : "Off in your Rules."}
              </>
            }
          />
        </Rows>
      </Panel>

      {d.band?.kept_elders > 0 ? (
        <p className="m-0 page-head__note">
          {d.band.kept_elders === 1
            ? "1 kept Elder doesn't take one of the earned seats."
            : `${d.band.kept_elders} kept Elders don't take any of the earned seats.`}
        </p>
      ) : null}
    </div>
  );
}
