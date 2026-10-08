import { Icon } from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../api.js";
import { useInvalidate, useMyClans } from "../lib/queries.js";

/**
 * The one-click offer to follow your primary player's clan.
 *
 * Since 2026-10-08 Elixir follows that clan by itself when it can (Jamie:
 * "it should follow it automatically for the primary player assuming they
 * have a clan set"; claims followPrimaryClan). This is the fallback, for
 * when it could not: the account's clan slot is taken by a clan the person
 * chose (Elixir never displaces one), the person once stopped tracking
 * this clan, or no admitted profile has named the clan yet. It shows only
 * while the home clan is not followed, on Tracking and on the primary
 * player's page, which is where adding a tag lands.
 *
 * Activity scope: the slot every tier has, and what "follow my clan"
 * means. The comprehensive offer this replaced was refused for every tier
 * below supporter and read as a dead control.
 */
export function HomeClanOffer({ className = "" }) {
  const clansQuery = useMyClans();
  const clans = clansQuery.data ?? null;
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const home = clans?.home_clan;
  if (!home || (clans.clans ?? []).some((c) => c.clan_tag === home.clan_tag))
    return null;
  const slot = clans.slots?.activity;
  const full = slot?.limit != null && slot.used >= slot.limit;
  return (
    <div className={`callout callout--info ${className}`.trim()}>
      <Icon name="radar" size={17} />
      <span>
        <span className="text-gold">★</span> {home.name ?? home.clan_tag} is
        your player&rsquo;s clan and{" "}
        <button
          type="button"
          className="link"
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setErr("");
            const res = await api.myClanAction({
              action: "add",
              clan_tag: home.clan_tag,
              scope: "activity",
            });
            setBusy(false);
            // The API's own message names the tier and the slot.
            if (!res.ok)
              return setErr(
                res.data?.message ?? "That did not work. Try again.",
              );
            invalidate();
          }}
        >
          is not tracked yet, start tracking now!
        </button>
        <span className="mt-[5px] block text-[13px] text-ink-dim">
          {full
            ? "Your activity clan slot is in use, so Elixir did not follow it for you. Stop tracking that clan first, or keep the one you chose. "
            : ""}
          Activity follows the clan itself — its roster, its members coming and
          going, and its river races. Comprehensive also records every
          member&rsquo;s battles, which is what builds the clan a full history.
        </span>
        {err && <p className="field-error">{err}</p>}
      </span>
    </div>
  );
}
