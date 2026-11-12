import { ErrorState, Panel, useClock } from "@elixir-mcp/ui";
import { clanPath } from "../lib/base.js";
import { usePolicy } from "../lib/queries.js";
import { leads } from "../lib/tabs.js";
import { PageHead } from "../components/PageHead.jsx";

/** Elder's weights as the policy sets them, heaviest first. */
function Weights({ weights }) {
  return (
    <div className="grid gap-3">
      {weights.map((w) => {
        const pct = Math.round(w.share * 100);
        return (
          <div key={w.key} className="grid gap-1.5">
            <span className="flex items-baseline gap-2">
              <span className="grow text-[14px] font-semibold">{w.label}</span>
              <span className="font-mono text-[15px]">{pct}%</span>
            </span>
            <svg
              className="block w-full h-2 rounded-full overflow-hidden"
              viewBox="0 0 100 8"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <rect width="100" height="8" className="fill-ground-sunken" />
              <rect width={pct} height="8" className="fill-accent" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Policy, a tab for every member (Clan as one view, slice 8, #766): how the
 * clan runs, in every member's words, the version and who saved it. The
 * policy and its description are public in the clan directory (A2), so this
 * shows no member's standing, clock or hold. Editing it is Run's, for the
 * leader and co-leaders.
 */
export function ClanPolicy({ clan, navigate }) {
  const { whenDay } = useClock();
  const { data, isError } = usePolicy(clan.clan_tag);
  const name = clan.name ?? clan.clan_tag;
  const edit = `${clanPath(clan.clan_tag)}/run/about`;
  const lead = leads(clan);
  const editLink = lead ? (
    <a
      className="btn btn--sm"
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
      <>
        <PageHead title={`How ${name} works`} />
        <p className="page__lede m-0">
          {lead
            ? "This clan has no policy yet. Nothing in Clan runs until one is saved: no standing, no suggestions, no removals."
            : "This clan has no policy yet. Its leader or a co-leader saves one in Elixir, and until then nothing in Clan runs."}
        </p>
        {editLink ? <div>{editLink}</div> : null}
      </>
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
      />
      <Panel aria-labelledby="policy-how">
        <div className="panel__head">
          <h3 id="policy-how" className="m-0 grow text-[14px] font-semibold">
            The policy
          </h3>
          {current.version ? (
            <span className="chip chip--info">policy v{current.version}</span>
          ) : null}
        </div>
        <div className="panel__body grid gap-4">
          {data.weights?.length ? <Weights weights={data.weights} /> : null}
          {(data.how ?? []).map((section) => (
            <div key={section.key} className="grid gap-1">
              <h4 className="label m-0">{section.title}</h4>
              {section.lines.map((line) => (
                <p
                  key={line}
                  className="m-0 text-[13.5px] leading-[1.55] text-ink-body"
                >
                  {line}
                </p>
              ))}
            </div>
          ))}
        </div>
      </Panel>
      <div className="flex flex-wrap items-center gap-3">
        {saved ? <p className="page-head__note m-0">{saved}.</p> : null}
        {editLink}
      </div>
    </div>
  );
}
