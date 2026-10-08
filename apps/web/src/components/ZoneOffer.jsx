import { Icon, Link, browserZone, useClock } from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../api.js";
import { CONSOLE } from "../lib/console.js";
import { useInvalidate } from "../lib/queries.js";
import { useScope } from "../lib/scope.js";

const isUtc = (zone) => !zone || zone === "UTC" || zone === "Etc/UTC";

/** "Central time" for America/Chicago; the IANA name when the browser
 *  has no generic name for it. */
function zoneWords(zone) {
  try {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longGeneric",
    })
      .formatToParts(new Date())
      .find((x) => x.type === "timeZoneName")?.value;
    return p ? p.replace(/ Time$/, " time") : zone;
  } catch {
    return zone;
  }
}

/**
 * The one-click offer to put the account on the reader's own clock.
 *
 * An account with no zone reads in UTC (Profile; docs/your-account,
 * "Your time zone"), so a new person read Ladder's nights in UTC while
 * the battle page, before they signed in, had shown their own clock
 * (the 2026-10-08 fresh-person journey). Since then a new account opens
 * on its signup browser's zone, so this is for the accounts made before
 * that, or whose browser gave none: it names the clock in use and offers
 * the browser's zone, saved only on the click. It shows only while the
 * account has no zone and the browser's is not UTC, and never on an
 * agent's console.
 */
export function ZoneOffer({ className = "" }) {
  const { zone } = useClock();
  const agent = useScope();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const local = browserZone();
  if (agent || zone || isUtc(local)) return null;
  const words = zoneWords(local);
  return (
    <div className={`callout callout--info ${className}`.trim()}>
      <Icon name="clock" size={17} />
      <span>
        Times here are in UTC: your account has no time zone set.{" "}
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            const r = await api.setTimezone(local);
            if (!r?.ok) {
              setErr(r?.data?.message ?? "That time zone could not be saved.");
              setBusy(false);
              return;
            }
            await invalidate();
          }}
        >
          Use {words}
        </button>{" "}
        <Link to={`${CONSOLE}/account/profile`}>or choose on Profile</Link>
        {err ? <span className="field-error"> {err}</span> : null}
      </span>
    </div>
  );
}
