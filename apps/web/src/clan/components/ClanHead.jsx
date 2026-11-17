import { PlayerName } from "@elixir-mcp/ui";
import { useId, useRef, useState } from "react";
import {
  Avatar,
  FreshChip,
  Icon,
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
  return lineParts(clan, roster).join(" · ");
}

/** The line's parts, each kept whole on a phone. */
function lineParts(clan, roster, compact = false) {
  const count = roster?.member_count ?? null;
  const floor = roster?.required_trophies ?? null;
  return [
    compact ? null : clan.clan_tag,
    count === null ? null : `${count} of 50 members`,
    compact ? null : (JOIN[roster?.type] ?? null),
    !compact && floor > 0 ? `${n(floor)} trophies to join` : null,
  ].filter(Boolean);
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
 * The shared clan head keeps its name, membership, role and freshness
 * visible, beside Follow and the clan picker. About this clan discloses
 * its tag, recruitment requirements, race and policy chips. The verify
 * banner stays outside that disclosure. The clan's name is the page's
 * one h1; each page's own head under it is an h2. On a phone the chips are one row that
 * scrolls sideways inside the head, its edge faded where more is hidden,
 * and a tab stop while it scrolls; on a wider screen they wrap.
 */
export function ClanHead({ me, path, navigate, select, selecting }) {
  const [about, setAbout] = useState(false);
  const aboutId = useId();
  const clan = me.selected;
  const { state } = useRoster(clan.clan_tag);
  const roster = state.data ?? null;
  const race = useRace(clan.clan_tag).state.data?.race ?? null;
  const you = clan.acting_as_name ?? clan.player_name ?? null;
  const role = `${clan.role_label ?? ""}${clan.verified === false ? ", unverified" : ""}`;
  const who = you || role;
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
        <div className="clan-head__who">
          {who ? (
            <p className="clan-head__role m-0">
              {you ? (
                <PlayerName tag={clan.acting_as ?? clan.player_tag}>
                  {you}
                </PlayerName>
              ) : null}
              {you && role ? " · " : ""}
              {role}
            </p>
          ) : null}
          <h1 className="kit-head__title clan-head__name m-0">
            {clan.name ?? <Tag tag={clan.clan_tag} />}
          </h1>
          {/* One line that wraps only between its parts, the roster's
              freshness its quiet last part (2026-11-13). */}
          <div className="clan-head__line">
            {lineParts(clan, roster, true).map((part, i) => (
              <span key={i} className="clan-head__part">
                {part}
              </span>
            ))}
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
        <div className="clan-head__side">
          <FollowThisClan clanTag={clan.clan_tag} clanName={clan.name} />
          <ClanPicker
            me={me}
            navigate={navigate}
            select={select}
            selecting={selecting}
          />
          <button
            type="button"
            className="btn--text clan-head__about-toggle"
            aria-expanded={about}
            aria-controls={aboutId}
            onClick={() => setAbout((open) => !open)}
          >
            About this clan
            <Icon name={about ? "chevron-up" : "chevron-down"} size={16} />
          </button>
        </div>
      </div>
      <div id={aboutId} hidden={!about} className="clan-head__details">
        <p className="page-head__note m-0">{clanLine(clan, roster)}</p>
        {racing || ruleChips.length ? (
          <HeadChips
            key={[racing, ...ruleChips.map((c) => c.key)].join("|")}
            racing={racing}
            rules={ruleChips}
          />
        ) : null}
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
