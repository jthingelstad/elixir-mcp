import { Activity } from "./Activity.jsx";
import { CollectorPage } from "./CollectorDetail.jsx";

import { Overview } from "./account/Overview.jsx";
import { AgentDetail, Agents } from "./account/Agents.jsx";
import { FeedbackItem, Feedback } from "./account/Feedback.jsx";
import { Connections } from "./account/Connections.jsx";
import { Usage } from "./account/Usage.jsx";

export function Dashboard({ me, refresh, navigate, page, itemId }) {
  if (me === null) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  if (page === "activity") return <Activity />;
  if (page === "collector") return <CollectorPage />;
  if (page === "agents")
    return itemId ? (
      <AgentDetail id={itemId} navigate={navigate} />
    ) : (
      <Agents navigate={navigate} />
    );
  if (page === "connections")
    return <Connections me={me} navigate={navigate} />;
  if (page === "usage") return <Usage me={me} />;
  if (page === "feedback")
    return itemId ? (
      <FeedbackItem id={itemId} navigate={navigate} />
    ) : (
      <Feedback navigate={navigate} />
    );
  return <Overview me={me} refresh={refresh} navigate={navigate} />;
}
