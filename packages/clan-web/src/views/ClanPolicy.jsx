import { ErrorState, useClock } from "@elixir-mcp/ui";
import { useEffect } from "react";
import { clanPath } from "../lib/base.js";
import { usePolicy } from "../lib/queries.js";
import { leads } from "../lib/tabs.js";
import { PageHead } from "../components/PageHead.jsx";
import { HouseRules } from "../components/HouseRules.jsx";

/**
 * Policy, a tab for every member (Clan as one view, slice 8, #766): how the
 * clan runs, as its house rules. One card a rule, its numbers big, then the
 * policy's own sentences; the version and who saved it. The policy and its
 * description are public in the clan directory (A2), so this shows no
 * member's standing, clock or hold. Editing it is Run's, for the leader and
 * co-leaders.
 */
export function ClanPolicy({ clan, navigate }) {
  const { whenDay } = useClock();
  const { data, isError } = usePolicy(clan.clan_tag);
  const name = clan.name ?? clan.clan_tag;
  const edit = `${clanPath(clan.clan_tag)}/run/about`;
  const lead = leads(clan);
  // Standing's "Read the rule" lands on its card (`#rule-<key>`).
  const ready = Boolean(data?.set);
  useEffect(() => {
    if (!ready) return;
    const hash = window.location.hash.slice(1);
    if (hash.startsWith("rule-"))
      document.getElementById(hash)?.scrollIntoView?.({ block: "start" });
  }, [ready]);
  const editLink = lead ? (
    <a
      className={data?.set ? "btn" : "btn btn--primary"}
      href={edit}
      onClick={(e) => {
        e.preventDefault();
        navigate?.(edit);
      }}
    >
      {data?.set ? "Change it in Run" : "Set it up in Run"}
    </a>
  ) : null;
  if (isError)
    return (
      <>
        <PageHead title={`How ${name} works`} />
        <ErrorState title="The policy did not load">
          Try again in a minute.
        </ErrorState>
      </>
    );
  if (!data)
    return (
      <>
        <PageHead title={`How ${name} works`} />
        <p className="page__lede">Reading the policy…</p>
      </>
    );
  if (!data.set)
    return (
      <div className="grid gap-4">
        <PageHead title={`How ${name} works`} />
        <div className="kit-rule kit-rule--empty">
          <p className="m-0">
            {lead
              ? "This clan has no policy yet. Nothing in Clan runs until one is saved: no standing, no suggestions, no removals."
              : "This clan has no policy yet. Its leader or a co-leader saves one in Elixir, and until then nothing in Clan runs."}
          </p>
          {editLink ? <div>{editLink}</div> : null}
        </div>
      </div>
    );
  const current = data.current ?? {};
  const saved = [
    current.version ? `Policy v${current.version}` : null,
    current.saved_at ? `saved ${whenDay(current.saved_at)}` : null,
    current.saved_by_name ? `by ${current.saved_by_name}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="grid gap-4">
      <PageHead
        title={`How ${name} works`}
        lede="The clan's policy, in words. Every member reads the same, and so does anyone in Elixir's clan directory."
        fresh={editLink}
      />
      {saved ? <p className="kit-rules__saved">{saved}.</p> : null}
      <HouseRules
        how={data.how}
        values={current.values ?? null}
        weights={data.weights}
      />
    </div>
  );
}
