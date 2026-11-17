import { useEffect, useState } from "react";
import { Icon, Link } from "@elixir-mcp/ui";
import { usePush } from "../lib/queries.js";
import { api } from "../api.js";
import {
  dismissPrompt,
  promptDismissed,
  pushSupport,
  thisDeviceState,
} from "../lib/push.js";
import { SETTINGS } from "../lib/settings.js";

/**
 * Once a page load, signed in: if this browser holds a subscription, ask
 * whether it is this account's device. The answer drops a device another
 * account left on this browser (a session that ended without Sign out),
 * so that account's notices stop here once someone else signs in.
 */
let reconciled = false;
export function useThisDeviceCheck(signedIn, env = globalThis) {
  useEffect(() => {
    if (!signedIn || reconciled) return;
    reconciled = true;
    thisDeviceState(api.pushThisDevice, env).catch(() => null);
  }, [signedIn, env]);
}

/**
 * The bell's one quiet prompt (2026-11-16): when notifications are offered,
 * this device could have them, has none, and the prompt was never put
 * away here. It never asks permission itself: it links to Settings ›
 * Notifications, where the tap does. Put away, it stays away on this
 * device.
 */
export function PushPrompt({ onLeave, env = globalThis }) {
  const [state, setState] = useState(null);
  // The account's read only once this device could take a prompt.
  const query = usePush(state === "ask" || state === "ask-install");
  useEffect(() => {
    let live = true;
    if (promptDismissed(env)) return undefined;
    const support = pushSupport(env);
    if (support !== "on-ready" && support !== "install") return undefined;
    // A subscription another account left here is not this account's.
    thisDeviceState(api.pushThisDevice, env).then((s) => {
      if (live && !s.registered)
        setState(support === "install" ? "ask-install" : "ask");
    });
    return () => {
      live = false;
    };
  }, [env]);
  const offered = query.data?.offered === true;
  if (!state || !offered || state === "gone") return null;
  const words =
    state === "ask-install"
      ? "Add Elixir to your Home Screen to get notified of cheers."
      : "Get notified when people cheer your play.";
  return (
    <div className="kit-bell__push">
      <Icon name="bell-ring" size={18} />
      <p>{words}</p>
      <Link
        className="btn btn--sm"
        to={`${SETTINGS}/notifications`}
        onClick={onLeave}
      >
        {state === "ask-install" ? "How" : "Turn on"}
      </Link>
      <button
        type="button"
        className="btn btn--quiet btn--sm"
        aria-label="Not now"
        onClick={() => {
          dismissPrompt(env);
          setState("gone");
        }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
