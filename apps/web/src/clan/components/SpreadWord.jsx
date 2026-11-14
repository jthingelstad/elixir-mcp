import { Panel, Link } from "@elixir-mcp/ui";
import { inviteCopy } from "@elixir-mcp/clan-engine";
import { CopyLine } from "./ActionCard.jsx";
import { CLAN, clanPath } from "../lib/base.js";
import { eldersUp } from "../lib/tabs.js";

const LEADERS = new Set(["leader", "coLeader"]);
const MIN_MEMBERS = 10;

/** What setting up a clan here turns on, in a member's words. */
const TURNS_ON = [
  "Actions for leaders, elders and members, each with its own log",
  "How it works here, and where everyone stands",
  "Awards and a trophy case for every member",
  "Welcomes, away notices and Clan Leader Messages ready to send",
];

/** Which of Spread the word's panels fits where the clan is: `small`
 *  below 10 members, `setup` (a leader) or `invite` (anyone else) with no
 *  policy, `active` once the policy is, else none. The clan page puts the
 *  first three above the roster, where they are the next step, and the
 *  last beside it. */
export function spreadState({ me, clan, roster }) {
  const members = roster?.member_count ?? roster?.members?.length ?? null;
  const policy = me?.policy ?? null;
  if (members !== null && members < MIN_MEMBERS) return "small";
  if (policy && !policy.set) return LEADERS.has(clan.role) ? "setup" : "invite";
  if (policy?.active) return "active";
  return null;
}

/** Below ten: what waits, and how to get there. */
export function SmallClan({ clan, members, min = MIN_MEMBERS, navigate }) {
  const base = clanPath(clan.clan_tag);
  const lead = LEADERS.has(clan.role) && clan.verified !== false;
  // Recruit is the leaders' and elders' (Jamie, 2026-11-12): a member is
  // not sent to it.
  const recruiter = eldersUp(clan);
  const recruit = `${base}/members?show=recruit`;
  const policy = `${base}/run/about`;
  return (
    <Panel as="div" title={`Clan management starts at ${min} members`}>
      <div className="panel__body grid gap-2">
        <p className="m-0">
          This clan has {members}. Until it has {min}, Clan shows the roster and
          every member&rsquo;s numbers. The policy, actions, standing and awards
          wait, and a saved policy picks up again at {min}.
        </p>
        {lead ? (
          <p className="m-0">Leaders can prepare and save the policy now.</p>
        ) : null}
        {recruiter ? (
          <div className="flex flex-wrap gap-2">
            <Link to={recruit} navigate={navigate} className="btn btn--sm">
              Open Recruit
            </Link>
            {lead ? (
              <Link to={policy} navigate={navigate} className="btn btn--sm">
                Prepare the policy
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/** A leader's way in: nothing runs until a policy. */
export function SetupPolicy({ clan, navigate }) {
  const to = `${clanPath(clan.clan_tag)}/run/about`;
  return (
    <Panel as="div" title="Set up how the clan runs">
      <div className="panel__body grid gap-2">
        <p className="m-0">
          Nothing in clan management runs until a leader saves a policy. Start
          from what the clan is for (a war clan, a social clan and so on) and
          tune from there. Saving it turns on:
        </p>
        <ul className="m-0 pl-[18px]">
          {TURNS_ON.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <Link to={to} navigate={navigate} className="btn btn--primary w-fit">
          Set up the policy
        </Link>
      </div>
    </Panel>
  );
}

/** Anyone else's: the leaders have not set it up, and a line to ask them. */
export function InviteLeaders({ clan, name }) {
  const link =
    typeof window !== "undefined" ? `${window.location.origin}${CLAN}` : "";
  return (
    <Panel as="div" title="Invite your leaders">
      <div className="panel__body grid gap-2">
        <p className="m-0">
          Your clan&rsquo;s leaders have not set it up here yet. When a leader
          or co-leader does, everyone gets how the clan runs and where they
          stand.
        </p>
        <div className="label">A line for clan chat</div>
        <CopyLine
          text={inviteCopy("leaders", { clanName: name ?? clan.name ?? null })}
          event="clan.invite_copied"
          value="leaders"
        />
        <div className="label">The link, for Discord or a message</div>
        <CopyLine text={link} event="clan.invite_copied" value="link" />
      </div>
    </Panel>
  );
}

/**
 * Spread the word (round 5, 2026-09-25): the one panel on the clan page
 * that fits where the clan is. Below 10 members, Recruit helps it reach
 * 10. With 10 and no policy, a member or elder gets a line inviting the
 * leaders, and a leader gets the way to set it up. Those three stand above
 * the roster, where they are the next step.
 */
export function SpreadWord({ me, clan, roster, navigate }) {
  const members = roster?.member_count ?? roster?.members?.length ?? null;
  const state = spreadState({ me, clan, roster });
  const name = roster?.name ?? clan.name ?? null;
  if (state === "small")
    return <SmallClan clan={clan} members={members} navigate={navigate} />;
  if (state === "setup") return <SetupPolicy clan={clan} navigate={navigate} />;
  if (state === "invite") return <InviteLeaders clan={clan} name={name} />;
  return null;
}

/**
 * Spread the word at the roster's foot. Once the policy is active, every
 * member gets the clan's own words and its tag beside the line for chat
 * (the October 2026 canvas). Recruit's pitch, the copy in a note or a
 * post, is the leaders' and elders' (Jamie, 2026-11-12; the server refuses
 * anyone else): it opens on a tap, or when the address asks
 * (`/members?show=recruit`), since its read asks the game for the clan's
 * numbers. A member who follows that address gets its role line, as at
 * Scout's, and no read; with neither part there is no foot.
 */
export function SpreadWordFoot({
  me,
  clan,
  roster,
  recruit,
  onRecruit,
  show = null,
}) {
  const active = spreadState({ me, clan, roster }) === "active";
  const recruiter = eldersUp(clan);
  if (!active && !recruiter && show !== "recruit") return null;
  // The app's own address to share: Clan's landing on Elixir's origin.
  const link =
    typeof window !== "undefined" ? `${window.location.origin}${CLAN}` : "";
  const name = roster?.name ?? clan.name ?? null;
  return (
    <section
      id="spread-word"
      className="clan-foot"
      aria-labelledby="spread-word-head"
    >
      <h2 id="spread-word-head" className="clan-foot__head">
        Spread the word
      </h2>
      <div className="grid gap-2.5">
        {active ? (
          <>
            {roster?.description ? (
              <p className="m-0 text-body-sm text-ink-body">
                {roster.description}
              </p>
            ) : null}
            <div className="label">The clan tag</div>
            <CopyLine
              text={clan.clan_tag}
              event="clan.invite_copied"
              value="tag"
              label="Copy the clan tag"
            />
            <div className="label">Bring your clanmates</div>
            <p className="m-0 text-small text-ink-dim">
              Everyone in the clan can sign in with Elixir and see how the clan
              runs and where they stand.
            </p>
            <CopyLine
              text={inviteCopy("clanmates", { clanName: name })}
              event="clan.invite_copied"
              value="clanmates"
            />
            <div className="label">The link, for Discord or a message</div>
            <CopyLine text={link} event="clan.invite_copied" value="link" />
          </>
        ) : null}
        {recruiter ? (
          <>
            <div className="label">Recruit</div>
            <p className="m-0 text-small text-ink-dim">
              The clan&rsquo;s pitch as a personal note or a public post for a
              recruiting forum, with today&rsquo;s numbers from the game.
            </p>
            <button
              type="button"
              className="btn btn--sm w-fit"
              aria-expanded={Boolean(recruit)}
              aria-controls="spread-word-recruit"
              onClick={() => onRecruit?.(!recruit)}
            >
              {recruit
                ? "Hide the recruiting copy"
                : "Write the recruiting copy"}
            </button>
            <div id="spread-word-recruit">{recruit}</div>
          </>
        ) : show === "recruit" ? (
          <p className="page-head__note m-0" data-testid="recruit-role-line">
            Recruit is for elders, co-leaders and the leader: the clan&rsquo;s
            pitch for recruiting forums and players they invite.
          </p>
        ) : null}
      </div>
    </section>
  );
}
