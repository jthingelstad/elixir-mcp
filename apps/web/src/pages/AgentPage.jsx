import { Activity } from "../views/Activity.jsx";
import { AgentRecord } from "../views/account/Agents.jsx";
import { AgentTracking } from "../views/account/AgentTracking.jsx";
import { CallRecord } from "../views/account/CallRecord.jsx";
import { Connections } from "../views/account/Connections.jsx";
import { Feedback, FeedbackItem } from "../views/account/Feedback.jsx";
import { Timeline } from "../views/account/Timeline.jsx";
import { Usage } from "../views/account/Usage.jsx";
import { useHere, useNav } from "../App.jsx";
import { useAgentMe } from "../lib/queries.js";
import { ScopeProvider } from "../lib/scope.js";

/**
 * /agent/{public_id}/{page}/{itemId}/{recordId}: an agent's console
 * (docs/reviews/2026-09-23-CONSOLE-ACCOUNT-SWITCHER.md). The scope comes
 * from the address and nowhere else; every page below is the same view
 * your console uses, reading through the scoped hooks.
 */
export function AgentPage() {
  const navigate = useNav();
  const { scope, activePage, here, itemId, recordId } = useHere();
  return (
    <ScopeProvider value={scope}>
      <AgentConsole
        agentId={scope}
        page={activePage ?? "overview"}
        sub={here.sub}
        itemId={itemId}
        recordId={recordId}
        navigate={navigate}
      />
    </ScopeProvider>
  );
}

function AgentConsole({ agentId, page, sub, itemId, recordId, navigate }) {
  const res = useAgentMe(agentId);
  if (res.isError)
    return (
      <p className="text-ink-faint">
        Elixir did not answer for this agent. Try again in a moment.
      </p>
    );
  if (!res.data) return <p className="text-ink-faint">Loading…</p>;
  // Not yours, or not an agent: the server says 404 and never which.
  // Anything else (401, 429, 5xx) is a failed read, not an absence
  // (console audit M1).
  if (!res.data.ok)
    return (
      <div className="panel">
        <div className="panel__body">
          {res.data.status === 404 || res.data.status === 403
            ? "No agent here on your account. "
            : "Elixir could not read this agent just now; try again in a moment. "}
          <a
            href="/account/agents"
            onClick={(e) => {
              e.preventDefault();
              navigate("/account/agents");
            }}
          >
            All agents ›
          </a>
        </div>
      </div>
    );
  const agent = res.data.data;
  if (page === "timeline") return <Timeline />;
  if (page === "tracking") return <AgentTracking agent={agent} />;
  if (page === "activity")
    return itemId === "c" ? (
      <CallRecord id={recordId} navigate={navigate} />
    ) : (
      <Activity sub={sub} navigate={navigate} />
    );
  if (page === "usage") return <Usage navigate={navigate} />;
  if (page === "connections")
    return <Connections me={agent} navigate={navigate} />;
  if (page === "feedback")
    return itemId ? (
      <FeedbackItem id={itemId} navigate={navigate} />
    ) : (
      <Feedback navigate={navigate} />
    );
  return (
    <AgentRecord
      publicId={agentId}
      part={page === "settings" ? "settings" : "overview"}
      navigate={navigate}
    />
  );
}
