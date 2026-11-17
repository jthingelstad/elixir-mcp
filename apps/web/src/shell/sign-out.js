import { useState } from "react";
import { writeErrorText } from "@elixir-mcp/ui";
import { api } from "../api.js";
import { forgetSession } from "../lib/session-hint.js";
import { forgetOnSignOut } from "../lib/push.js";

const SIGN_OUT_NOTE =
  "Signs you out of Elixir on this browser. Drop has its own sign-in.";

/** Sign out, as the bar has always done it: a failure says so where it was
 *  asked for (the avatar's menu, or You), and the browser stays where it
 *  is. */
export function useSignOut(env = globalThis) {
  const [failed, setFailed] = useState(null);
  return {
    label: "Sign out",
    note: SIGN_OUT_NOTE,
    error: failed,
    onClick: async () => {
      setFailed(null);
      // This account's notifications leave this browser with it.
      await forgetOnSignOut(api.pushOff, env);
      const r = await api.signOut();
      if (!r.ok)
        return setFailed(
          `Not signed out. ${writeErrorText({ status: r.status, transport: r.error, data: r.data })}`,
        );
      forgetSession();
      env.location.assign("/");
    },
  };
}
