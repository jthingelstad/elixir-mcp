import { useMemo, useState } from "react";
import {
  Chips,
  Empty,
  ErrorState,
  Link,
  Panel,
  Icon,
  TagText,
  useClock,
  useFlash,
} from "@elixir-mcp/ui";
import { SETTINGS } from "../lib/settings.js";
import { useMyTimeline, useTimelineEvidence } from "../lib/queries.js";
import {
  TimelineEvidence,
  useRowTime,
  useTimelinePlace,
} from "../views/account/timeline-shared.jsx";
import { shownAt, timelineDays, whoOf } from "./logic.js";

/**
 * Home › Timeline: today's feed and today's place in it, in days. The filters
 * only choose what is shown. Opening the page moves the page's own place, and
 * nothing a connection has read (standing ruling, 2026-10-20).
 */
export function HomeTimeline() {
  const { day, dayHeading } = useClock();
  const rowTime = useRowTime();
  const query = useMyTimeline();
  const timeline = query.data ?? null;
  const { openedMs } = useTimelinePlace(timeline);
  const [who, setWho] = useState("all");
  const [state, setState] = useState("all");
  const [openId, setOpenId] = useState(null);
  const items = useMemo(() => timeline?.timeline ?? [], [timeline]);
  const isNew = (it) =>
    openedMs !== null && Date.parse(it.observed_at ?? it.at) > openedMs;
  const people = [...new Set(items.map(whoOf))];
  const shown = items.filter(
    (it) =>
      (who === "all" || whoOf(it) === who) && (state === "all" || isNew(it)),
  );
  const newCount = items.filter(isNew).length;
  const more = timeline?.timeline_more ?? 0;
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  if (query.isError)
    return (
      <ErrorState
        title="The timeline could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
        retryLabel="Refresh timeline"
      >
        Try again shortly. Nothing was lost.
      </ErrorState>
    );
  if (items.length === 0)
    return (
      <Empty
        title="Nothing in the last seven days"
        action={
          <Link to={`${SETTINGS}/players`} className="btn btn--sm">
            Choose who you track
          </Link>
        }
      >
        Everything you track appears here while its notify switch is on.
      </Empty>
    );
  const days = timelineDays(shown, { day, openedMs });
  return (
    <div className="kit-home kit-home--read">
      <div className="kit-home__filters">
        <Chips
          label="Who"
          options={[
            { key: "all", label: "Everything" },
            ...people.map((p) => ({ key: p, label: <TagText>{p}</TagText> })),
          ]}
          value={who}
          onChange={setWho}
        />
        {openedMs !== null ? (
          <Chips
            label="State"
            options={[
              { key: "all", label: "All" },
              { key: "new", label: "New", count: newCount },
            ]}
            value={state}
            onChange={setState}
          />
        ) : null}
      </div>
      <Panel pad>
        {days.length === 0 ? (
          <p className="kit-week__quiet">Nothing here with these filters.</p>
        ) : (
          days.map((d) => (
            <section key={d.key} className="kit-day">
              <h2 className="kit-day__head">{dayHeading(d.at)}</h2>
              {d.rows.map(({ it, newLine }, i) => (
                <div key={it.id ?? `${d.key}-${i}`}>
                  <div className="kit-row kit-tl">
                    <span className="kit-row__main">
                      <span className="kit-row__title">
                        <TagText>{it.text}</TagText>
                      </span>
                      {it.kind === "battle_highlight" ? (
                        <HighlightLinks facts={it.facts} />
                      ) : null}
                      {it.evidence ? (
                        <button
                          type="button"
                          className="link kit-tl__more"
                          aria-expanded={openId === it.id}
                          onClick={() =>
                            setOpenId(openId === it.id ? null : it.id)
                          }
                        >
                          {openId === it.id ? closeWord(it) : openWord(it)}
                        </button>
                      ) : null}
                    </span>
                    <span className="kit-row__right">
                      {rowTime(shownAt(it))}
                    </span>
                  </div>
                  {openId === it.id ? (
                    <InPlaceEvidence
                      item={it}
                      window={timeline.window}
                      onRefresh={() => {
                        setOpenId(null);
                        query.refetch();
                      }}
                    />
                  ) : null}
                  {newLine ? (
                    <div className="kit-newmark">
                      New since your last visit
                      <span className="sr-only">
                        : the items above this line.
                      </span>
                    </div>
                  ) : null}
                </div>
              ))}
            </section>
          ))
        )}
      </Panel>
      <p className="kit-tiny">
        New means learned since you last opened this page. Opening it clears the
        mark on the Timeline tab and changes nothing your connections have read.
        {more > 0
          ? ` A busy week: the ${items.length} newest are shown, and ${more.toLocaleString("en-US")} more this week are not.`
          : ""}
      </p>
    </div>
  );
}

/** A highlight's row (#762): its battle, and its share link when it is
 *  yours and shared (the server sends share_url to its owner only). */
function HighlightLinks({ facts }) {
  const [copied, flash] = useFlash();
  const battle = String(facts?.battle?.url ?? "").replace(
    /^https?:\/\/[^/]+/,
    "",
  );
  return (
    <span className="share-actions">
      {battle.startsWith("/battle/") ? (
        <Link to={battle} className="link kit-tl__more">
          Open the battle
        </Link>
      ) : null}
      {facts?.share_url ? (
        <button
          type="button"
          className="link kit-tl__more"
          onClick={() => {
            navigator.clipboard?.writeText(facts.share_url);
            flash();
          }}
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy share link"}
        </button>
      ) : null}
    </span>
  );
}

const openWord = (it) =>
  it.evidence.kind === "session" ? "View games" : "View crossing";
const closeWord = (it) =>
  it.evidence.kind === "session" ? "Close games" : "Close crossing";

function InPlaceEvidence({ item, window, onRefresh }) {
  const [offset, setOffset] = useState(0);
  const selected = { ...item, window };
  const query = useTimelineEvidence({
    evidence_item_id: item.id,
    from: window.from,
    to: window.to,
    expected_evidence_version: item.evidence.version,
    evidence_offset: String(offset),
  });
  return (
    <div className="kit-tl__evidence">
      <TimelineEvidence
        selected={selected}
        query={query}
        offset={offset}
        setOffset={setOffset}
        onRefresh={onRefresh}
        underDay
      />
    </div>
  );
}
