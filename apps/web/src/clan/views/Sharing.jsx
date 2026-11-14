import { ErrorState } from "@elixir-mcp/ui";
import { useSharing } from "../lib/queries.js";

/**
 * What Clan records in Elixir (2026-09-25): what the clan did goes
 * into Elixir's record as facts, each said by the person who did it, and
 * what Clan computed each morning (the award standings) as its own.
 * Always, with nothing to switch (Jamie, 2026-09-25): every kind is
 * something the clan already sees in the game or here, and Elixir shows
 * each only to the readers its kind allows; agents (the Discord
 * narrator) read them there. This section says what and to whom.
 */
export function Sharing({ clan }) {
  const { state, load } = useSharing(clan.clan_tag);
  const d = state.data;
  if (state.signedOut) return null;
  if (state.forbidden)
    return (
      <div className="callout callout--warn" role="alert">
        <span>The recording summary is for the leader and co-leaders.</span>
      </div>
    );
  if (state.error)
    return (
      <ErrorState
        title="The recording summary could not be read just now"
        onRetry={() => load()}
        busy={state.loading}
      >
        Try again in a moment.
      </ErrorState>
    );
  if (!d) return <p className="page__lede">Reading…</p>;
  return (
    <div className="grid gap-3">
      <p className="page__lede m-0">
        What your clan does here is recorded in Elixir, said by the person who
        did it, and where the award races stand each morning, said by Clan
        itself, so other Elixir apps, including the Discord bot, know what the
        clan knows. Elixir keeps it apart from the game record and shows each
        kind only to the people below.
      </p>
      <div className="grid gap-3">
        {Object.entries(d.types).map(([key, t]) => (
          <div key={key} className="grid gap-1">
            <span className="font-semibold">{t.label}</span>
            <span className="page-head__note">
              {t.why} Seen in Elixir by: {t.sees}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
