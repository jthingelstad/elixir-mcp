import { useWrite } from "../../client/index.ts";
import {
  Chips,
  ConfirmAction,
  Empty,
  ErrorState,
  PageHead,
  Panel,
  Row,
  Rows,
  TagText,
  useClock,
} from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../../api.js";
import { keys, useActivityEvents, useSessions } from "../../lib/queries.js";
import { eventLabel, EVENT_GROUPS, eventGroup, eventDetail } from "./events.js";

/**
 * Sign-ins & devices: who can act as you now, and what changed on your
 * account. "Everywhere else" keeps this session, so the list can be read
 * afterwards to see it worked. A sign-in slides thirty days from last use
 * and ends at ninety.
 */
export function SignIns() {
  return (
    <div className="st-page">
      <PageHead
        title="Sign-ins & devices"
        sub="Who is signed in, and what changed on your account."
      />
      <Devices />
      <AccountEvents limit={20} />
    </div>
  );
}

function Devices() {
  const { when } = useClock();
  const query = useSessions();
  const sessions = query.data?.sessions ?? null;
  const everywhere = useWrite(api.revokeSessionsEverywhere, {
    invalidate: [keys.sessions],
  });
  const one = useWrite(api.revokeSession, { invalidate: [keys.sessions] });
  const others = sessions?.filter((s) => !s.current) ?? [];
  const where = (s) =>
    [s.from, s.country].filter(Boolean).join(", ") || "Address not seen";
  if (query.isError)
    return (
      <ErrorState
        title="Your devices could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        You are still signed in. Try again in a moment.
      </ErrorState>
    );
  return (
    <>
      <Panel
        title="Signed in"
        titleAs="h2"
        action={
          <span className="hint">
            {sessions
              ? `${sessions.length} signed in`
              : "Reading your sessions."}
          </span>
        }
      >
        <Rows>
          {sessions?.map((s) => (
            <Row
              key={s.id}
              title={
                <>
                  {s.client ?? "Unknown device"}
                  {s.current ? (
                    <span className="chip chip--ok ml-2">This device</span>
                  ) : null}
                </>
              }
              detail={
                <>
                  {where(s)}. Last used {when(s.last_seen_at)}. Signed in{" "}
                  {when(s.created_at)}.
                </>
              }
              right={
                s.current ? null : (
                  <ConfirmAction
                    label="Sign out"
                    title={`Sign out ${s.client ?? "this device"}?`}
                    body="That device's session ends at once. Sign in there again whenever you like."
                    confirm="Sign out"
                    run={() => one.run(s.id)}
                  />
                )
              }
            />
          ))}
        </Rows>
        {others.length > 0 ? (
          <div className="st-inset">
            <ConfirmAction
              label="Sign out everywhere else"
              title="Sign out everywhere else?"
              body="Every other browser and device signs out at once. Agents and connected apps are separate, and stay connected."
              confirm="Sign out everywhere else"
              run={() => everywhere.run()}
            />
          </div>
        ) : null}
      </Panel>
      <p className="st-foot">
        A sign-in lasts thirty days from its last use and ninety at most.
        Signing out here ends that device&rsquo;s session at once. Agents and
        connected apps are separate, under Connections &amp; agents.
      </p>
    </>
  );
}

/** A change on the account, in plain words. Shared with an agent's own
 *  account events, whose `scoped` read is the same table. */
function AccountEvents({ limit, title, sub }) {
  const { when } = useClock();
  const query = useActivityEvents(true);
  const [group, setGroup] = useState("all");
  const events = query.data?.events ?? null;
  const shown = (events ?? [])
    .filter((e) => group === "all" || eventGroup(e.kind) === group)
    .slice(0, limit ?? undefined);
  return (
    <Panel title={title ?? "What changed on your account"} titleAs="h2">
      <p className="st-inset m-0">
        {sub ??
          "Sign-ins and every other change to your account, your access and what is recorded for you. The newest 20."}
      </p>
      <div className="st-inset pt-0">
        <Chips
          label="Kind of change"
          options={EVENT_GROUPS}
          value={group}
          onChange={setGroup}
        />
      </div>
      {query.isError ? (
        <div className="st-inset">
          <ErrorState
            title="Your account's changes could not be read just now"
            onRetry={() => query.refetch()}
            busy={query.isFetching}
          >
            Try again in a moment.
          </ErrorState>
        </div>
      ) : events && shown.length === 0 ? (
        // The empty line sits on the list's own edge, not inset twice.
        <Empty>Nothing of this kind yet.</Empty>
      ) : (
        <Rows>
          {shown.map((e) => (
            <Row
              key={e.id ?? `${e.created_at}-${e.kind}`}
              title={eventLabel(e.kind)}
              detail={
                eventDetail(e) ? <TagText>{eventDetail(e)}</TagText> : null
              }
              right={<span className="hint">{when(e.created_at)}</span>}
            />
          ))}
        </Rows>
      )}
    </Panel>
  );
}
