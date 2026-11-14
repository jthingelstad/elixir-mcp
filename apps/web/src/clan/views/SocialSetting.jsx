import { ErrorState } from "@elixir-mcp/ui";
import { useState } from "react";
import { manageApi } from "../api.js";
import { keys, useInvalidate, useSocial } from "../lib/queries.js";
import { trackEvent } from "../../analytics.js";

/**
 * The clan's Social switch (Jamie, 2026-09-26): every clan has the social
 * features, and its leaders can turn them off. Off hides the clan map from
 * everyone here; members' own places are theirs and stay, shown in their
 * other clans. Recruit is not affected.
 */
const LEADERS = new Set(["leader", "coLeader"]);

export function SocialSetting({ clan }) {
  const { state, load } = useSocial(clan.clan_tag);
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const d = state.data;
  if (state.forbidden || state.signedOut) return null;
  if (state.error)
    return (
      <ErrorState
        title="Social settings could not be read just now"
        onRetry={() => load()}
        busy={state.loading}
      >
        Try again in a moment.
      </ErrorState>
    );
  if (!d) return <p className="page__lede">Reading…</p>;
  const canSet = LEADERS.has(clan.role);
  return (
    <label className="flex items-start justify-between gap-4">
      <span className="grid gap-1">
        <span className="font-semibold">Member map</span>
        <span className="page-head__note">
          The clan map: members add a city or region and see where the clan
          plays from, with each one&rsquo;s local time. Only this clan&rsquo;s
          members with a verified player here see it, and it stays out of the
          game record. Nobody appears until they add themselves, and leaders
          can&rsquo;t place anyone.
        </span>
        <span className="page-head__note">
          {d.enabled
            ? `${d.set_by_name ? `Last set by ${d.set_by_name}. ` : ""}Visible to verified clan members.`
            : `It is off.${d.set_by_name ? ` Last set by ${d.set_by_name}.` : ""}`}
        </span>
        {canSet ? null : (
          <span className="page-head__note">
            Only the leader and co-leaders can change this setting.
          </span>
        )}
      </span>
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0"
        checked={d.enabled}
        disabled={busy || !canSet}
        onChange={async () => {
          setBusy(true);
          const r = await manageApi.setSocial(clan.clan_tag, !d.enabled);
          setBusy(false);
          if (r.ok)
            trackEvent("clan.social_set", r.data.enabled ? "on" : "off");
          invalidate(keys.social(clan.clan_tag));
          invalidate(keys.map(clan.clan_tag));
          invalidate(keys.me);
        }}
      />
    </label>
  );
}
