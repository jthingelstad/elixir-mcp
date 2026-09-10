import { Activity } from "./Activity.jsx";

import { Overview } from "./account/Overview.jsx";
import { AgentDetail, Agents } from "./account/Agents.jsx";
import { FeedbackItem, Feedback } from "./account/Feedback.jsx";
import { Connections } from "./account/Connections.jsx";
import { Usage } from "./account/Usage.jsx";

/**
 * The Account section's pages.
 *
 * Tracking and Settings & tier are rail items of their own in the
 * 2026-09-09 IA but still render Overview, because Overview is currently
 * doing all three jobs. Splitting it is step 4 of the handoff; pointing
 * the rail at it first means the routes are real from the moment the
 * rail offers them.
 */
export function Dashboard({ me, refresh, navigate, page, sub, itemId }) {
  if (me === null) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  if (page === "activity") return <Activity sub={sub} />;
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
  return <Overview me={me} refresh={refresh} navigate={navigate} />;
}
