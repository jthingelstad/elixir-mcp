import { useLocation } from "@tanstack/react-router";
import { Empty, Link, PageHead, Rows, Row } from "@elixir-mcp/ui";
import { useEffect } from "react";
import { useHere, useMe, useNav } from "../App.jsx";
import { useAgentMe, useMyGateways, useMyPrincipals } from "../lib/queries.js";
import { ScopeProvider } from "../lib/scope.js";
import { SETTINGS, settingsHere } from "../lib/settings.js";
import { CollectorPage } from "../views/CollectorDetail.jsx";
import { RaiseCollector } from "../views/RaiseCollector.jsx";
import {
  AgentFrame,
  AgentMoved,
  AgentOverview,
  AgentSettings,
  NoAgent,
} from "../views/account/Agents.jsx";
import { AgentTracking } from "../views/account/AgentTracking.jsx";
import { CallRecord } from "../views/account/CallRecord.jsx";
import { Connections } from "../views/account/Connections.jsx";
import { EmailPage } from "../views/account/EmailPage.jsx";
import { EmailRecord } from "../views/account/EmailRecord.jsx";
import { Feedback, FeedbackItem } from "../views/account/Feedback.jsx";
import { AgentEvents, Requests, Sent } from "../views/account/Logs.jsx";
import { Crumb } from "../views/account/parts.jsx";
import { Profile } from "../views/account/Profile.jsx";
import { Seen } from "../views/account/Seen.jsx";
import { SignIns } from "../views/account/SignIns.jsx";
import { Timeline } from "../views/account/Timeline.jsx";
import { DiscordPage } from "../views/account/TimelineDiscord.jsx";
import { TrackedRecord } from "../views/account/TrackedRecord.jsx";
import { Tracking } from "../views/account/Tracking.jsx";
import { Usage } from "../views/account/Usage.jsx";
import { Verify } from "../views/account/Verify.jsx";

const Reading = ({ children }) => (
  <p className="text-ink-faint" role="status">
    {children}
  </p>
);

/** /settings/...: one route, and the address says which page to draw
 *  (lib/settings.js holds the table, lib/moved.js every old address). */
export function SettingsPage() {
  const navigate = useNav();
  const { me, refresh } = useMe();
  // The router's, not the window's: on an in-app move the page renders
  // before the address bar has the new hash.
  const { pathname, hash } = useLocation();
  const { search } = useHere();
  const here = settingsHere(pathname);
  if (!here || !me) return <Reading>Reading your settings.</Reading>;
  if (here.agent)
    return (
      <ScopeProvider value={here.agent}>
        <AgentPages here={here} search={search} navigate={navigate} />
      </ScopeProvider>
    );
  const tag = here.id ? decodeURIComponent(here.id) : undefined;
  switch (here.page) {
    case "profile":
      return <Profile me={me} refresh={refresh} />;
    case "seen":
      return <Seen me={me} />;
    case "sign-ins":
      return <SignIns />;
    case "players":
      return (
        <Tracking
          me={me}
          refresh={refresh}
          navigate={navigate}
          hash={hash}
          search={search}
        />
      );
    case "verify":
      return <Verify refresh={refresh} navigate={navigate} tag={tag} />;
    case "player":
      return (
        <TrackedRecord
          me={me}
          refresh={refresh}
          navigate={navigate}
          tag={tag}
        />
      );
    case "emails":
      return <EmailPage />;
    case "sent":
      return <Sent />;
    case "email":
      return <EmailRecord id={here.id} navigate={navigate} search={search} />;
    case "connections":
      return <Connections me={me} navigate={navigate} />;
    case "discord":
      return <DiscordPage me={me} refresh={refresh} search={search} />;
    case "usage":
      return <Usage me={me} />;
    case "requests":
      return <Requests search={search} />;
    case "call":
      return <CallRecord id={here.id} navigate={navigate} />;
    case "feedback":
      return <Feedback search={search} />;
    case "feedback-item":
      return <FeedbackItem key={here.id} id={here.id} />;
    case "collectors":
      return <YourCollectors navigate={navigate} />;
    case "raise":
      return <RaiseCollector navigate={navigate} />;
    case "collector":
      // Keyed on the name: a re-picked card moves the record's address.
      return (
        <CollectorPage
          key={here.id}
          id={here.id}
          navigate={navigate}
          me={me}
          home={`${SETTINGS}/collectors`}
        />
      );
    default:
      return <Profile me={me} refresh={refresh} />;
  }
}

/** Collectors: none says how to start, one opens it, several are a list. */
function YourCollectors({ navigate }) {
  const query = useMyGateways();
  const mine = query.data?.gateways ?? null;
  const only = mine?.length === 1 ? (mine[0].card_name ?? mine[0].name) : null;
  useEffect(() => {
    if (only)
      navigate(`${SETTINGS}/collectors/${encodeURIComponent(only)}`, {
        replace: true,
      });
  }, [only, navigate]);
  if (query.isError)
    return (
      <Reading>This could not be read just now. Try again shortly.</Reading>
    );
  if (!mine || only) return <Reading>Reading your collectors.</Reading>;
  const start = (
    <>
      <Link className="btn btn--primary" to={`${SETTINGS}/collectors/new`}>
        {mine.length ? "Run another" : "Run a collector"}
      </Link>{" "}
      <a className="btn" href="/docs/operators">
        Operators guide
      </a>
    </>
  );
  return (
    <div className="st-page">
      <PageHead
        title="Collectors"
        sub="The machines you run for Elixir, inside one shared budget."
        aside={mine.length ? start : null}
      />
      {mine.length ? (
        <Rows>
          {mine.map((g) => {
            const card = g.card_name ?? g.name;
            return (
              <Row
                key={g.gateway_id}
                title={card}
                detail={g.name}
                right={g.status}
                href={`${SETTINGS}/collectors/${encodeURIComponent(card)}`}
              />
            );
          })}
        </Rows>
      ) : (
        <Empty title={<>You don&rsquo;t run one yet</>} action={start}>
          A collector is a machine that fetches for the record on a schedule.
          While it is active it raises your limits to Family, and it wears a
          Clash Royale card of your choosing as its public name.
        </Empty>
      )}
    </div>
  );
}

/** An agent's pages. The scope comes from the address and nowhere else; each
 *  page below is the one you read, through the scoped hooks. */
function AgentPages({ here, search, navigate }) {
  const principals = useMyPrincipals();
  const agents = principals.data?.agents;
  const known = agents?.some((a) => a.public_id === here.agent);
  const stale =
    agents && !known && agents.some((a) => a.account_id === here.agent);
  const res = useAgentMe(known ? here.agent : null);
  if (stale) return <AgentMoved id={here.agent} navigate={navigate} />;
  if (principals.isError || res.isError)
    return (
      <Reading>
        Elixir did not answer for this agent. Try again in a moment.
      </Reading>
    );
  if (agents && !known) return <NoAgent />;
  if (!res.data) return <Reading>Reading this agent.</Reading>;
  // Not yours, or not an agent: the server says 404 and never which.
  // Anything else (401, 429, 5xx) is a failed read, not an absence.
  if (!res.data.ok)
    return res.data.status === 404 || res.data.status === 403 ? (
      <NoAgent />
    ) : (
      <Reading>
        Elixir could not read this agent just now. Try again in a moment.
      </Reading>
    );
  const agent = res.data.data;
  const overview = `${SETTINGS}/agents/${here.agent}/overview`;
  switch (here.page) {
    case "timeline":
      return <Timeline crumb={<Crumb to={overview}>Overview</Crumb>} />;
    case "feedback":
      return <Feedback />;
    case "feedback-item":
      return <FeedbackItem key={here.id} id={here.id} />;
    case "requests":
      return <Requests search={search} />;
    case "call":
      return <CallRecord id={here.id} navigate={navigate} />;
    case "agent-events":
      return <AgentEvents agent={here.agent} />;
    default:
      return (
        <AgentFrame publicId={here.agent} tab={here.tab} navigate={navigate}>
          {(row) =>
            here.tab === "reads" ? (
              <AgentTracking agent={agent} />
            ) : here.tab === "usage" ? (
              <Usage me={agent} />
            ) : here.tab === "connections" ? (
              <Connections me={agent} navigate={navigate} />
            ) : here.tab === "settings" ? (
              <AgentSettings agent={row} />
            ) : (
              <AgentOverview agent={row} />
            )
          }
        </AgentFrame>
      );
  }
}
