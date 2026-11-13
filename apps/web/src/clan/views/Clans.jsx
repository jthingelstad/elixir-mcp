import { Link, Tag, Panel, PageHead } from "@elixir-mcp/ui";
import { useState } from "react";
import { RoleChip } from "../components/RoleChip.jsx";
import { VERIFY } from "../../components/VerifyPlayer.jsx";
import { CLAN } from "../lib/base.js";

/**
 * The chooser: one card per clan the person holds a player in, with the
 * tag and role they act as there. An unverified player is a member until
 * it is verified, so its card says so; unverified players are also listed
 * with a Verify link.
 */
export function Clans({ me, onSelect, selecting }) {
  const [picking, setPicking] = useState(null);
  const unverified = (me.identities ?? []).filter(
    (i) =>
      i.claim_status !== "verified" &&
      (i.relationship === "primary" || i.relationship === "alt"),
  );
  return (
    <div className="max-w-[640px]">
      <PageHead
        title="All your clans"
        sub={
          <>
            Every clan you hold a player in. Pick one to work in; it is
            remembered.
          </>
        }
        aside={
          <Link className="btn btn--sm" to={`${CLAN}/directory`}>
            Clan directory
          </Link>
        }
      />
      <div className="grid gap-3">
        {me.clans.map((c) => {
          const current = me.selected?.clan_tag === c.clan_tag;
          return (
            <Panel
              as="button"
              type="button"
              key={c.clan_tag}

              data-clan={c.clan_tag}
              aria-current={current ? "true" : undefined}
              disabled={selecting}
              onClick={() => {
                setPicking(c.clan_tag);
                onSelect(c.clan_tag);
              }}
              className={`w-full cursor-pointer text-left [color:inherit] [font:inherit]${current ? " [box-shadow:var(--mark-current)]" : ""}`}
            >
              <div className="panel__body grid gap-1.5">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className="page-title">
                    {c.name ?? <Tag tag={c.clan_tag} />}
                  </span>
                  <span className="tag">{c.clan_tag}</span>
                  {current ? (
                    <span className="chip chip--info">current</span>
                  ) : null}
                  {picking === c.clan_tag && selecting ? (
                    <span className="page-head__note">opening…</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="yours">★</span>
                  <span>{c.acting_as_name ?? <Tag tag={c.acting_as} />}</span>
                  <span className="tag">{c.acting_as}</span>
                  <RoleChip role={c.role} label={c.role_label} />
                  {c.verified === false ? (
                    <span className="chip chip--warn">unverified</span>
                  ) : null}
                  {c.unlock ? (
                    <span className="page-head__note">
                      {c.unlock.role_label} in the game, once{" "}
                      {c.unlock.name ?? <Tag tag={c.unlock.player_tag} />} is
                      verified
                    </span>
                  ) : null}
                  {c.your_tags.length > 1 ? (
                    <span className="page-head__note">
                      and {c.your_tags.length - 1} more of your players here
                    </span>
                  ) : null}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
      {unverified.length > 0 ? (
        <Panel
          as="div"
          title="Unverified players"
          titleAs="div"
          className="mt-5 opacity-85"
        >
          <div className="panel__body grid gap-2">
            {unverified.map((i) => (
              <div
                key={i.player_tag}
                className="flex flex-wrap items-center gap-2"
              >
                <span>{i.name ?? <Tag tag={i.player_tag} />}</span>
                <span className="tag">{i.player_tag}</span>
                {i.clan_tag ? (
                  <span className="page-head__note">
                    in {i.clan_name ?? <Tag tag={i.clan_tag} />}
                  </span>
                ) : null}
                <Link className="btn btn--sm ml-auto" to={VERIFY}>
                  Verify your player
                </Link>
              </div>
            ))}
          </div>
          <div className="panel__foot">
            An unverified player is a member here whatever its role in the game:
            it reads what members read and acts on nothing. An Elder&rsquo;s,
            Co-leader&rsquo;s or Leader&rsquo;s tools wait until it is verified,
            which is one battle with a deck Elixir names.
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
