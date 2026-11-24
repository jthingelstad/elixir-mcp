import { Tag, useClock, Panel } from "@elixir-mcp/ui";
import { useState } from "react";
import { manageApi } from "../api.js";
import {
  keys,
  useInvalidate,
  useMemberAwards,
  useMemberNotes,
} from "../lib/queries.js";
import { trackEvent } from "../../analytics.js";
import { MemberExceptions } from "./Exceptions.jsx";

/**
 * One member, for an elder or a leader: notes (elders read and write elder
 * notes; leaders write leader notes and read both) and, for leaders, the
 * member's exceptions (2026-11-23, holds before). Context beside the
 * clock: a note is what a leader knows, an exception is what the rules
 * skip for them until a date, without resetting the clock.
 */
export function MemberSheet({ clanTag, member, role, onChange }) {
  const { whenDay } = useClock();
  const isLeader = role === "leader" || role === "coLeader";
  const notes = useMemberNotes(clanTag, member.player_tag).data ?? null;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const awards = useMemberAwards(clanTag, member.player_tag).data ?? null;
  const invalidate = useInvalidate();
  const load = () => {
    invalidate(keys.memberNotes(clanTag, member.player_tag));
    invalidate(keys.memberAwards(clanTag, member.player_tag));
  };

  const run = async (fn) => {
    setBusy(true);
    setError("");
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.data?.error ?? "That did not work.");
    return r;
  };

  return (
    <Panel as="div" style={{ marginTop: "12px" }}>
      <div className="panel__head">
        <span className="yours">
          {member.name ?? <Tag tag={member.player_tag} />}
        </span>
        <span className="tag">{member.player_tag}</span>
        <span className="chip">{member.role}</span>
      </div>
      <div className="panel__body" style={{ display: "grid", gap: "14px" }}>
        {awards && awards.length > 0 ? (
          <div>
            <div className="label" style={{ marginBottom: "6px" }}>
              Awards
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: "18px",
                display: "grid",
                gap: "4px",
              }}
            >
              {awards.map((g) => (
                <li key={`${g.season_id}-${g.award_id}`}>
                  <strong>{g.name}</strong>
                  {g.rank > 1 ? ` #${g.rank}` : ""} · season {g.season_id}
                  {g.note ? `: ${g.note}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <div className="label" style={{ marginBottom: "6px" }}>
            Notes
          </div>
          {notes === null ? (
            <p className="page__lede">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="page__lede">No notes yet.</p>
          ) : (
            <ul
              style={{
                margin: 0,
                paddingLeft: "18px",
                display: "grid",
                gap: "6px",
              }}
            >
              {notes.map((n) => (
                <li key={n.note_id}>
                  <span className={`kind-chip`} style={{ marginRight: "6px" }}>
                    {n.tier}
                  </span>
                  {n.text}{" "}
                  <span className="page-head__note">
                    · {n.author_name ?? <Tag tag={n.author_tag} />} ·{" "}
                    {whenDay(n.created_at)}
                  </span>{" "}
                  <button
                    type="button"
                    className="btn--text"
                    onClick={async () => {
                      await run(() => manageApi.removeNote(clanTag, n.note_id));
                      load();
                    }}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            style={{
              display: "flex",
              gap: "8px",
              marginTop: "10px",
              flexWrap: "wrap",
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              const r = await run(() =>
                manageApi.addNote(clanTag, member.player_tag, text),
              );
              if (r.ok) {
                trackEvent("clan.note_added", isLeader ? "leader" : "elder");
                setText("");
                load();
              }
            }}
          >
            <input
              className="input"
              style={{ flex: "1 1 240px" }}
              placeholder={
                isLeader
                  ? "A leader note (leaders see these)"
                  : "An elder note (elders and leaders see these)"
              }
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="submit"
              className="btn"
              disabled={busy || !text.trim()}
            >
              Add note
            </button>
          </form>
        </div>
        {isLeader ? (
          <MemberExceptions
            clanTag={clanTag}
            member={member}
            onChange={onChange}
          />
        ) : null}
        {error ? (
          <div className="callout callout--warn" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
