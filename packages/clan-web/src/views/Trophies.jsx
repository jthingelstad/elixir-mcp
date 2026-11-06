import { Tag, Panel, Empty, PageHead, Table } from "@elixir-mcp/ui";
import { useTrophies } from "../lib/queries.js";
import { TooFew } from "../components/TooFew.jsx";

const place = (rank) =>
  rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}th`;

/**
 * The trophy case, for every member of a clan with a policy: the awards
 * the clan runs, who has won them season by season, and your own. Leaders
 * set the awards up in Manage ▸ Awards; nothing here is published outside
 * the app.
 */
export function Trophies({ clan, who }) {
  const { state, query } = useTrophies(clan.clan_tag);
  const head = (
    <PageHead
      title="Award history"
      sub={<>{clan.name ?? <Tag tag={clan.clan_tag} />}</>}
    />
  );
  if (state.forbidden)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>
            Award history is unavailable for your current clan access.
          </span>
        </div>
      </>
    );
  if (state.error === "too_few_members") {
    const d = query.data?.data ?? {};
    return (
      <>
        {head}
        <TooFew members={d.members} min={d.min_members} />
      </>
    );
  }
  if (state.error === "no_policy")
    return (
      <>
        {head}
        <Empty title="No policy yet">
          This clan&rsquo;s leaders have not set up how the clan runs here.
        </Empty>
      </>
    );
  if (state.error)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>Elixir did not answer. Try again in a minute.</span>
        </div>
      </>
    );
  if (!state.data)
    return (
      <>
        {head}
        <p className="page__lede">Reading the trophy case…</p>
      </>
    );
  const d = state.data;
  const names = new Map(d.awards.map((a) => [a.id, a.name]));
  if (!d.awards.length && !d.seasons.length)
    return (
      <>
        {head}
        <Empty title="No awards yet">
          This clan does not run any awards here yet.
        </Empty>
      </>
    );
  return (
    <>
      {head}
      {d.yours.length ? (
        <Panel className="mb-[18px]">
          <div className="panel__head">
            <span className="yours">★</span> Yours
          </div>
          <ul className="panel__body m-0 grid gap-1 pl-[34px]">
            {d.yours.map((g) => (
              <li key={`${g.season_id}-${g.award_id}`}>
                {g.name}
                {g.rank > 1 || !g.manual ? ` · ${place(g.rank)}` : ""} · season{" "}
                {g.season_id}
                {g.note ? ` · ${g.note}` : ""}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {d.awards.length ? (
        <section className="mb-[18px]">
          <div className="label mb-2">What this clan awards</div>
          <div className="grid gap-2">
            {d.awards.map((a) => (
              <Panel as="div" title={a.name} titleAs="div" key={a.id}>
                <div className="panel__body grid gap-1">
                  {a.description ? <div>{a.description}</div> : null}
                  <div className="page-head__note">{a.rule}</div>
                </div>
              </Panel>
            ))}
          </div>
        </section>
      ) : null}
      {d.seasons.map((s) => (
        <section key={s.season_id} className="mb-[18px]">
          <div className="label mb-2">Season {s.season_id}</div>
          <Table
            columns={[
              { head: "", cell: (g) => names.get(g.award_id) ?? g.name },
              { head: "", cell: (g) => (g.manual ? "" : place(g.rank)) },
              {
                head: "",
                cell: (g) => (
                  <>
                    {g.player_tag === who?.player_tag ? (
                      <span className="yours">★ </span>
                    ) : null}
                    {g.player_name ?? <Tag tag={g.player_tag} />}{" "}
                    <span className="tag">{g.player_tag}</span>
                  </>
                ),
              },
            ]}
            rows={s.grants}
            rowKey={(g) => `${g.award_id}-${g.player_tag}`}
            rowProps={(g) => ({
              "data-you": g.player_tag === who?.player_tag ? "true" : undefined,
            })}
            noHead
          />
        </section>
      ))}
    </>
  );
}
