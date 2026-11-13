import { useInitialTime, Panel, PageHead, Empty } from "@elixir-mcp/ui";
import { useWrite } from "@elixir-mcp/client";
import {
  ago,
  Link,
  secsSince,
  Tag,
  WriteError,
  noun,
  useClock,
} from "@elixir-mcp/ui";
import { scopeLabel } from "../../lib/words.js";
import { VerifiedMark } from "../../components/VerifiedMark.jsx";
import { useState } from "react";
import { api } from "../../api.js";
import {
  useBattleActivity,
  useInvalidate,
  useMyClans,
} from "../../lib/queries.js";
import { tagFromPath, tagPath } from "../../lib/tag-url.js";
import { ActivityGraph } from "../../components/ActivityGraph.jsx";
import { SETTINGS } from "../../lib/settings.js";
import { playerHref } from "../../lib/player.js";
import { Crumb, Facts, Note } from "./parts.jsx";
import { FirstAnswer } from "../../components/FirstAnswer.jsx";
import { HomeClanOffer } from "../../components/HomeClanOffer.jsx";
import { ClanReadStatus } from "../../components/ClanReadStatus.jsx";
import {
  useFirstAnswer,
  useFirstReadLanded,
} from "../../hooks/useFirstAnswer.js";
import { recordJourney } from "../../lib/record-journey.js";
import { FixTag, StopFollowing } from "./TagFix.jsx";

/**
 * One tracked player or clan: how you track it, and what that is
 * capturing.
 *
 * The controls live here rather than in the Players & following row. A list row
 * with a nickname field, a relationship select, a notify switch and a
 * remove button in it is a form pretending to be a list, and it makes
 * the one thing a list is for — comparing rows — impossible.
 *
 * "Stop following" says what it costs beside itself: the history already
 * recorded is kept, and this only stops new capture. That is the whole
 * reason the word is "stop" and not "delete". It asks in a dialog before it
 * writes (TagFix.jsx).
 *
 * A player tag the game answered "not found" for (2026-10-08) records
 * nothing: the page says so as an error with the fix in it, and shows
 * no "active" recording or healthy poll for it (the battle log of an
 * unknown tag is an empty read that is admitted, so its poll looks
 * fresh).
 */
export function FollowedRecord({ me, refresh, navigate, tag }) {
  const clansQuery = useMyClans();
  const clans = clansQuery.data ?? null;
  const [nick, setNick] = useState(null);
  const [now] = useInitialTime();
  const { whenDay } = useClock();
  const invalidate = useInvalidate();
  const loadClans = () => invalidate();

  const wanted = tagFromPath(tag);
  const claim = (me.claims ?? []).find((c) => c.player_tag === wanted);
  // One status read for the page: FirstAnswer below shows it, and the
  // Capture panel needs to know a tag was not found.
  const answer = useFirstAnswer(`${wanted}:${claim?.is_primary}`, {
    playerTag: wanted,
    enabled: Boolean(claim),
  });
  const notFound = Boolean(
    claim && answer.data && recordJourney(answer.data).notFound,
  );
  // The player's own battle log read while the page is open: the year of
  // battles below was drawn without it, so read it again, once (2026-11-09).
  useFirstReadLanded(answer.data?.player ?? null, () =>
    invalidate(["me", "activity", wanted]),
  );
  // Every write on this page, each unwrapped: a refusal is said on the
  // page, and the record refetches only after a write that took. "Make
  // main player" used to clear the removal refusal whatever the server
  // answered.
  const relationship = useWrite(api.setRelationship, {
    invalidate: () => refresh(),
  });
  const primary = useWrite(
    () =>
      api.claimAction({
        player_tag: wanted,
        action: "add",
        make_primary: true,
      }),
    { invalidate: () => refresh() },
  );
  const scope = useWrite(
    (next) =>
      api.myClanAction({ action: "add", clan_tag: wanted, scope: next }),
    { invalidate: () => loadClans() },
  );
  const nickname = useWrite((next) => api.setNickname(wanted, next), {
    invalidate: () => refresh(),
  });
  const notify = useWrite(
    (clan, on) =>
      clan
        ? api.myClanAction({
            clan_tag: wanted,
            action: on ? "notify_off" : "notify_on",
          })
        : api.claimAction({
            player_tag: wanted,
            action: on ? "notify_off" : "notify_on",
          }),
    // The console's root: your session (a claim's switch) and your clans.
    { invalidate: () => loadClans() },
  );
  const remove = useWrite(
    (clan) =>
      clan
        ? api.myClanAction({ clan_tag: wanted, action: "remove" })
        : api.claimAction({ player_tag: wanted, action: "remove" }),
    { invalidate: () => refresh() },
  );
  const writes = [relationship, primary, scope, nickname, notify, remove];
  /** One write at a time says its outcome: starting one clears the others'. */
  const only = (write) => {
    for (const w of writes) if (w !== write) w.reset();
    return write.run;
  };
  const failed =
    relationship.error ??
    primary.error ??
    scope.error ??
    nickname.error ??
    notify.error;
  const busy = primary.busy || remove.busy;
  // Canonical year evidence, players only: a clan has no year of its own.
  const tracked = Boolean(claim);
  const activityQuery = useBattleActivity(tracked ? wanted : null);
  const activity = activityQuery.data ?? null;
  const clan = (clans?.clans ?? []).find((c) => c.clan_tag === wanted);
  const rec = me.recordings?.find((r) => r.subject_tag === wanted);

  const backTo = `${SETTINGS}/players`;
  const crumb = <Crumb to={backTo}>Players &amp; following</Crumb>;

  if (!claim && !clan) {
    return (
      <div className="st-page">
        {crumb}
        <ClanReadStatus query={clansQuery} />
        {clansQuery.isSuccess && (
          <Empty title="You are not following that">
            <span className="mono">{wanted}</span> is not on your account. If
            you stopped following it, history stays for at least a year after
            the last person stops following. Search for it to open its record.
          </Empty>
        )}
      </div>
    );
  }

  const isClan = Boolean(clan);
  const you = !isClan && (claim.is_primary || claim.relationship === "alt");
  // With no name the headline is the tag, in the display face, where a
  // 0 and an O are one shape: drawn as a Tag.
  const name = isClan
    ? (clan.name ?? <Tag tag={clan.clan_tag} />)
    : (claim.nickname ?? claim.name ?? <Tag tag={claim.player_tag} />);
  const plainName = isClan
    ? (clan.name ?? clan.clan_tag)
    : (claim.nickname ?? claim.name ?? claim.player_tag);
  const fresh = secsSince(rec?.freshest_poll, now);
  const recording = isClan ? clan.recording_status : rec?.status;
  // Every player name opens the player page (#764); Ladder is a door on it.
  const open = isClan
    ? ["/clan/directory", "Clan directory"]
    : [playerHref(wanted), you ? "Open your page" : "Open their page"];
  const stop = (
    <StopFollowing
      name={plainName}
      run={() => only(remove)(isClan)}
      busy={busy}
      onDone={() => navigate(backTo)}
    />
  );

  return (
    <div className="st-page">
      {crumb}
      {isClan && <ClanReadStatus query={clansQuery} />}
      <PageHead
        title={
          <>
            {name}
            {!isClan && claim?.status === "verified" && (
              <VerifiedMark size={20} />
            )}
          </>
        }
        sub={
          <>
            <span className="mono">{wanted}</span>,{" "}
            {isClan ? "a clan" : "a player"}
            {isClan && clan.member_count
              ? `, ${clan.member_count} ${noun(clan.member_count, "member")}`
              : ""}
            {!isClan && claim.is_primary ? ", your main player" : ""}
          </>
        }
        aside={
          <span className="st-actions">
            {you && claim.status !== "verified" ? (
              <Link
                className="btn btn--sm"
                to={`${SETTINGS}/players/${tagPath(wanted)}/verify`}
              >
                Verify {plainName}
              </Link>
            ) : null}
            <Link className="btn btn--sm" to={open[0]}>
              {open[1]}
            </Link>
          </span>
        }
      />

      {!isClan && (
        <FirstAnswer
          playerTag={wanted}
          claimsKey={`${wanted}:${claim.is_primary}`}
          answer={answer}
          fix={
            notFound ? (
              <FixTag
                claim={claim}
                refresh={refresh}
                navigate={navigate}
                stop={stop}
              />
            ) : null
          }
        />
      )}
      {/* Adding a tag lands here, so the main player's clan is offered here
          too when Elixir could not follow it by itself. */}
      {!isClan && claim.is_primary && <HomeClanOffer />}

      <div className="st-two">
        <Panel title="How you follow it" titleAs="h2">
          <Facts
            rows={[
              [
                "Relationship",
                isClan ? (
                  "A clan is followed, not related."
                ) : claim.is_primary ? (
                  <>
                    Your main player
                    <Note>
                      Who Ladder opens on, and the name in your top bar.
                    </Note>
                  </>
                ) : (
                  <span key="value" className="st-actions">
                    <select
                      className="select"
                      aria-label="Relationship"
                      value={claim.relationship ?? "watching"}
                      onChange={(ev) =>
                        only(relationship)(wanted, ev.target.value)
                      }
                    >
                      <option value="friend">Friend</option>
                      <option value="watching">Watching</option>
                      <option value="alt">Also you</option>
                    </select>
                    {/* Choosing a new one is how the current main player
                        becomes removable (2026-09-25). */}
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={busy}
                      onClick={() => only(primary)()}
                    >
                      Make main player
                    </button>
                  </span>
                ),
              ],
              isClan && [
                "What to record",
                <select
                  key="scope"
                  className="select"
                  aria-label="What to record"
                  value={clan.scope}
                  onChange={(ev) => only(scope)(ev.target.value)}
                >
                  <option value="comprehensive">
                    {scopeLabel("comprehensive")}
                  </option>
                  <option value="activity">{scopeLabel("activity")}</option>
                </select>,
              ],
              !isClan && [
                "Nickname",
                <>
                  <input
                    className="mono"
                    aria-label="Nickname"
                    placeholder="How you know them"
                    maxLength={40}
                    value={nick ?? claim.nickname ?? ""}
                    onChange={(ev) => setNick(ev.target.value)}
                    onBlur={() => {
                      if (nick == null || nick === (claim.nickname ?? ""))
                        return;
                      only(nickname)(nick.trim() || null);
                    }}
                  />
                  <Note>
                    Private to you, and your agent sees it. It saves when you
                    leave the field.
                  </Note>
                </>,
              ],
              [
                "On your timeline",
                <>
                  <button
                    className="switch"
                    role="switch"
                    aria-checked={
                      (isClan ? clan.notify : claim.notify) ? "true" : "false"
                    }
                    aria-label="On your timeline"
                    onClick={() =>
                      only(notify)(isClan, isClan ? clan.notify : claim.notify)
                    }
                  />
                  <Note>
                    {isClan
                      ? "Include this clan in your timeline. It also decides whether its news appears in your digest."
                      : "Include this player in your timeline. It also decides whether they appear in your digest."}{" "}
                    <Link to={`${SETTINGS}/emails`}>Email settings</Link>
                  </Note>
                </>,
              ],
            ]}
          />
          <WriteError error={failed} className="field-error px-4" />
          <div className="panel__body">{notFound ? null : stop}</div>
        </Panel>

        <Panel title="Recording" titleAs="h2">
          <Facts
            rows={[
              [
                "Recording",
                notFound ? (
                  <span key="value" className="chip chip--bad">
                    <span className="chip__dot" />
                    Tag not found
                  </span>
                ) : recording === "active" ? (
                  <span key="value" className="chip chip--ok">
                    <span className="chip__dot" />
                    Recording
                  </span>
                ) : (
                  <span key="value" className="chip chip--info">
                    <span className="chip__dot" />
                    Starting
                  </span>
                ),
              ],
              [
                "How",
                isClan
                  ? clan.scope === "comprehensive"
                    ? "Roster every 15 min while members are online, backing off when idle. The river race. Each member's battles and profile."
                    : "Roster every 15 min while members are online, backing off when idle. The river race."
                  : "Battle log every 30 min while playing, backing off to 2 hours. Profile daily and after a session.",
              ],
              [
                "Last read",
                notFound
                  ? "No profile: the game does not know this tag"
                  : fresh == null
                    ? "Not read yet"
                    : ago(rec.freshest_poll, now),
              ],
              [
                "Reads, last 24 hours",
                (rec?.fetches_24h ?? 0).toLocaleString(),
              ],
              [
                "Followed since",
                whenDay(isClan ? clan.created_at : rec?.created_at),
              ],
            ]}
          />
        </Panel>
      </div>

      {!isClan && (
        <Panel title="Battle activity" titleAs="h2">
          <ActivityGraph
            data={activity}
            error={activityQuery.error}
            onRetry={activityQuery.refetch}
          />
        </Panel>
      )}
    </div>
  );
}
