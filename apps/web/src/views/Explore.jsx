import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWrite } from "@elixir-mcp/client";
import {
  agoSeconds,
  freshCls,
  Link,
  stamp,
  TagText,
  useClock,
  WriteError,
  noun,
} from "@elixir-mcp/ui";
import { api } from "../api.js";
import { usePublicStats } from "../lib/queries.js";
import { tagPath, tagFromPath } from "../lib/tag-url.js";
import { CONSOLE, appPath } from "../lib/console.js";

/**
 * Explore — the record browser (design handoff 2026-09-05). Not a
 * reporting product: the agent is the analyst; this page answers "is
 * the data there, and is it right?" A lookup box resolves to records
 * you traverse by clicking references. Every record is one bridge call
 * to the same registry tools agents use — render nothing the contract
 * doesn't return. Deep linking is the feature: every record has a real
 * URL and copy-link reopens exactly this record.
 */

const TAG_RE = /^#?[0-9a-zA-Z]{3,12}$/;
const HASH_RE = /^(deck:)?[0-9a-f]{16,64}$/i;
// A war week is Season and Week, the way the game and the rest of this
// console name it: "S135 W3", "s135w3", "S135-W3". It used to accept only
// an ISO calendar week (2026-W36), which nothing else here uses and the
// page's own hint contradicted, so the advertised form fell through to a
// name search and a miss.
// "136-2", "S136 W2", "136w2" (console walk 2: "136-2" was refused).
const WEEK_RE = /^s?\s*(\d{1,4})\s*(?:[-·]\s*w?|\s*w)\s*(\d{1,2})$/i;

function normTag(q) {
  return "#" + q.trim().toUpperCase().replace(/^#/, "").replaceAll("O", "0");
}
// Tag <-> URL is one seam for the whole app now (lib/tag-url.js).
const encTag = tagPath;
const decTag = tagFromPath;

function Freshness({ meta, derived = false }) {
  // A deck is computed from recorded battles; it has no poll of its own,
  // and borrowing a participant's clock would say "polled 4m ago" about
  // a thing nothing polls.
  if (derived)
    return <span className="freshness freshness--derived">derived</span>;
  const s = meta?.freshness_seconds;
  if (s === null || s === undefined)
    return (
      <span className="freshness freshness--never">poll time unavailable</span>
    );
  return <span className={freshCls(s)}>polled {agoSeconds(s)}</span>;
}

function recent() {
  try {
    return JSON.parse(localStorage.getItem("elixir-recent") || "[]");
  } catch {
    return [];
  }
}
function pushRecent(entry) {
  const cur = recent().filter((r) => r.href !== entry.href);
  cur.unshift(entry);
  localStorage.setItem("elixir-recent", JSON.stringify(cur.slice(0, 6)));
}

/** One bridge call per record — the toolbar shows exactly this call. */
async function fetchRecord(kind, id, cursor) {
  const call = async (tool, args) => {
    const r = await api.explore(tool, args);
    if (!r.ok) throw new Error("request failed");
    if (r.data.is_error) {
      const e = new Error(r.data.body?.error?.message ?? "error");
      e.code = r.data.body?.error?.code;
      throw e;
    }
    return { tool, args, body: r.data.body };
  };
  switch (kind) {
    case "player":
      return call("players_summary", { player_tag: id });
    case "profile":
      return call("players_profile", { player_tag: id });
    case "clan":
      return call("clans_roster", { clan_tag: id });
    case "battle":
      return call("battles_query", { battle_id: id });
    case "deck":
      return call("battles_query", { deck_hash: id, limit: 10 });
    case "week": {
      // The exact week, by name. This read the
      // last 12 seasons and searched them, so an older week answered
      // "not in the recorded log" although the record held it, and the
      // page could show none of the week's own tables.
      const [clan, season, section] = id.split("~");
      const res = await call("war_history", {
        clan_tag: decTag(clan),
        season_id: Number(season),
        section_index: Number(section),
      });
      if ((res.body.weeks ?? []).length === 0) {
        // The tool says which side of the record the week is on.
        const e = new Error(
          res.body.notes?.[0] ?? "That war week is not in the recorded log.",
        );
        e.code = "not_found";
        throw e;
      }
      return res;
    }
    case "list": {
      const [what, key] = id.split(":");
      if (what === "battles")
        return call("battles_query", {
          player_tag: decTag(key),
          verbosity: "compact",
          include_total: true,
          ...(cursor ? { cursor } : {}),
        });
      if (what === "decks")
        // Compact and bounded, or a busy player's list ran past the
        // 48,000-character cap (console walk 2).
        return call("battles_decks", {
          player_tag: decTag(key),
          verbosity: "compact",
          limit: 20,
        });
      if (what === "members")
        return call("clans_roster", { clan_tag: decTag(key) });
      if (what === "weeks")
        return call("war_history", { clan_tag: decTag(key), seasons: 12 });
      if (what === "deckbattles")
        return call("battles_query", {
          deck_hash: key,
          verbosity: "compact",
          include_total: true,
        });
      throw new Error(`unknown list ${what}`);
    }
    default:
      throw new Error(`unknown record kind ${kind}`);
  }
}

function callString(tool, args) {
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `${tool}(${parts.join(", ")})`;
}

function NicknameEditor({ nick, onSaved }) {
  const [value, setValue] = useState(nick.current ?? "");
  // A refused save says so; the record refetches only after one that
  // took.
  const write = useWrite((v) => api.setNickname(nick.tag, v), {
    invalidate: () => onSaved(),
  });
  const busy = write.busy;
  const save = (v) => write.run(v);
  return (
    <div className="panel__actions">
      <span style={{ fontSize: "12px", color: "var(--ink-faint)" }}>
        Your nickname
      </span>
      <input
        value={value}
        maxLength={40}
        placeholder="how YOU know them"
        onChange={(e) => setValue(e.target.value)}
        style={{ flex: "0 1 180px" }}
      />
      <button
        className="btn btn--quiet"
        disabled={busy || value.trim() === (nick.current ?? "")}
        onClick={() => save(value.trim() || null)}
      >
        Save
      </button>
      {nick.current && (
        <button
          className="btn--text"
          disabled={busy}
          onClick={() => save(null)}
        >
          Clear
        </button>
      )}
      <span
        style={{
          marginLeft: "auto",
          fontSize: "11.5px",
          color: "var(--ink-faint)",
        }}
      >
        private to your account
      </span>
      <WriteError error={write.error} className="field-error basis-full" />
    </div>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn--text"
      onClick={() => {
        navigator.clipboard?.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "copied" : "copy link"}
    </button>
  );
}

/**
 * The four kinds the rail offers under Explore. They are ways INTO the
 * lookup, not record pages: each one says what it can answer and how to
 * ask, because "Players" with an empty search box tells a reader
 * nothing about what is in the corpus.
 */
const BROWSE = {
  players: {
    title: "Players",
    lede: "Anyone the record knows — the players it records, and every opponent they have met, known from that battle alone.",
    hint: "Paste a player tag, or type a name or one of your nicknames.",
    placeholder: "#2PYQ8GJ0",
  },
  clans: {
    title: "Clans & wars",
    lede: "A clan's roster as we last saw it, and its river races week by week.",
    hint: "Paste a clan tag. War weeks are Season and Week, never a calendar date.",
    placeholder: "#J2RGCRVG",
  },
  meta: {
    title: "Decks",
    lede: "Decks by the hash that identifies them, and how they have actually done.",
    hint: "Paste a deck hash, or open one from a battle.",
    placeholder: "deck:8f21c4…",
  },
  weeks: {
    title: "War weeks",
    lede: "One river race: the five clans' standings, fame and the finish.",
    hint: "Type a week as S135 W3, or open one from a clan.",
    placeholder: "S135 W3",
  },
};

export function Explore({ me, navigate, path, search = {} }) {
  // /explore | /explore/<browse> | /explore/:kind/:id(+), under the prefix
  const segs = (appPath(path) ?? "").split("/").filter(Boolean).slice(1); // after 'explore'
  const kind = segs[0] ?? null;
  const id = segs.slice(1).join("/") ?? null;

  if (!kind) return <Lookup me={me} navigate={navigate} />;
  // A rail sub-page: the lookup, scoped and titled. Without this the
  // rail's four kinds fell through to a record page with no id.
  if (BROWSE[kind] && !id)
    return <Lookup me={me} navigate={navigate} browse={BROWSE[kind]} />;
  return (
    <RecordPage
      key={path}
      me={me}
      navigate={navigate}
      kind={kind}
      rawId={id}
      search={search}
    />
  );
}

/* ── Lookup ──────────────────────────────────────────────── */

/** The trail restarts from the lookup: a record reached from here is the
 *  first crumb, whether by a lookup or a link in the lists below. */
function restartTrail() {
  sessionStorage.removeItem("elixir-trail");
}

function Lookup({ me, navigate, browse }) {
  const [q, setQ] = useState("");
  const [miss, setMiss] = useState(null);
  const [failure, setFailure] = useState(null);
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);
  const corpus = usePublicStats().data?.totals ?? null;
  const queryClient = useQueryClient();

  // The probe that resolved a tag IS the record's call (review 2026-09-27
  // §7.5): seed the record page's cache with it, under the key and args
  // fetchRecord uses, so a lookup costs one call and not two.
  const seed = (kind, id, tool, args, body) =>
    queryClient.setQueryData(["explore", kind, id], { tool, args, body });

  const go = useCallback(
    (kind, recId) => {
      restartTrail();
      navigate(`${CONSOLE}/explore/${kind}/${recId}`);
    },
    [navigate],
  );

  // A failed read is not "no records" (console audit M1): a quota or rate
  // refusal, or no answer at all, is said as what it is, with the
  // server's own message.
  const FAILURE_CODES = [
    "quota_exceeded",
    "rate_limited",
    "internal",
    "timeout",
    "upstream_unavailable",
  ];
  const failureOf = (r) => {
    if (!r.ok)
      return (
        r.data?.message ??
        "Elixir did not answer just now; try again in a moment."
      );
    const err = r.data?.is_error ? r.data.body?.error : null;
    return err && FAILURE_CODES.includes(err.code)
      ? (err.message ?? err.code)
      : null;
  };
  const searchNames = async (query) => {
    const r = await api.explore("players_search", { query, limit: 8 });
    const failed = failureOf(r);
    if (failed) {
      setFailure(failed);
      return true;
    }
    if (r.data.is_error) return false;
    const found = r.data.body?.matches ?? [];
    if (found.length === 0) return false;
    if (found.length === 1) {
      go("player", encTag(found[0].player_tag));
      return true;
    }
    setMatches({ query, found });
    return true;
  };

  const resolve = async (raw) => {
    const query = raw.trim();
    if (!query) return;
    setBusy(true);
    setMiss(null);
    setFailure(null);
    setMatches(null);
    try {
      if (HASH_RE.test(query)) {
        go("deck", query.replace(/^deck:/i, "").toLowerCase());
        return;
      }
      const week = WEEK_RE.exec(query);
      if (week) {
        // A week on its own names the reader's home clan's race; the
        // record page says so if that week is not in the log.
        const mine = await api.myClans();
        const home = mine.ok ? mine.data.home_clan?.clan_tag : null;
        if (home) {
          const season = Number(week[1]);
          const section = Number(week[2]) - 1;
          go("week", `${encTag(home)}~${season}~${section}`);
          return;
        }
        setMiss(query);
        return;
      }
      if (TAG_RE.test(query)) {
        const tag = normTag(query);
        const p = await api.explore("players_summary", { player_tag: tag });
        const failed = failureOf(p);
        if (failed) {
          setFailure(failed);
          return;
        }
        if (p.ok && !p.data.is_error) {
          const id = encTag(tag);
          seed(
            "player",
            id,
            "players_summary",
            { player_tag: id },
            p.data.body,
          );
          go("player", id);
          return;
        }
        const c = await api.explore("clans_roster", { clan_tag: tag });
        if (c.ok && !c.data.is_error) {
          const id = encTag(tag);
          seed("clan", id, "clans_roster", { clan_tag: id }, c.data.body);
          go("clan", id);
          return;
        }
        // Not a recorded tag - maybe it was a NAME all along ("tyler").
        if (await searchNames(query)) return;
        setMiss(tag);
        return;
      }
      // Names and nicknames resolve too - players_search ranks YOUR
      // nicknames first, then your people, then the corpus.
      if (await searchNames(query)) return;
      setMiss(query);
    } finally {
      setBusy(false);
    }
  };

  const tryChips = [
    ...(me?.claims?.[0]
      ? [
          {
            label:
              me.claims[0].nickname ??
              me.claims[0].name ??
              me.claims[0].player_tag,
            q: me.claims[0].player_tag,
          },
        ]
      : []),
  ];

  return (
    <>
      <div style={{ maxWidth: "620px", padding: "8px 0" }}>
        <h1 className="page__title">{browse?.title ?? "Explore"}</h1>
        <p className="page__lede">
          {browse
            ? `${browse.lede} ${browse.hint}`
            : "Paste any tag to land on the record we hold for it — a player, a clan, a deck hash or a war week — or type a name or one of your nicknames. When your agent says something surprising, this is where you go and check."}
        </p>
        <form
          style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            resolve(q);
          }}
        >
          <input
            className="mono"
            aria-label="Look up a record"
            placeholder={browse?.placeholder ?? "#2PYQ8GJ0"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{
              flex: "1 1 240px",
              padding: "11px 12px",
              fontSize: "14px",
            }}
          />
          <button
            className="btn"
            disabled={busy}
            style={{ padding: "11px 18px" }}
          >
            {busy ? "Looking…" : "Look up"}
          </button>
        </form>
        {tryChips.length > 0 && (
          <div
            className="mono"
            style={{
              display: "flex",
              gap: "8px",
              marginTop: "10px",
              flexWrap: "wrap",
              color: "var(--ink-faint)",
              fontSize: "11.5px",
            }}
          >
            <span>try:</span>
            {tryChips.map((t) => (
              <button
                type="button"
                className="link"
                key={t.label}
                onClick={() => resolve(t.q)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        {matches && (
          <div
            className="panel"
            style={{ marginTop: "18px", overflow: "hidden" }}
          >
            <div className="panel__head">
              <span className="panel-title">
                {matches.found.length}{" "}
                {matches.found.length === 1
                  ? "player matches"
                  : "players match"}
              </span>
              <span
                className="mono"
                style={{
                  marginLeft: "auto",
                  fontSize: "11px",
                  color: "var(--ink-faint)",
                }}
              >
                &ldquo;{matches.query}&rdquo;
              </span>
            </div>
            {matches.found.map((m) => (
              <Link
                key={m.player_tag}
                to={`${CONSOLE}/explore/player/${encTag(m.player_tag)}`}
                onClick={restartTrail}
                style={{
                  display: "flex",
                  gap: "10px",
                  padding: "10px 16px",
                  borderTop: "1px solid var(--line-soft)",
                  fontSize: "12.5px",
                  color: "var(--ink)",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <span style={{ fontWeight: 600 }}>{m.name ?? "—"}</span>
                {m.nickname && (
                  <span className="tag-chip">&ldquo;{m.nickname}&rdquo;</span>
                )}
                <span className="tag">{m.player_tag}</span>
                <span className="kind-chip">{m.source}</span>
                {m.clan_tag && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: "11px",
                      color: "var(--ink-faint)",
                    }}
                  >
                    {m.clan_name ? `${m.clan_name} ` : ""}
                    <span className="mono">{m.clan_tag}</span>
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
        {failure && (
          <div className="empty" style={{ textAlign: "left" }}>
            <div className="empty__title">That lookup could not run</div>
            <div className="empty__body" style={{ textAlign: "left" }}>
              <TagText>{failure}</TagText>
            </div>
          </div>
        )}
        {miss && !failure && (
          <div
            className="empty"
            style={{
              marginTop: "18px",
              textAlign: "left",
              padding: "14px 16px",
            }}
          >
            <div
              style={{ display: "flex", gap: "10px", alignItems: "baseline" }}
            >
              <span className="tag">{miss}</span>
              <span
                className="mono"
                style={{
                  color: "var(--bad)",
                  fontWeight: 600,
                  fontSize: "11.5px",
                }}
              >
                no records
              </span>
            </div>
            <div className="empty__body" style={{ textAlign: "left" }}>
              Nothing in the corpus matches that tag or name. Elixir records the
              players and clans someone added, and the game&rsquo;s
              leaderboards; it does not crawl the whole game. Add it from{" "}
              <Link to={`${CONSOLE}/account/tracking`}>Account ▸ Tracking</Link>{" "}
              and recording starts on the next poll.
            </div>
          </div>
        )}
      </div>

      <div className="cols" style={{ marginTop: "28px" }}>
        <section className="panel" style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div className="panel__head">
            <span className="panel-title">Recent lookups</span>
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontSize: "11px",
                color: "var(--ink-faint)",
              }}
            >
              this browser only
            </span>
          </div>
          {recent().length === 0 && (
            <div className="panel__body" style={{ color: "var(--ink-faint)" }}>
              Nothing yet.
            </div>
          )}
          {recent().map((r) => (
            <Link
              key={r.href}
              to={r.href}
              style={{
                display: "flex",
                gap: "10px",
                padding: "10px 16px",
                borderTop: "1px solid var(--line-soft)",
                fontSize: "12.5px",
                color: "var(--ink)",
                flexWrap: "wrap",
              }}
            >
              <span className="tag">{r.tag}</span>
              <span style={{ color: "var(--ink-faint)" }}>
                <TagText>{r.name}</TagText>
              </span>
              <span className="kind-chip">{r.kind}</span>
            </Link>
          ))}
        </section>

        <section className="panel" style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div className="panel__head">
            <span className="panel-title">What the corpus holds</span>
            <Link
              to={`${CONSOLE}/data/dashboard`}
              className="mono"
              style={{ marginLeft: "auto", fontSize: "11px" }}
            >
              Data ›
            </Link>
          </div>
          <div className="panel__body">
            {corpus && (
              <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
                {[
                  // Recorded counts are the headline (DECISIONS: ghost
                  // players are not metrics); a player or clan known
                  // only from a battle stub names an opponent, no more.
                  ["battles", corpus.battles],
                  ["players recorded", corpus.players_recording],
                  ["clans recorded", corpus.clans_recording],
                ].map(([label, v]) => (
                  <div key={label}>
                    <div className="stat__label">{label}</div>
                    <div className="stat__value">{v?.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="panel__note">
            Explore is a coverage check, not a report — your agent is the
            analyst.
          </div>
        </section>
      </div>
    </>
  );
}

/* ── Record page ─────────────────────────────────────────── */

function loadTrail() {
  try {
    return JSON.parse(sessionStorage.getItem("elixir-trail") || "[]");
  } catch {
    return [];
  }
}
function saveTrail(t) {
  sessionStorage.setItem("elixir-trail", JSON.stringify(t));
}

/** A record's table: plain rows, and a reference cell is a Link. */
function RecordTable({ table }) {
  return (
    <div className="table__scroll" tabIndex={0}>
      <table className="table" style={{ minWidth: "640px" }}>
        <thead>
          <tr>
            {table.cols.map((c) => (
              <th key={c.label} className={c.num ? "num" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={table.cols[j].num ? "num" : undefined}>
                  {cell.href ? (
                    <Link
                      className={cell.mono ? "tag" : undefined}
                      to={cell.href}
                      style={cell.style}
                    >
                      <TagText>{cell.text}</TagText>
                    </Link>
                  ) : (
                    <span
                      className={
                        cell.outcome
                          ? `outcome outcome--${cell.outcome}`
                          : cell.mono
                            ? "tag"
                            : cell.nil
                              ? "nil"
                              : undefined
                      }
                      style={cell.style}
                    >
                      <TagText>{cell.text}</TagText>
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordPage({ me, kind, rawId, search }) {
  const pageable = kind === "list" && rawId.startsWith("battles:");
  const cursor =
    pageable && typeof search?.cursor === "string" ? search.cursor : null;
  const [raw, setRaw] = useState(false);
  const href = `${CONSOLE}/explore/${kind}/${rawId}`;

  // One record, one bridge call, cached by its address: Back to a record
  // you just left is served from the cache, and a saved nickname
  // refetches it. A tool error carries its code on the Error.
  const record = useQuery({
    queryKey: ["explore", kind, rawId, ...(cursor ? [cursor] : [])],
    queryFn: () => fetchRecord(kind, rawId, cursor),
  });
  const res = record.data;
  const { zone } = useClock();
  const view = useMemo(
    () => (res ? buildView(kind, rawId, res, me, zone) : null),
    [kind, rawId, res, me, zone],
  );

  // The trail and the recent list are written when a record ARRIVES,
  // which is the only moment a visit is a fact: truncate on revisit,
  // else append.
  const [trail, setTrail] = useState(loadTrail);
  useEffect(() => {
    if (!view) return;
    let next = loadTrail();
    const at = next.findIndex((c) => c.href === href);
    if (at >= 0) next = next.slice(0, at + 1);
    else next = [...next, { href, label: view.crumb }];
    saveTrail(next);
    setTrail(next);
    pushRecent({
      href,
      tag: view.tag ?? "",
      name: view.title,
      kind: view.kindLabel.toLowerCase(),
    });
  }, [view, href]);

  if (record.isPending)
    return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  if (record.isError) {
    const code = record.error.code;
    return (
      <div className="empty" style={{ maxWidth: "560px", margin: "32px auto" }}>
        <div className="empty__mark">×</div>
        <div className="empty__title">
          {code === "not_recorded" || code === "not_found"
            ? "No records"
            : "Could not load this record"}
        </div>
        <div className="empty__body">
          <TagText>{record.error.message}</TagText>{" "}
          <Link to={`${CONSOLE}/explore`}>Back to lookup</Link>
        </div>
        <button className="btn btn--sm" onClick={() => record.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="trail">
        <Link to={`${CONSOLE}/explore`}>corpus</Link>
        {trail.map((c, i) => (
          <span key={c.href} style={{ display: "contents" }}>
            <span className="trail__sep">/</span>
            <Link
              aria-current={i === trail.length - 1 ? "page" : undefined}
              to={c.href}
            >
              <TagText>{c.label}</TagText>
            </Link>
          </span>
        ))}
      </div>

      <div className="record__head">
        <span className="label" style={{ flexBasis: "100%" }}>
          {view.kindLabel} record
        </span>
        <h1 className="page__title" style={{ fontSize: "28px" }}>
          {/* A record with no name is titled by its tag, in the display
              face: TagText draws it so a 0 never reads as an O. */}
          <TagText>{view.title}</TagText>
        </h1>
        {view.tag && <span className="tag">{view.tag}</span>}
        {view.nickEdit?.current && (
          <span className="tag-chip" title="your private nickname">
            &ldquo;{view.nickEdit.current}&rdquo;
          </span>
        )}
        {view.chip && (
          <span className={`chip ${view.chip.cls ?? ""}`}>
            {view.chip.label}
          </span>
        )}
        <span
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          {view.action && (
            <Link className="btn btn--sm" to={view.action.href}>
              {view.action.label}
            </Link>
          )}
          <Freshness meta={res.body.meta} derived={view.kindLabel === "DECK"} />
        </span>
      </div>
      {view.sub && (
        <div className="record__sub">
          <TagText>{view.sub}</TagText>
        </div>
      )}

      {view.table && (
        <section>
          {/* Bare on the page: a record's table is interface, and a card
              around it makes the page read as a report. */}
          <RecordTable table={view.table} />
          {view.note && <div className="panel__note">{view.note}</div>}
        </section>
      )}

      {pageable && (
        <nav aria-label="Battle pages" className="my-4 flex flex-wrap gap-4">
          {cursor && <Link to={href}>Newest battles ›</Link>}
          {/* battles_query's next_cursor is null on the last page; it
              returns no has_more. */}
          {res.body.next_cursor && (
            <Link
              to={`${href}?cursor=${encodeURIComponent(res.body.next_cursor)}`}
            >
              Older battles ›
            </Link>
          )}
        </nav>
      )}

      {view.fields && (
        <div className="cols">
          <section className="panel" style={{ flex: "1 1 380px", minWidth: 0 }}>
            <div className="panel__head">
              <span className="panel-title">Fields</span>
              <span
                className="mono"
                style={{
                  marginLeft: "auto",
                  fontSize: "11px",
                  color: "var(--ink-faint)",
                }}
              >
                references are links
              </span>
            </div>
            <dl className="fields" style={{ margin: 0 }}>
              {view.fields.map((f) => (
                <span key={f.label} style={{ display: "contents" }}>
                  <dt>{f.label}</dt>
                  <dd>
                    {f.href ? (
                      <Link className={f.mono ? "tag" : undefined} to={f.href}>
                        <TagText>{f.value}</TagText>
                      </Link>
                    ) : (
                      <span className={f.mono ? "tag" : undefined}>
                        <TagText>{f.value}</TagText>
                      </span>
                    )}{" "}
                    {f.hint && <span className="hint">{f.hint}</span>}
                    {f.sample && <span className="sample">{f.sample}</span>}
                  </dd>
                </span>
              ))}
            </dl>
            {view.nickEdit && (
              <NicknameEditor
                nick={view.nickEdit}
                onSaved={() => record.refetch()}
              />
            )}
            {view.note && <div className="panel__note">{view.note}</div>}
          </section>

          {view.tiles?.length > 0 && (
            <section
              className="panel"
              style={{ flex: "1 1 280px", minWidth: 0 }}
            >
              <div className="panel__head">
                <span className="panel-title">What we have</span>
              </div>
              <div className="tiles">
                {view.tiles.map((t) =>
                  t.href ? (
                    <Link key={t.label} className="tile" to={t.href}>
                      <span
                        className={
                          typeof t.value === "number"
                            ? "stat__value"
                            : "stat__value--text"
                        }
                        style={{
                          fontSize:
                            typeof t.value === "number" ? "22px" : undefined,
                        }}
                      >
                        {typeof t.value === "number"
                          ? t.value.toLocaleString()
                          : t.value}
                      </span>
                      <span className="tile__label">{t.label} ›</span>
                    </Link>
                  ) : (
                    <div key={t.label} className="tile">
                      <span
                        className="stat__value"
                        style={{ fontSize: "22px" }}
                      >
                        {typeof t.value === "number"
                          ? t.value.toLocaleString()
                          : t.value}
                      </span>
                      <span className="tile__label">{t.label}</span>
                    </div>
                  ),
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {view.tables?.map((t) => (
        <section key={t.title} className="mt-5">
          <h2 className="panel-title mb-2">{t.title}</h2>
          <RecordTable table={t} />
        </section>
      ))}

      {/* Every record shows the call that produced it. The parity claim
          is the point: this is the same call your agent makes, with your
          entitlements applied, and the raw body is what it receives —
          so nothing on the page can be something the contract does not
          return. */}
      <section className="code" style={{ marginTop: "20px" }}>
        <div className="code__head">
          <span className="label">tool call</span>
          <code style={{ color: "var(--ink-code)" }}>
            {callString(res.tool, res.args)}
          </code>
          <span style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
            <button className="btn btn--sm" onClick={() => setRaw(!raw)}>
              {raw ? "Hide raw" : "Raw response"}
            </button>
            <CopyLink />
          </span>
        </div>
        {raw && (
          <pre className="code__body">{JSON.stringify(res.body, null, 1)}</pre>
        )}
        <div className="panel__foot">
          One tool call produced this page — the same one your agent makes, with
          your entitlements applied.
        </div>
      </section>
    </>
  );
}

/* ── View builders: shape each record from the REAL payload ── */

function buildView(kind, rawId, res, me, zone) {
  const b = res.body;
  const meFirstTag = me?.claims?.find((c) => c.is_primary)?.player_tag;
  const fmt = (t) => stamp(t, zone, { year: true });

  if (kind === "profile") {
    const tag = decTag(rawId);
    const snapshot = b.snapshot ?? {};
    return {
      kindLabel: "PROFILE",
      crumb: `profile · ${b.name ?? tag}`,
      title: `Recorded profile · ${b.name ?? tag}`,
      tag,
      sub: `Saved profile from ${snapshot.date ?? "an unknown date"}. These are snapshot facts, not a current-season battle record.`,
      fields: [
        { label: "Player tag", value: tag, mono: true },
        { label: "Profile date", value: snapshot.date ?? "unknown" },
        {
          label: "Trophies",
          value:
            snapshot.trophies == null
              ? "unknown"
              : snapshot.trophies.toLocaleString(),
        },
        ...Object.entries(snapshot.lifetime ?? {}).map(([key, value]) => ({
          label: `Lifetime ${key
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replaceAll("_", " ")
            .toLowerCase()}`,
          value: value == null ? "unknown" : value.toLocaleString(),
        })),
      ],
      tiles: [
        {
          label: "recorded battles",
          value: "browse",
          href: `${CONSOLE}/explore/list/battles:${encTag(tag)}`,
        },
      ],
      note: "A profile's lifetime counters are separate from the battles Elixir captured. Missing captures remain unknown.",
    };
  }

  if (kind === "player") {
    const tag = decTag(rawId);
    const yours = tag === meFirstTag;
    const fields = [];
    if (b.name !== undefined)
      fields.push({ label: "name", value: b.name ?? "—" });
    fields.push({ label: "player_tag", value: tag, mono: true });
    if (b.clan?.tag ?? b.clan_tag)
      fields.push({
        label: "clan_tag",
        value: b.clan?.tag ?? b.clan_tag,
        mono: true,
        href: `${CONSOLE}/explore/clan/${encTag(b.clan?.tag ?? b.clan_tag)}`,
        hint: b.clan?.name,
      });
    if (b.trophies !== undefined)
      fields.push({ label: "trophies", value: String(b.trophies) });
    if (b.last_30_days) {
      const r = b.last_30_days;
      fields.push({
        label: "last 30 days",
        value: `${r.wins}–${r.losses}${r.draws ? `–${r.draws}` : ""}`,
        sample:
          (r.wins ?? 0) + (r.losses ?? 0) < 10
            ? "n<10"
            : `n=${r.wins + r.losses}`,
      });
    }
    if (b.most_played_deck?.deck_hash)
      fields.push({
        label: "top deck",
        value: b.most_played_deck.deck_hash.slice(0, 12) + "…",
        mono: true,
        href: `${CONSOLE}/explore/deck/${b.most_played_deck.deck_hash}`,
      });
    return {
      kindLabel: "PLAYER",
      crumb: `${b.nickname ?? b.name ?? tag} ${tag}`,
      title: (yours ? "★ " : "") + (b.name ?? tag),
      tag,
      nickEdit: { tag, current: b.nickname ?? null },
      chip: yours
        ? { label: "tracked by you", cls: "chip--ok" }
        : b.meta?.recording_active_since
          ? { label: "recording", cls: "chip--ok" }
          : { label: "observed only" },
      // The record you own has its controls one click away, on the page
      // that holds them; nothing here edits.
      action: yours
        ? {
            label: "Manage tracking",
            href: `${CONSOLE}/account/tracking/${encTag(tag)}`,
          }
        : null,
      sub: "What the recorder holds for this player. Coverage tiles open the underlying records.",
      fields,
      tiles: [
        {
          label: "recorded profile",
          value: "view",
          href: `${CONSOLE}/explore/profile/${encTag(tag)}`,
        },
        {
          label: "battles",
          value: "browse",
          href: `${CONSOLE}/explore/list/battles:${encTag(tag)}`,
        },
        {
          label: "decks",
          value: "browse",
          href: `${CONSOLE}/explore/list/decks:${encTag(tag)}`,
        },
      ],
      note: b.note,
    };
  }

  if (kind === "clan") {
    const tag = decTag(rawId);
    const members = b.members ?? [];
    return {
      kindLabel: "CLAN",
      crumb: `${b.name ?? tag} ${tag}`,
      title: b.name ?? tag,
      tag,
      chip: { label: "recorded", cls: "chip--ok" },
      sub: "The clan as recorded: roster and war history.",
      fields: [
        { label: "name", value: b.name ?? "—" },
        { label: "clan_tag", value: tag, mono: true },
        { label: "members", value: String(members.length) },
      ],
      tiles: [
        {
          label: "members",
          value: members.length,
          href: `${CONSOLE}/explore/list/members:${encTag(tag)}`,
        },
        {
          label: "war weeks",
          value: "browse",
          href: `${CONSOLE}/explore/list/weeks:${encTag(tag)}`,
        },
      ],
      note: b.note,
    };
  }

  if (kind === "battle") {
    const bt = b.battles?.[0];
    if (!bt) {
      const e = new Error("battle not found");
      e.code = "not_found";
      throw e;
    }
    const myTag = bt.me.player_tag ?? b.player_tag;
    const myName = bt.me.name ?? b.name ?? null;
    const opp = bt.opponents?.[0];
    const page = battlePath(bt.url);
    const fields = [
      { label: "battle_time", value: fmt(bt.battle_time) },
      // The public page for this battle, the link to hand a person.
      ...(page ? [{ label: "page", value: page, mono: true, href: page }] : []),
      { label: "type", value: bt.type },
      { label: "game_mode", value: bt.game_mode?.name ?? "—" },
      // arena is {id, name} since the contract named arenas; rendering
      // the object crashed every battle record (console walk 2).
      ...(bt.arena
        ? [
            {
              label: "arena",
              value:
                typeof bt.arena === "object"
                  ? (bt.arena.name ?? String(bt.arena.id))
                  : String(bt.arena),
            },
          ]
        : []),
      {
        label: "player",
        value: myTag,
        mono: true,
        href: `${CONSOLE}/explore/player/${encTag(myTag)}`,
        hint: myName,
      },
      ...(opp
        ? [
            {
              label: "opponent_tag",
              value: opp.player_tag,
              mono: true,
              href: `${CONSOLE}/explore/player/${encTag(opp.player_tag)}`,
              hint: opp.name,
            },
          ]
        : []),
      { label: "crowns", value: `${bt.me.crowns}–${opp?.crowns ?? "?"}` },
      ...(bt.me.trophy_change !== null && bt.me.trophy_change !== undefined
        ? [{ label: "trophy_change", value: String(bt.me.trophy_change) }]
        : []),
      ...(bt.me.deck_hash
        ? [
            {
              label: "deck_hash",
              value: bt.me.deck_hash.slice(0, 16) + "…",
              mono: true,
              href: `${CONSOLE}/explore/deck/${bt.me.deck_hash}`,
            },
          ]
        : []),
      ...(opp?.deck_hash
        ? [
            {
              label: "opp deck_hash",
              value: opp.deck_hash.slice(0, 16) + "…",
              mono: true,
              href: `${CONSOLE}/explore/deck/${opp.deck_hash}`,
            },
          ]
        : []),
    ];
    return {
      kindLabel: "BATTLE",
      crumb: `battle ${fmt(bt.battle_time)}`,
      title: `battle ${fmt(bt.battle_time)}`,
      tag: null,
      chip: bt.me.outcome
        ? {
            label: bt.me.outcome,
            cls:
              bt.me.outcome === "win"
                ? "chip--ok"
                : bt.me.outcome === "loss"
                  ? "chip--bad"
                  : "",
          }
        : null,
      sub: `As recorded from ${myName ? `${myName} ${myTag}` : myTag}'s perspective. A battle has no children — every value here is the record itself.`,
      fields,
      tiles: [],
      note: b.card_legend,
    };
  }

  if (kind === "deck") {
    const ds = b.deck_stats ?? {};
    const cards =
      b.battles?.[0]?.me?.deck?.cards?.map((c) => c.name).join(", ") ?? null;
    return {
      kindLabel: "DECK",
      crumb: `deck ${rawId.slice(0, 10)}…`,
      title: `deck ${rawId.slice(0, 10)}…`,
      tag: null,
      chip: { label: "public" },
      sub: "One exact deck identity across the whole corpus.",
      fields: [
        { label: "deck_hash", value: rawId, mono: true },
        ...(cards ? [{ label: "cards", value: cards }] : []),
        { label: "battles", value: String(ds.battles ?? 0) },
        { label: "record", value: `${ds.wins ?? 0}–${ds.losses ?? 0}` },
        { label: "distinct players", value: String(ds.players ?? 0) },
        { label: "first used", value: fmt(ds.first_used) },
        { label: "last used", value: fmt(ds.last_used) },
      ],
      tiles: [
        {
          label: "battles with this deck",
          value: ds.battles ?? 0,
          href: `${CONSOLE}/explore/list/deckbattles:${rawId}`,
        },
      ],
      note: b.deck_note,
    };
  }

  if (kind === "week") {
    // fetchRecord asked for this exact week and refuses an empty answer.
    const wk = b.weeks[0];
    const week = Number(wk.section_index) + 1;
    const n = (v) =>
      v === null || v === undefined
        ? { text: "—", nil: true }
        : { text: String(v) };
    const clan = (c) => ({
      text: c.name ?? c.clan_tag,
      href: c.clan_tag
        ? `${CONSOLE}/explore/clan/${encTag(c.clan_tag)}`
        : undefined,
    });
    const standings = b.standings ?? [];
    const days = (b.days ?? []).flatMap((d) =>
      (d.standings ?? []).map((c) => [
        { text: `Day ${d.war_day}` },
        n(c.rank),
        clan(c),
        n(c.points_earned),
        n(c.progress_end),
        n(c.defenses_remaining),
      ]),
    );
    const members = b.member_weeks ?? [];
    return {
      kindLabel: "WAR WEEK",
      crumb: `S${wk.season_id} W${week}`,
      title: `Season ${wk.season_id}, week ${week}`,
      tag: b.clan_tag,
      chip: wk.is_colosseum
        ? { label: "colosseum", cls: "chip--warn" }
        : wk.in_progress
          ? { label: "in progress" }
          : null,
      sub: "One recorded river race: the clans in it, day by day, and who fought.",
      fields: [
        { label: "season", value: String(wk.season_id) },
        { label: "week", value: String(week) },
        ...(wk.our_rank !== null && wk.our_rank !== undefined
          ? [{ label: "final rank", value: String(wk.our_rank) }]
          : []),
        ...(wk.our_fame !== null && wk.our_fame !== undefined
          ? [{ label: "boat fame", value: String(wk.our_fame) }]
          : []),
        ...(wk.closed_at
          ? [{ label: "closed", value: fmt(wk.closed_at) }]
          : []),
        {
          label: "clan_tag",
          value: b.clan_tag,
          mono: true,
          href: `${CONSOLE}/explore/clan/${encTag(b.clan_tag)}`,
          hint: b.name,
        },
      ],
      tiles: [],
      // The week's own tables, plain: every clan in the race, the race's
      // closed days, and every recorded participant.
      tables: [
        {
          title: "Standings",
          cols: [
            { label: "RANK", num: true },
            { label: "CLAN" },
            { label: "TAG" },
            { label: "FAME", num: true },
            { label: "WAR TROPHIES", num: true },
            { label: "TROPHY CHANGE", num: true },
            { label: "FINISHED" },
          ],
          rows: standings.map((c) => [
            n(c.rank),
            clan(c),
            { text: c.clan_tag, mono: true },
            n(c.fame),
            n(c.clan_war_trophies),
            n(c.trophy_change),
            c.finish_time
              ? { text: fmt(c.finish_time), mono: true }
              : { text: "—", nil: true },
          ]),
        },
        ...(days.length > 0
          ? [
              {
                title: "Day by day",
                cols: [
                  { label: "DAY" },
                  { label: "RANK", num: true },
                  { label: "CLAN" },
                  { label: "POINTS", num: true },
                  { label: "PROGRESS", num: true },
                  { label: "DEFENSES LEFT", num: true },
                ],
                rows: days,
              },
            ]
          : []),
        {
          title: "Members",
          cols: [
            { label: "MEMBER" },
            { label: "TAG" },
            { label: "POINTS", num: true },
            { label: "DECKS USED", num: true },
            { label: "BOAT ATTACKS", num: true },
            { label: "REPAIR", num: true },
          ],
          rows: members.map((m) => [
            {
              text: m.name ?? m.player_tag,
              href: `${CONSOLE}/explore/player/${encTag(m.player_tag)}`,
            },
            { text: m.player_tag, mono: true },
            n(m.points),
            n(m.decks_used),
            n(m.boat_attacks),
            n(m.repair_points),
          ]),
        },
      ],
    };
  }

  if (kind === "list") return buildListView(rawId, res, zone);
  throw new Error(`unknown kind ${kind}`);
}

/** A battle's public page (/battle/<short id>, 9.18.0) as an in-app
 *  path, read from the row's own `url`. Never rebuilt from battle_id:
 *  the server lengthens a short id where two battles share a prefix,
 *  and only the row knows by how much. Null when the row has no url. */
export function battlePath(url) {
  if (!url) return null;
  try {
    const { pathname } = new URL(url);
    return /^\/battle\/[0-9a-f]{12,64}$/.test(pathname) ? pathname : null;
  } catch {
    return null;
  }
}

function buildListView(rawId, res, zone) {
  const [what, key] = rawId.split(":");
  const b = res.body;
  const fmt = (t) => stamp(t, zone);

  if (what === "battles" || what === "deckbattles") {
    const rows = (b.battles ?? []).map((bt) => {
      const myTag = bt.me.player_tag ?? b.player_tag;
      const opp = bt.opponents?.[0];
      return [
        {
          text: fmt(bt.battle_time),
          mono: true,
          // The battle's own page (2026-10-02): both decks, the towers
          // and how it ended. A row from before 9.18.0 has no url and
          // keeps the record view.
          href:
            battlePath(bt.url) ??
            (bt.battle_id
              ? `${CONSOLE}/explore/battle/${bt.battle_id}`
              : undefined),
        },
        ...(what === "deckbattles"
          ? [
              bt.me.name
                ? {
                    text: bt.me.name,
                    href: `${CONSOLE}/explore/player/${encTag(myTag)}`,
                  }
                : {
                    text: myTag,
                    mono: true,
                    href: `${CONSOLE}/explore/player/${encTag(myTag)}`,
                  },
            ]
          : [
              opp
                ? {
                    text: `${opp.name ?? opp.player_tag}`,
                    href: `${CONSOLE}/explore/player/${encTag(opp.player_tag)}`,
                  }
                : { text: "—", nil: true },
            ]),
        { text: bt.me.outcome ?? "—", outcome: bt.me.outcome },
        { text: bt.game_mode?.name ?? bt.type },
        bt.me.deck_hash
          ? {
              text: bt.me.deck_hash.slice(0, 10) + "…",
              mono: true,
              href: `${CONSOLE}/explore/deck/${bt.me.deck_hash}`,
            }
          : { text: "—", nil: true },
        bt.me.trophy_change !== null && bt.me.trophy_change !== undefined
          ? { text: String(bt.me.trophy_change) }
          : { text: "—", nil: true },
      ];
    });
    return {
      kindLabel: "BATTLES",
      crumb: "battles",
      title:
        what === "deckbattles"
          ? `battles · deck ${key.slice(0, 10)}…`
          : `battles · ${b.name ?? decTag(key)}`,
      tag: what === "deckbattles" ? null : decTag(key),
      chip: null,
      sub: b.total_count
        ? `${b.total_count.toLocaleString()} recorded battles match; newest first, 25 per page.`
        : rows.length
          ? "Newest first, 25 per page."
          : "No captured battles in this page. Missing capture does not prove no play.",
      table: {
        cols: [
          { label: "TIME" },
          { label: what === "deckbattles" ? "PLAYER" : "VS" },
          { label: "RESULT" },
          { label: "MODE" },
          { label: "DECK" },
          { label: "ΔTROPHIES", num: true },
        ],
        rows,
      },
      note: b.warnings?.join(" ") ?? b.card_legend ?? b.deck_note,
    };
  }

  if (what === "decks") {
    return {
      kindLabel: "DECKS",
      crumb: "decks",
      title: `decks · ${b.name ?? decTag(key)}`,
      tag: decTag(key),
      sub: `${b.total_battles_in_window?.toLocaleString?.() ?? ""} ${noun(b.total_battles_in_window, "battle")} across ${b.decks?.length ?? 0} distinct ${noun(b.decks?.length ?? 0, "deck")} in the window.`,
      table: {
        cols: [
          { label: "DECK" },
          { label: "BATTLES", num: true },
          { label: "W", num: true },
          { label: "L", num: true },
          { label: "SHARE", num: true },
          { label: "LAST USED" },
        ],
        rows: (b.decks ?? []).map((d) => [
          {
            text:
              d.cards?.map((c) => c.name).join(", ") ||
              d.deck_hash.slice(0, 12),
            href: `${CONSOLE}/explore/deck/${d.deck_hash}`,
          },
          { text: String(d.battles) },
          { text: String(d.wins) },
          { text: String(d.losses) },
          {
            text:
              d.share_of_battles != null
                ? `${(d.share_of_battles * 100).toFixed(0)}%`
                : "—",
          },
          { text: fmt(d.last_used), mono: true },
        ]),
      },
      note: b.note,
    };
  }

  if (what === "members") {
    return {
      kindLabel: "MEMBERS",
      crumb: "members",
      title: `members · ${b.name ?? decTag(key)}`,
      tag: decTag(key),
      sub: "Open membership as recorded.",
      table: {
        cols: [
          { label: "MEMBER" },
          { label: "TAG" },
          { label: "ROLE" },
          { label: "TROPHIES", num: true },
          { label: "LAST BATTLE" },
        ],
        rows: (b.members ?? []).map((m) => [
          {
            text: m.name ?? "—",
            href: `${CONSOLE}/explore/player/${encTag(m.player_tag)}`,
          },
          { text: m.player_tag, mono: true },
          { text: m.role ?? "—" },
          m.trophies != null
            ? { text: String(m.trophies) }
            : { text: "—", nil: true },
          (m.last_recorded_battle ?? m.last_battle)
            ? { text: fmt(m.last_recorded_battle ?? m.last_battle), mono: true }
            : { text: "never", nil: true },
        ]),
      },
      note: b.note,
    };
  }

  if (what === "weeks") {
    return {
      kindLabel: "WAR WEEKS",
      crumb: "weeks",
      title: `war weeks · ${b.name ?? decTag(key)}`,
      tag: decTag(key),
      sub: "Recorded river-race weeks, newest first.",
      table: {
        cols: [
          { label: "WEEK" },
          { label: "RANK", num: true },
          { label: "FAME", num: true },
          { label: "" },
        ],
        rows: (b.weeks ?? []).map((w) => [
          {
            text: `S${w.season_id} W${Number(w.section_index) + 1}${w.is_colosseum ? " · colosseum" : ""}`,
            mono: true,
            href: `${CONSOLE}/explore/week/${encTag(decTag(key))}~${w.season_id}~${w.section_index}`,
          },
          // our_rank / our_fame since the contract named the clan's own
          // (console walk 2: every week read "—").
          (w.our_rank ?? w.rank) != null
            ? { text: String(w.our_rank ?? w.rank) }
            : { text: "—", nil: true },
          (w.our_fame ?? w.fame) != null
            ? { text: String(w.our_fame ?? w.fame) }
            : { text: "—", nil: true },
          { text: "" },
        ]),
      },
      note: b.note,
    };
  }

  throw new Error(`unknown list ${what}`);
}
