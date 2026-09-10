import { Activity, NotificationRecord } from "./Activity.jsx";

import { Overview } from "./account/Overview.jsx";
import { Tracking } from "./account/Tracking.jsx";
import { Settings } from "./account/Settings.jsx";
import { Collections } from "./account/Collections.jsx";
import { AgentDetail, Agents } from "./account/Agents.jsx";
import { FeedbackItem, Feedback } from "./account/Feedback.jsx";
import { Connections } from "./account/Connections.jsx";
import { Usage } from "./account/Usage.jsx";

/** The Account section's pages. */
export function Dashboard({
  me,
  refresh,
  navigate,
  page,
  sub,
  itemId,
  recordId,
}) {
  if (me === null) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  if (page === "activity")
    return itemId === "n" ? (
      <NotificationRecord id={recordId} navigate={navigate} />
    ) : (
      <Activity sub={sub} navigate={navigate} />
    );
  if (page === "tracking") return <Tracking me={me} refresh={refresh} />;
  if (page === "settings") return <Settings me={me} refresh={refresh} />;
  if (page === "collections")
    return <Collections me={me} navigate={navigate} />;
  if (page === "agents")
    return itemId ? (
      <AgentDetail id={itemId} navigate={navigate} />
    ) : (
      <Agents navigate={navigate} />
    );
  if (page === "connections")
    return sub === "agents" ? (
      <Agents navigate={navigate} />
    ) : (
      <Connections me={me} navigate={navigate} />
    );
  if (page === "usage") return <Usage me={me} />;
  if (page === "feedback")
    return itemId ? (
      <FeedbackItem id={itemId} navigate={navigate} />
    ) : (
      <Feedback navigate={navigate} />
    );
  return <Overview me={me} navigate={navigate} />;
}
