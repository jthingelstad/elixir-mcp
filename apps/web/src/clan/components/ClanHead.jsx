import { useRef } from "react";
import {
  Avatar,
  FreshChip,
  Link,
  Tabs,
  Tag,
  useScrollHint,
} from "@elixir-mcp/ui";
import { useRace, useRoster } from "../lib/queries.js";
import { clanTabs, tabOf } from "../lib/tabs.js";
import { VERIFY } from "../../components/VerifyPlayer.jsx";
import { n, raceChip } from "../lib/words.js";
import { FollowThisClan } from "../../home/FollowClan.jsx";
import { ClanPicker } from "./ClanPicker.jsx";

const JOIN = {
  open: "open to join",
  inviteOnly: "invite only",
  closed: "closed",
};

/** The clan's own line under its name (G5): its tag, how many are in it,
 *  how it takes members and the trophies it asks. Each part only when the
 *  roster read carries it. */
export function clanLine(clan, roster) {
  const count = roster?.member_count ?? null;
  const floor = roster?.required_trophies ?? null;
  return [
    clan.clan_tag,
    count === null
      ? null
      : `${count} ${count === 1 ? "member" : "members"}, ${Math.max(0, 50 - count)} open`,
    JOIN[roster?.type] ?? null,
    floor > 0 ? `${n(floor)} trophies to join` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The head's chips: the race now, then the rules the leaders saved. Its
 *  own component so the scroll hint meets the row when it first draws,
 *  which is after the race and policy reads answer. */
function HeadChips({ racing, rules }) {
  const row = useRef(null);
  useScrollHint(row, { focusable: true });
  return (
    <ul ref={row} className="clan-head__chips kit-facts" aria-label="This clan">
      {racing ? <li className="kit-fact kit-fact--gold">{racing}</li> : null}
      {rules.map((c) => (
        <li key={c.key} className="kit-fact">
          {c.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * The head every clan page wears, a clan card: the clan's name, its line
 * (tag, members, how it takes members, its trophy floor), who you are in
 * it, a row of chips (the race now and the rules the leaders saved), how
 * fresh the roster read is, Follow (Home's clan follow,
 * home/FollowClan.jsx), a picker with two or more clans, the verify
 * banner, and the tabs. The clan's name is the page's one h1; each page's
 * own head under it is an h2. On a phone the chips are one row that
 * scrolls sideways inside the head, its edge faded where more is hidden,
 * and a tab stop while it scrolls; on a wider screen they wrap.
 */
export function ClanHead({ me, path, navigate, select, selecting }) {
  const clan = me.selected;
  const { state } = useRoster(clan.clan_tag);
  const roster = state.data ?? null;
  const race = useRace(clan.clan_tag).state.data?.race ?? null;
  const you = clan.acting_as_name ?? clan.player_name ?? null;
  const role = `${clan.role_label ?? ""}${clan.verified === false ? ", unverified" : ""}`;
  const who = [you, role || null].filter(Boolean).join(" · ");
  const ruleChips = me.policy?.chips ?? [];
  const racing = raceChip(race);
  return (
    <header className="clan-head">
      <div className="clan-head__card">
        <Avatar
          name={clan.name ?? clan.clan_tag}
          tag={clan.clan_tag}
          clan
          large
        />
        <div className="clan-head__top">
          <div className="clan-head__who">
            {who ? <p className="clan-head__role m-0">{who}</p> : null}
            <h1 className="kit-head__title clan-head__name m-0">
              {clan.name ?? <Tag tag={clan.clan_tag} />}
            </h1>
            <p className="clan-head__line m-0">{clanLine(clan, roster)}</p>
            {racing || ruleChips.length ? (
              <HeadChips
                // A new set of chips is a new row: the hint measures again.
                key={[racing, ...ruleChips.map((c) => c.key)].join("|")}
                racing={racing}
                rules={ruleChips}
              />
            ) : null}
          </div>
          <div className="clan-head__side">
            <FollowThisClan clanTag={clan.clan_tag} clanName={clan.name} />
            <ClanPicker
              me={me}
              navigate={navigate}
              select={select}
              selecting={selecting}
            />
            {roster?.meta?.as_of ? (
              <FreshChip
                label="Roster read"
                ts={roster.meta.as_of}
                seconds={roster.meta.freshness_seconds}
              >
                Elixir reads the clan from the game on a schedule. A gap means
                unknown. It does not mean nobody played.
              </FreshChip>
            ) : null}
          </div>
        </div>
      </div>
      {clan.verified === false || clan.unlock ? (
        <div className="callout callout--info" role="status">
          <span>
            {clan.unlock
              ? `In the game ${clan.unlock.name ?? clan.unlock.player_tag} is ${clan.unlock.role_label === "Elder" ? "an" : "a"} ${clan.unlock.role_label}. Verify that player in Elixir to use those tools here; until then you are here as a member.`
              : "Your player is not verified in Elixir, so you are here as a member who reads: verify it to mark yourself away, comment or join the clan map."}
          </span>
          <Link className="btn btn--sm" to={VERIFY}>
            Verify {clan.unlock?.name ?? you ?? "your player"}
          </Link>
        </div>
      ) : null}
      <Tabs label="Clan" items={clanTabs(me)} value={tabOf(path) ?? ""} />
    </header>
  );
}
