import {
  Empty,
  Link,
  PageHead,
  Panel,
  Row,
  Rows,
  Stat,
  Stats,
  Tabs,
  Tag,
  TagText,
  ago,
  useInitialTime,
} from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { ClanReadStatus } from "../../components/ClanReadStatus.jsx";
import { ClaimNotice } from "../../components/ClaimNotice.jsx";
import { FollowCost } from "../../home/follow.jsx";
import { HomeClanOffer } from "../../components/HomeClanOffer.jsx";
import { VerifiedMark } from "../../components/VerifiedMark.jsx";
import { useInvalidate, useMyClans } from "../../lib/queries.js";
import { SETTINGS } from "../../lib/settings.js";
import { tagPath } from "../../lib/tag-url.js";
import { scopeLabel } from "../../lib/words.js";
import { Note } from "./parts.jsx";

/**
 * Players & tracking: the players and clans Elixir records for this account,
 * in two tabs, with a record per tracked thing. The controls live on the
 * record, because a row with four controls in it is a form pretending to be
 * a list. "Tracked", never "subject": the schema's word does not reach the
 * interface.
 */
const TAG_OK = /^#?[0289PYLQGRJCUVO]{3,12}$/i;

const ofLimit = (slot) =>
  slot?.limit == null ? undefined : slot.limit.toLocaleString();

/** "Battle log read 15 min ago, 26 reads in 24 hours" */
function readLine(what, rec, now) {
  if (!rec?.freshest_poll)
    return "Reading its battle log for the first time. Usually within a minute; a few at busy times.";
  const reads = rec.fetches_24h ?? 0;
  return `${what} read ${ago(rec.freshest_poll, now)}, ${reads} ${reads === 1 ? "read" : "reads"} in 24 hours`;
}

/** Where a player stands in the account's slots (#760): free while Elixir
 *  records them for another reason, else one slot. */
function slotLine(c) {
  if (c.slot === "free") return " Free: Elixir already records them.";
  if (c.slot === "used") return " Uses a player slot.";
  return "";
}

function PlayerRow({ claim: c, rec, now }) {
  const you = c.is_primary || c.relationship === "alt";
  const name = c.name ?? null;
  const verified = c.status === "verified";
  const status = c.is_primary
    ? `Your main player.${verified ? " Verified." : " Not verified yet."}`
    : c.relationship === "alt"
      ? `Also you.${verified ? " Verified." : " Not verified yet."}`
      : null;
  return (
    <Row
      title={
        <>
          {c.nickname ?? name ?? <Tag tag={c.player_tag} />}
          {verified ? <VerifiedMark /> : null}
          {c.nickname && name ? <span className="hint"> ({name})</span> : null}
        </>
      }
      detail={
        <>
          {status ? `${status} ` : ""}
          {readLine("Battle log", rec, now)}
          {c.notify === false ? " Off your timeline." : ""}
          {slotLine(c)}
        </>
      }
      right={
        <span className="st-row-actions">
          {you && !verified ? (
            <Link
              className="btn btn--sm"
              to={`${SETTINGS}/players/${tagPath(c.player_tag)}/verify`}
            >
              Verify
            </Link>
          ) : null}
          <Link
            className="btn btn--sm"
            to={`${SETTINGS}/players/${tagPath(c.player_tag)}`}
          >
            Manage
          </Link>
        </span>
      }
    />
  );
}

function AddPlayer({ refresh, navigate, input, first }) {
  const [tag, setTag] = useState("");
  const [relationship, setRelationship] = useState("friend");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async (ev) => {
    ev.preventDefault();
    if (busy) return;
    setErr("");
    setInfo("");
    const raw = tag.trim();
    if (!TAG_OK.test(raw)) {
      setErr("That doesn't look like a CR tag.");
      return;
    }
    setBusy(true);
    try {
      const r = first
        ? await api.addClaim(raw)
        : await api.claimAction({ player_tag: raw, relationship });
      if (!r.ok) {
        setErr(r.data?.message ?? "Could not add. Try again.");
        return;
      }
      setTag("");
      const saved =
        r.data?.player_tag ??
        raw.toUpperCase().replace(/^#/, "").replaceAll("O", "0");
      setInfo("Your player tag was saved.");
      let current;
      try {
        current = await refresh();
      } catch {
        /* The add already succeeded. */
      }
      if (
        !current?.claims?.some((c) => tagPath(c.player_tag) === tagPath(saved))
      ) {
        setInfo(
          "Your tag was saved, but Players & tracking could not refresh. Reload this page to continue. You do not need to add it again.",
        );
        return;
      }
      navigate(`${SETTINGS}/players/${tagPath(saved)}`);
    } catch {
      setErr(
        "Elixir did not answer. Check Players & tracking before retrying; the tag may have been saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={first ? "Your player tag" : "Track a player"} titleAs="h2">
      <form className="panel__body st-form" onSubmit={add}>
        <label>
          Player tag
          <input
            ref={input}
            id="add-player-tag"
            className="mono"
            placeholder="#2PYQ8GJ0"
            aria-describedby="add-player-tag-hint"
            aria-invalid={err ? "true" : undefined}
            disabled={busy}
            value={tag}
            onChange={(ev) => {
              setTag(ev.target.value);
              setErr("");
              setInfo("");
            }}
          />
        </label>
        {/* The very first add needs no answer: it becomes the main player. */}
        {first ? null : (
          <label>
            Add as
            <select
              className="select"
              value={relationship}
              onChange={(ev) => setRelationship(ev.target.value)}
            >
              <option value="friend">Friend</option>
              <option value="watching">Watching</option>
              <option value="alt">Also you</option>
            </select>
          </label>
        )}
        <button className="btn btn--sm" disabled={busy}>
          {busy ? "Adding…" : "Track"}
        </button>
        {first ? null : <FollowCost tag={tag} />}
        <Note id="add-player-tag-hint">
          In Clash Royale, open your profile: the tag starting with # is below
          your name. Adding a tag starts recording, usually within a few
          minutes. Proving a player is yours is a separate step.
          {first
            ? " Your first player becomes your main player, and Elixir follows its clan for you when it can. Proving it's yours is a separate step, under Verify."
            : ""}
        </Note>
        {err ? (
          <p className="field-error w-full" role="alert">
            <TagText>{err}</TagText>
          </p>
        ) : null}
        {info ? (
          <p className="w-full" role="status">
            {info}
          </p>
        ) : null}
      </form>
    </Panel>
  );
}

function Players({ me, refresh, navigate, hash }) {
  const [now] = useInitialTime();
  const claims = me.claims ?? [];
  const recFor = (t) => me.recordings?.find((r) => r.subject_tag === t);
  // A new account that gave no tag at signup lands here (#add-player-tag),
  // and so do Home's and Ladder's "Add your player": the field it came to
  // fill is ready to type in. `hash` is the router's: an in-app move renders
  // this page before the address bar has the new hash.
  const landing =
    hash ??
    (typeof window === "undefined" ? "" : window.location.hash.slice(1));
  const input = useRef(null);
  useEffect(() => {
    if (landing !== "add-player-tag") return;
    input.current?.scrollIntoView?.({ block: "center" });
    input.current?.focus({ preventScroll: true });
  }, [landing]);

  const you = claims.filter((c) => c.is_primary || c.relationship === "alt");
  const friends = claims.filter(
    (c) => !c.is_primary && c.relationship === "friend",
  );
  const watching = claims.filter(
    (c) =>
      !c.is_primary && c.relationship !== "friend" && c.relationship !== "alt",
  );
  const group = (title, note, list) =>
    list.length ? (
      <Panel
        key={title}
        title={title}
        titleAs="h2"
        action={note ? <span className="hint">{note}</span> : null}
      >
        <Rows>
          {list.map((c) => (
            <PlayerRow
              key={c.player_tag}
              claim={c}
              rec={recFor(c.player_tag)}
              now={now}
            />
          ))}
        </Rows>
      </Panel>
    ) : null;

  return (
    <>
      {claims.length === 0 ? (
        <Empty title="No players tracked" titleAs="h2">
          Add the player you play as. Nothing here defaults to you, and the
          first read usually lands within a minute.
        </Empty>
      ) : null}
      <AddPlayer
        refresh={refresh}
        navigate={navigate}
        input={input}
        first={claims.length === 0}
      />
      {group("You", null, you)}
      {group("Friends", "First in your digest", friends)}
      {group("Watching", "In your digest when they played or posted", watching)}
      <HomeClanOffer />
    </>
  );
}

function Clans({ me, query }) {
  const [now] = useInitialTime();
  const clans = query.data ?? null;
  const e = me.entitlements;
  const [clanTag, setClanTag] = useState("");
  const [scope, setScope] = useState("activity");
  const [err, setErr] = useState("");
  const invalidate = useInvalidate();
  const list = clans?.clans ?? [];
  const home = clans?.home_clan?.clan_tag;
  const recFor = (t) => me.recordings?.find((r) => r.subject_tag === t);
  const allowNone =
    e?.activity_clans?.limit === 0 && e?.comprehensive_clans?.limit === 0;
  const free = (slot) => slot?.limit == null || (slot.used ?? 0) < slot.limit;
  const full =
    !allowNone && !free(e?.activity_clans) && !free(e?.comprehensive_clans);
  if (query.isError && !clans) return null;
  const deeper = list.some(
    (c) => c.effective_scope && c.effective_scope !== c.scope,
  );
  return (
    <>
      <Panel title="Track a clan" titleAs="h2">
        {full ? (
          <p className="panel__body m-0">
            {e?.comprehensive_clans?.limit === 0
              ? "Your one clan place is in use. Stop tracking that clan first."
              : "Both your places are in use: stop tracking a clan first."}
          </p>
        ) : (
          <form
            className="panel__body st-form"
            onSubmit={async (ev) => {
              ev.preventDefault();
              setErr("");
              const r = await api.myClanAction({
                action: "add",
                clan_tag: clanTag.trim(),
                scope,
              });
              if (r.ok) {
                setClanTag("");
                invalidate();
              } else setErr(r.data?.message ?? "Could not add. Try again.");
            }}
          >
            <label>
              Clan tag
              <input
                className="mono"
                placeholder="#CLANTAG"
                value={clanTag}
                onChange={(ev) => {
                  setClanTag(ev.target.value);
                  setErr("");
                }}
              />
            </label>
            <label>
              What to record
              <select
                className="select"
                value={scope}
                onChange={(ev) => setScope(ev.target.value)}
              >
                <option value="activity">{scopeLabel("activity")}</option>
                <option
                  value="comprehensive"
                  disabled={e?.comprehensive_clans?.limit === 0}
                >
                  {scopeLabel("comprehensive")}
                </option>
              </select>
            </label>
            <button className="btn btn--sm">Track</button>
            <Note>
              The clan only records its roster, who joins and who goes, and its
              races. Every member also records each member&rsquo;s battles and
              profile.
              {e?.comprehensive_clans?.limit === 0
                ? " Your account includes one clan like this, and none with every member."
                : ""}
            </Note>
            {err ? (
              <p className="field-error w-full" role="alert">
                <TagText>{err}</TagText>
              </p>
            ) : null}
          </form>
        )}
      </Panel>
      {clans && list.length === 0 ? (
        <Empty title="No clans tracked" titleAs="h2">
          Track a clan below, or add your player and Elixir follows their clan
          when it can.
        </Empty>
      ) : null}
      {list.length ? (
        <Panel title="Clans" titleAs="h2">
          <Rows>
            {list.map((c) => {
              const rec = recFor(c.clan_tag);
              const widened =
                c.effective_scope && c.effective_scope !== c.scope;
              return (
                <Row
                  key={c.clan_tag}
                  title={c.name ?? <Tag tag={c.clan_tag} />}
                  detail={
                    <>
                      {c.clan_tag === home ? "Your clan. " : ""}
                      {scopeLabel(c.scope)}
                      {widened ? " †" : ""}.{" "}
                      {rec?.freshest_poll
                        ? `Roster read ${ago(rec.freshest_poll, now)}, ${rec.fetches_24h ?? 0} reads in 24 hours`
                        : "Not read yet."}
                      {c.notify === false ? " Off your timeline." : ""}
                    </>
                  }
                  right={
                    <Link
                      className="btn btn--sm"
                      to={`${SETTINGS}/players/${tagPath(c.clan_tag)}`}
                    >
                      Manage
                    </Link>
                  }
                />
              );
            })}
          </Rows>
        </Panel>
      ) : null}
      {deeper ? (
        <p className="st-foot">
          † Another account records this clan and every member. A shared
          recording runs at the widest scope anyone asked for.
        </p>
      ) : null}
    </>
  );
}

export function Tracking({ me, refresh, navigate, hash, search = "" }) {
  const clansQuery = useMyClans();
  const view =
    new URLSearchParams(search).get("view") === "clans" ? "clans" : "players";
  const e = me.entitlements;
  return (
    <div className="st-page">
      <PageHead
        title="Players & tracking"
        sub="Manage the players and clans Elixir records for you. You and your agents share these places."
      />
      <ClaimNotice me={me} onTracking />
      <Stats>
        <Stat
          label="Players"
          value={(e?.player_slots?.used ?? 0).toLocaleString()}
          of={ofLimit(e?.player_slots)}
          note={
            e?.player_slots?.free
              ? `+${e.player_slots.free.toLocaleString()} free, already recorded`
              : undefined
          }
        />
        <Stat
          label="Clans, the clan only"
          value={(e?.activity_clans?.used ?? 0).toLocaleString()}
          of={ofLimit(e?.activity_clans)}
        />
        <Stat
          label="Clans, every member"
          value={(e?.comprehensive_clans?.used ?? 0).toLocaleString()}
          of={ofLimit(e?.comprehensive_clans)}
        />
      </Stats>
      <Tabs
        label="What you track"
        value={view}
        items={[
          { key: "players", label: "Players", href: `${SETTINGS}/players` },
          {
            key: "clans",
            label: "Clans",
            href: `${SETTINGS}/players?view=clans`,
          },
        ]}
        onSelect={(key) =>
          navigate(`${SETTINGS}/players${key === "clans" ? "?view=clans" : ""}`)
        }
      />
      <ClanReadStatus query={clansQuery} />
      {view === "clans" ? (
        <Clans me={me} query={clansQuery} />
      ) : (
        <Players me={me} refresh={refresh} navigate={navigate} hash={hash} />
      )}
    </div>
  );
}
