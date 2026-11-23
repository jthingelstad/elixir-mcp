import { useLocation } from "@tanstack/react-router";
import { Empty, Link, PageHead, Rows, Row } from "@elixir-mcp/ui";
import { useEffect } from "react";
import { useHere, useMe, useNav } from "../App.jsx";
import { useMyGateways } from "../lib/queries.js";
import { SETTINGS, settingsHere } from "../lib/settings.js";
import { CollectorPage } from "../views/CollectorDetail.jsx";
import { RaiseCollector } from "../views/RaiseCollector.jsx";
import { CallRecord } from "../views/account/CallRecord.jsx";
import { CommentsSettings } from "../views/account/CommentsSettings.jsx";
import { Connections } from "../views/account/Connections.jsx";
import { EmailPage } from "../views/account/EmailPage.jsx";
import { EmailRecord } from "../views/account/EmailRecord.jsx";
import { NotificationsPage } from "../views/account/NotificationsPage.jsx";
import { Feedback, FeedbackItem } from "../views/account/Feedback.jsx";
import { Requests, Sent } from "../views/account/Logs.jsx";
import { Profile } from "../views/account/Profile.jsx";
import { Seen } from "../views/account/Seen.jsx";
import { SignIns } from "../views/account/SignIns.jsx";
import { DiscordPage } from "../views/account/TimelineDiscord.jsx";
import { FollowedRecord } from "../views/account/FollowedRecord.jsx";
import { Following } from "../views/account/Following.jsx";
import { Usage } from "../views/account/Usage.jsx";
import { Verify } from "../views/account/Verify.jsx";

const Reading = ({ children }) => (
  <p className="text-ink-faint" role="status">
    {children}
  </p>
);

/** /settings/...: one route, and the address says which page to draw
 *  (lib/settings.js holds the table). */
export function SettingsPage() {
  const navigate = useNav();
  const { me, refresh } = useMe();
  // The router's, not the window's: on an in-app move the page renders
  // before the address bar has the new hash.
  const { pathname, hash } = useLocation();
  const { search } = useHere();
  const here = settingsHere(pathname);
  if (!here || !me) return <Reading>Reading your settings.</Reading>;
  const tag = here.id ? decodeURIComponent(here.id) : undefined;
  switch (here.page) {
    case "profile":
      return <Profile me={me} refresh={refresh} hash={hash} />;
    case "seen":
      return <Seen me={me} />;
    case "comments":
      return <CommentsSettings me={me} />;
    case "sign-ins":
      return <SignIns />;
    case "players":
      return (
        <Following
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
        <FollowedRecord
          me={me}
          refresh={refresh}
          navigate={navigate}
          tag={tag}
        />
      );
    case "emails":
      return <EmailPage />;
    case "notifications":
      return <NotificationsPage />;
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
      return <Profile me={me} refresh={refresh} hash={hash} />;
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
                right={
                  g.status === "pending" ? "waiting for approval" : g.status
                }
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
