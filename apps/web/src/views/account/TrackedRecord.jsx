import { useWrite } from "@elixir-mcp/client";
import {
  ago,
  Icon,
  Link,
  secsSince,
  WriteError,
  writeErrorText,
} from "@elixir-mcp/ui";
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
import { CONSOLE } from "../../lib/console.js";
import { FirstAnswer } from "../../components/FirstAnswer.jsx";
import { HomeClanOffer } from "../../components/HomeClanOffer.jsx";
import { ClanReadStatus } from "../../components/ClanReadStatus.jsx";

/**
 * One tracked player or clan: how you track it, and what that is
 * capturing.
 *
 * The controls live here rather than in the Tracking row. A list row
 * with a nickname field, a relationship select, a notify switch and a
 * remove button in it is a form pretending to be a list, and it makes
 * the one thing a list is for — comparing rows — impossible.
 *
 * "Stop tracking" says what it costs beside itself: the history already
 * recorded is kept, and this only stops new capture. That is the whole
 * reason the word is "stop" and not "delete".
 */
export function TrackedRecord({ me, refresh, navigate, tag }) {
  const clansQuery = useMyClans();
  const clans = clansQuery.data ?? null;
  const [nick, setNick] = useState(null);
  const [now] = useState(() => Date.now());
  const invalidate = useInvalidate();
  const loadClans = () => invalidate();

  const wanted = tagFromPath(tag);
  // Every write on this page, each unwrapped: a refusal is said on the
  // page, and the record refetches only after a write that took. "Make
  // primary" used to clear the removal refusal whatever the server
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
  const claim = (me.claims ?? []).find((c) => c.player_tag === wanted);
  // Canonical year evidence, players only: a clan has no year of its own.
  const tracked = Boolean(claim);
  const activityQuery = useBattleActivity(tracked ? wanted : null);
  const activity = activityQuery.data ?? null;
  const clan = (clans?.clans ?? []).find((c) => c.clan_tag === wanted);
  const rec = me.recordings?.find((r) => r.subject_tag === wanted);

  const crumb = (
    <div className="page__crumb">
      <Link to={`${CONSOLE}/account/tracking`}>‹ Tracking</Link>
    </div>
  );

  if (!claim && !clan) {
    return (
      <>
        {crumb}
        <ClanReadStatus query={clansQuery} />
        {clansQuery.isSuccess && (
          <div className="empty">
            <div className="empty__title">You are not tracking that</div>
            <p className="empty__body" style={{ marginBottom: 0 }}>
              <span className="mono">{wanted}</span> is not on your account. If
              you removed it, the history we already recorded is still there —
              look it up in Explore.
            </p>
          </div>
        )}
      </>
    );
  }

  const isClan = Boolean(clan);
  const name = isClan
    ? (clan.name ?? clan.clan_tag)
    : (claim.nickname ?? claim.name ?? claim.player_tag);
  const fresh = secsSince(rec?.freshest_poll, now);

  return (
    <>
      {crumb}
      {isClan && <ClanReadStatus query={clansQuery} />}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "14px",
          flexWrap: "wrap",
          marginBottom: "18px",
        }}
      >
        <div>
          <h1 className="page__title">
            {name}
            {!isClan && claim?.status === "verified" && (
              <VerifiedMark size={20} />
            )}
          </h1>
          <p className="page__lede">
            <Link
              className="mono"
              to={`${CONSOLE}/explore/${isClan ? "clan" : "player"}/${tagPath(wanted)}`}
            >
              {wanted}
            </Link>
            <span>
              {" · "}
              {isClan ? "clan" : "player"}
              {isClan && clan.member_count
                ? ` · ${clan.member_count} members`
                : ""}
              {!isClan && claim.is_primary ? " · your primary" : ""}
            </span>
          </p>
        </div>
        <button
          className="btn"
          style={{ marginLeft: "auto" }}
          onClick={() =>
            navigate(
              `${CONSOLE}/explore/${isClan ? "clan" : "player"}/${tagPath(wanted)}`,
            )
          }
        >
          <Icon name="search" size={16} />
          Open in Explore
        </button>
      </div>

      {!isClan && (
        <FirstAnswer
          playerTag={wanted}
          claimsKey={`${wanted}:${claim.is_primary}`}
          compact
        />
      )}
      {/* Adding a tag lands here, so the primary's clan is offered here
          too when Elixir could not follow it by itself. */}
      {!isClan && claim.is_primary && <HomeClanOffer className="mb-[18px]" />}

      <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
        <section className="panel" style={{ flex: "1 1 340px" }}>
          <div className="panel__head">How you track it</div>
          <div
            style={{
              padding: "16px",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "14px 16px",
              alignItems: "center",
              fontSize: "13.5px",
            }}
          >
            <span style={{ color: "var(--ink-faint)" }}>Relationship</span>
            <span>
              {isClan ? (
                <span style={{ color: "var(--ink-faint)" }}>
                  a clan is tracked, not related
                </span>
              ) : claim.is_primary ? (
                // Gold marks ownership, and the primary player is the one
                // thing on this account that is unambiguously you.
                <span
                  style={{
                    color: "var(--gold)",
                    fontSize: "12.5px",
                    border: "1px solid var(--warn-edge)",
                    borderRadius: "var(--r-chip)",
                    padding: "5px 10px",
                  }}
                >
                  you
                </span>
              ) : (
                <select
                  className="select"
                  aria-label="Relationship"
                  value={claim.relationship ?? "watching"}
                  onChange={(ev) => only(relationship)(wanted, ev.target.value)}
                >
                  <option value="alt">alt</option>
                  <option value="friend">friend</option>
                  <option value="watching">watching</option>
                </select>
              )}
              {!isClan && !claim.is_primary && (
                // Your primary is "you"; choosing a new one here is how the
                // current primary becomes removable (2026-09-25).
                <button
                  className="btn"
                  style={{ marginLeft: "8px" }}
                  disabled={busy}
                  onClick={() => only(primary)()}
                >
                  Make primary
                </button>
              )}
            </span>

            <span style={{ color: "var(--ink-faint)" }}>Scope</span>
            <span>
              {isClan ? (
                <select
                  className="select"
                  aria-label="Scope"
                  value={clan.scope}
                  onChange={(ev) => only(scope)(ev.target.value)}
                >
                  <option value="comprehensive">comprehensive</option>
                  <option value="activity">activity</option>
                </select>
              ) : (
                <span style={{ color: "var(--ink-faint)" }}>
                  players have one scope
                </span>
              )}
            </span>

            {!isClan && (
              <>
                <span style={{ color: "var(--ink-faint)" }}>Nickname</span>
                <span>
                  <input
                    className="mono"
                    aria-label="Nickname"
                    placeholder="—"
                    maxLength={40}
                    value={nick ?? claim.nickname ?? ""}
                    onChange={(ev) => setNick(ev.target.value)}
                    onBlur={() => {
                      if (nick == null || nick === (claim.nickname ?? ""))
                        return;
                      only(nickname)(nick.trim() || null);
                    }}
                    style={{ width: "11rem" }}
                  />
                  <span
                    className="footnote"
                    style={{ display: "block", marginTop: "4px" }}
                  >
                    Private to you, and your agent sees it.
                  </span>
                </span>
              </>
            )}

            <span style={{ color: "var(--ink-faint)" }}>Notifications</span>
            <span>
              <button
                className="switch"
                role="switch"
                aria-checked={
                  (isClan ? clan.notify : claim.notify) ? "true" : "false"
                }
                aria-label="Notifications"
                onClick={() =>
                  only(notify)(isClan, isClan ? clan.notify : claim.notify)
                }
              />
              <span
                className="footnote"
                style={{ display: "block", marginTop: "4px" }}
              >
                {isClan
                  ? "Include this clan in your timeline. Clan report emails are separate."
                  : "Include this player in your timeline. For friends and watched players, this also controls inclusion in Your friends this week."}{" "}
                <Link to={`${CONSOLE}/account/profile/email`}>
                  Email settings
                </Link>
                .
              </span>
            </span>
          </div>
          <WriteError error={failed} className="field-error px-4" />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
              padding: "13px 16px",
              borderTop: "1px solid var(--line-soft)",
            }}
          >
            <button
              className="btn btn--danger"
              disabled={busy}
              onClick={async () => {
                // Your primary cannot be removed while you track others
                // (409 primary_in_use): the refusal is said beside the
                // button, and the page stays.
                const r = await only(remove)(isClan);
                if (r.ok) navigate(`${CONSOLE}/account/tracking`);
              }}
            >
              Stop tracking
            </button>
            {/* The consequence beside the control: this stops new capture
                and takes nothing away. */}
            <span className="footnote">
              {remove.error
                ? writeErrorText(remove.error)
                : "History already recorded is kept."}
            </span>
          </div>
        </section>

        <section className="panel" style={{ flex: "1 1 300px" }}>
          <div className="panel__head">Capture</div>
          <dl
            style={{
              padding: "16px",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "12px 16px",
              margin: 0,
              fontSize: "13.5px",
            }}
          >
            <dt style={{ color: "var(--ink-faint)" }}>Recording</dt>
            <dd style={{ margin: 0 }}>
              <span
                className={
                  "chip " +
                  ((isClan ? clan.recording_status : rec?.status) === "active"
                    ? "chip--ok"
                    : "chip--info")
                }
              >
                <span className="chip__dot" />
                {(isClan ? clan.recording_status : rec?.status) ?? "off"}
              </span>
            </dd>
            <dt style={{ color: "var(--ink-faint)" }}>How</dt>
            <dd style={{ margin: 0, color: "var(--ink-body)" }}>
              {isClan
                ? clan.scope === "comprehensive"
                  ? "comprehensive — clan roster every 15 min while members are online, backing off when idle; the river race; every member's battles and profile"
                  : "activity — clan roster every 15 min while members are online, backing off when idle; the river race"
                : "battle log every 30 min while playing, backing off to 2 h · profile daily and after a session"}
            </dd>
            <dt style={{ color: "var(--ink-faint)" }}>Freshest poll</dt>
            <dd style={{ margin: 0, color: "var(--ink-body)" }}>
              {/* Never polled is not stale and not zero. */}
              {fresh == null ? "never polled" : ago(rec.freshest_poll, now)}
            </dd>
            <dt style={{ color: "var(--ink-faint)" }}>Fetches, 24h</dt>
            <dd
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                color: "var(--ink-body)",
              }}
            >
              {rec?.fetches_24h ?? "—"}
            </dd>
            <dt style={{ color: "var(--ink-faint)" }}>Tracked since</dt>
            <dd
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                color: "var(--ink-body)",
              }}
            >
              {(isClan ? clan.created_at : rec?.created_at)?.slice(0, 10) ??
                "—"}
            </dd>
          </dl>
        </section>
      </div>

      {!isClan && (
        <section className="panel" style={{ marginTop: "18px" }}>
          <div className="panel__head">Battle activity</div>
          <ActivityGraph
            data={activity}
            error={activityQuery.error}
            onRetry={activityQuery.refetch}
          />
          <p className="footnote" style={{ padding: "0 16px 14px", margin: 0 }}>
            UTC days from canonical battles and comparable profile intervals. A
            whole closed day needs complete capture before an empty count means
            quiet. Hatching means capture is incomplete or unknown; recorded
            battles remain visible.{" "}
            <a href="/docs/activity">How this is drawn</a>
          </p>
        </section>
      )}
    </>
  );
}
