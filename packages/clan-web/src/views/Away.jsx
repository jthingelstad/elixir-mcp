import { useInitialTime, useClock, Panel } from "@elixir-mcp/ui";
import { Link, noun } from "@elixir-mcp/ui";
import { PageHead } from "../components/PageHead.jsx";
import { useState } from "react";
import { manageApi } from "../api.js";
import { keys, useInvalidate, useMyAway } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";
import { ELIXIR_LINKS } from "../lib/links.js";

/**
 * Away: a member tells the clan they will be gone, on their own page
 * (Jamie, 2026-09-12: "they could go there and indicate they are away"),
 * when the clan's policy tracks inactivity and offers it. Eligibility is shielded
 * like a leader's hold, up to the policy's cap; leaders see it on the board
 * with the member's note and can clear it; a leader's own hold is not the
 * member's to move.
 */
export function Away({ clan }) {
  const { calendar } = useClock();
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [today] = useInitialTime();
  const { data: state = null } = useMyAway(clan?.clan_tag);
  const invalidate = useInvalidate();
  const load = () => invalidate(keys.away(clan.clan_tag));

  if (!state) return <p className="page__lede">Reading…</p>;
  const hold = state.hold;
  const maxDate = new Date(today + state.max_days * 86400_000)
    .toISOString()
    .slice(0, 10);
  const ERRORS = {
    too_long: `At most ${state.max_days} ${noun(state.max_days, "day")} from today.`,
    bad_until: "Pick a date after today.",
    held_by_leader: "A leader has set a hold on you; ask them to change it.",
    away_off: "This clan does not take away notices here.",
  };
  return (
    <div className="max-w-[640px]">
      <PageHead
        title="Away"
        lede={`Tell your leaders when you will be back. It keeps you off the removal list while it's on. The days keep counting, and war decks still count.${
          state.allowed
            ? ` Up to ${state.max_days} ${noun(state.max_days, "day")} at a time.`
            : " This clan's policy does not offer it; tell a leader instead."
        }`}
      />
      {hold ? (
        <Panel
          as="div"
          title={
            hold.kind === "away"
              ? "You are marked away"
              : "A leader has you on hold"
          }
          titleAs="div"
        >
          <div className="panel__body" style={{ display: "grid", gap: "8px" }}>
            <div>
              {hold.until
                ? `Until ${calendar(hold.until)}`
                : "With no end date"}
              {hold.note ? ` · ${hold.note}` : ""}
              {hold.kind !== "away"
                ? ` · set by ${hold.by_name ?? hold.by}`
                : ""}
            </div>
            {hold.kind !== "away" ? (
              <p className="page-head__note m-0">
                A leader&rsquo;s hold stays until they change it; ask them to
                change it.
              </p>
            ) : (
              <button
                type="button"
                className="btn"
                style={{ width: "fit-content" }}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await manageApi.clearAway(clan.clan_tag);
                  trackEvent("clan.away_cleared");
                  setBusy(false);
                  load();
                }}
              >
                I&rsquo;m back
              </button>
            )}
          </div>
        </Panel>
      ) : state.allowed && state.verified === false ? (
        <div className="callout callout--info">
          <span>
            Saying you are away is said in your player&rsquo;s name, so it waits
            until your player is verified.{" "}
            <Link to={ELIXIR_LINKS.verify}>Verify your player</Link>
          </span>
        </div>
      ) : state.allowed ? (
        <Panel
          as="form"
          title="Mark yourself away"
          titleAs="div"

          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const r = await manageApi.setAway(clan.clan_tag, {
              until: new Date(`${until}T23:59:59Z`).toISOString(),
              note,
            });
            setBusy(false);
            if (!r.ok)
              return setError(ERRORS[r.data?.error] ?? "That did not work.");
            trackEvent("clan.away_set");
            setUntil("");
            setNote("");
            load();
          }}
        >
          <div className="panel__body" style={{ display: "grid", gap: "10px" }}>
            <label className="field-label" htmlFor="away-until">
              Back on
            </label>
            <input
              id="away-until"
              className="input"
              type="date"
              required
              min={new Date(today + 86400_000).toISOString().slice(0, 10)}
              max={maxDate}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              style={{ width: "auto" }}
            />
            <label className="field-label" htmlFor="away-note">
              A word for the leaders{" "}
              <span className="page-head__note">(optional)</span>
            </label>
            <input
              id="away-note"
              className="input"
              maxLength={200}
              placeholder="Holiday, exams, a new baby…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {error ? <p className="field-error">{error}</p> : null}
            <button
              type="submit"
              className="btn btn--primary"
              style={{ width: "fit-content" }}
              disabled={busy || !until}
            >
              Mark me away
            </button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
