import { Activity, NotificationRecord } from "./Activity.jsx";
import { CallRecord } from "./account/CallRecord.jsx";

import { Overview } from "./account/Overview.jsx";
import { Tracking } from "./account/Tracking.jsx";
import { TrackedRecord } from "./account/TrackedRecord.jsx";
import { Profile } from "./account/Profile.jsx";
import { Collections } from "./account/Collections.jsx";
import { AgentDetail, Agents } from "./account/Agents.jsx";
import { FeedbackItem, Feedback } from "./account/Feedback.jsx";
import { Connections } from "./account/Connections.jsx";
import { Usage } from "./account/Usage.jsx";
import { Verify } from "./account/Verify.jsx";

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
    ) : itemId === "c" ? (
      <CallRecord id={recordId} navigate={navigate} />
    ) : (
      <Activity sub={sub} navigate={navigate} />
    );
  if (page === "tracking")
    return itemId ? (
      <TrackedRecord
        me={me}
        refresh={refresh}
        navigate={navigate}
        tag={itemId}
      />
    ) : (
      <Tracking me={me} refresh={refresh} navigate={navigate} />
    );
  if (page === "profile")
    return <Profile me={me} refresh={refresh} navigate={navigate} />;
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
  if (page === "usage") return <Usage me={me} navigate={navigate} />;
  if (page === "verify")
    return <Verify refresh={refresh} navigate={navigate} />;
  if (page === "feedback")
    return itemId ? (
      <FeedbackItem id={itemId} navigate={navigate} />
    ) : (
      <Feedback navigate={navigate} />
    );
  return <Overview me={me} navigate={navigate} />;
}
