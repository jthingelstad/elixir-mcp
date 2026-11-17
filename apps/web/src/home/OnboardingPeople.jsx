import { ErrorState, Link, TagText } from "@elixir-mcp/ui";
import { usePeople } from "../lib/queries.js";
import { StarterSet } from "./People.jsx";

/** The same priced, confirmed follows as the Timeline offers later. A
 * first battle-log read never holds these names back.
 */
export function OnboardingPeople({ progress, onOpenTimeline, onFollowed }) {
  const people = usePeople("starter");
  const state = progress?.data;
  const pending = ["profile", "roster", "waiting"].includes(state?.state);
  const hasPeople = (people.data?.people?.length ?? 0) > 0;
  return (
    <>
      {people.isError ? (
        <ErrorState
          title="Your people could not be read just now"
          onRetry={() => people.refetch()}
        />
      ) : people.isPending || (pending && !hasPeople) ? (
        <section className="kit-starter" aria-label="Finding your people">
          <h2 className="kit-starter__head">Find your people</h2>
          <p role="status" className="kit-tiny kit-starter__lead">
            {state?.state === "roster" && state.clan ? (
              <>
                Finding your clanmates in{" "}
                <TagText>{state.clan.name ?? state.clan.tag}</TagText>.
              </>
            ) : state?.state === "waiting" ? (
              "Your clanmates haven't arrived yet. You can come back later."
            ) : (
              "Your profile is on its way. Friends from your battles and your clanmates appear here."
            )}
          </p>
          <div className="kit-starter__foot">
            <Link to="/home/find" className="btn btn--sm">
              Open Find
            </Link>
          </div>
        </section>
      ) : null}
      {progress?.isError ||
      (pending &&
        (progress?.request?.isError ||
          (progress?.request?.data?.queued === false &&
            ["pending", "unavailable", "rejected", "live_unavailable"].includes(
              progress?.request?.data?.reason,
            )))) ? (
        <p className="kit-tiny" role="status">
          Your clanmates could not be checked just now.{" "}
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => progress.retry()}
          >
            Try again
          </button>
        </p>
      ) : null}
      {!people.isPending && !people.isError && (!pending || hasPeople) ? (
        <StarterSet
          query={people}
          onOpenTimeline={onOpenTimeline}
          onFollowed={onFollowed}
        />
      ) : null}
    </>
  );
}
