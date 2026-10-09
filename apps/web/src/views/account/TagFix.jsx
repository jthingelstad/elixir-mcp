import { useWrite } from "@elixir-mcp/client";
import { TagText, writeErrorText } from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { CONSOLE } from "../../lib/console.js";
import { tagPath } from "../../lib/tag-url.js";

/** The add form's test: Tracking.jsx says the same. */
const TAG_OK = /^#?[0289PYLQGRJCUVO]{3,12}$/i;
const canonical = (raw) =>
  `#${raw.trim().toUpperCase().replace(/^#/, "").replaceAll("O", "0")}`;

/**
 * "Stop tracking", asked twice (2026-10-08): the first press asks
 * "Stop tracking #TAG? Yes / Cancel" in place, and only Yes writes. One
 * stray click used to stop a recording at once. `run` is the page's
 * removal (TrackedRecord's useWrite); it answers { ok }.
 */
export function StopTracking({ tag, run, busy, error, onDone, className }) {
  const [asking, setAsking] = useState(false);
  const yes = useRef(null);
  useEffect(() => {
    if (asking) yes.current?.focus();
  }, [asking]);
  if (!asking)
    return (
      <span className={`flex flex-wrap items-center gap-3 ${className ?? ""}`}>
        <button
          className="btn btn--danger"
          disabled={busy}
          onClick={() => setAsking(true)}
        >
          Stop tracking
        </button>
        {/* The consequence beside the control: this stops new capture
            and takes nothing away. */}
        <span className="footnote">
          {error ? writeErrorText(error) : "History already recorded is kept."}
        </span>
      </span>
    );
  return (
    <span
      className={`flex flex-wrap items-center gap-3 ${className ?? ""}`}
      role="group"
      aria-label={`Stop tracking ${tag}?`}
    >
      <span className="text-[13.5px] text-ink-body">
        Stop tracking <span className="mono">{tag}</span>?
      </span>
      <button
        ref={yes}
        className="btn btn--danger btn--sm"
        disabled={busy}
        onClick={async () => {
          const r = await run();
          setAsking(false);
          if (r.ok) onDone?.();
        }}
      >
        Yes, stop
      </button>
      <button
        className="btn btn--sm"
        disabled={busy}
        onClick={() => setAsking(false)}
      >
        Cancel
      </button>
      <span className="footnote">History already recorded is kept.</span>
    </span>
  );
}

/**
 * A tag the game answered "not found" for, fixed where it is said
 * (2026-10-08): type the right tag and Elixir tracks it in this one's
 * place (primary stays primary, a relationship carries over), then stops
 * this one. The add goes first, so a refused add (a bad tag, a full
 * tier) leaves everything as it was. Overview's "Fix the tag" lands
 * here (#fix-tag).
 */
export function FixTag({ claim, refresh, navigate, stop }) {
  const wanted = claim.player_tag;
  const [next, setNext] = useState("");
  const [bad, setBad] = useState("");
  const input = useRef(null);
  useEffect(() => {
    if (window.location.hash !== "#fix-tag") return;
    const el = document.getElementById("fix-tag");
    el?.scrollIntoView?.({ block: "center" });
    input.current?.focus({ preventScroll: true });
  }, []);
  const replace = useWrite(
    async (tag) => {
      const add = await api.claimAction({
        player_tag: tag,
        action: "add",
        ...(claim.is_primary ? { make_primary: true } : {}),
      });
      if (!add.ok) return add;
      const kept =
        !claim.is_primary && claim.relationship
          ? await api.setRelationship(tag, claim.relationship)
          : add;
      const removed = await api.claimAction({
        player_tag: wanted,
        action: "remove",
      });
      // Both writes ran; a refusal of either is said, not swallowed.
      return !removed.ok ? removed : kept.ok ? add : kept;
    },
    { invalidate: () => refresh() },
  );
  const submit = async (ev) => {
    ev.preventDefault();
    setBad("");
    if (!TAG_OK.test(next.trim())) {
      setBad("That doesn't look like a Clash Royale tag.");
      return;
    }
    const tag = canonical(next);
    if (tag === wanted) {
      setBad("That is the tag the game did not find.");
      return;
    }
    const r = await replace.run(tag);
    if (r.ok)
      navigate(
        `${CONSOLE}/account/tracking/${tagPath(r.data?.player_tag ?? tag)}`,
      );
  };
  return (
    <div id="fix-tag" className="mt-3 flex flex-col gap-2">
      <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
        <label className="text-[13.5px]" htmlFor="fix-tag-input">
          Correct tag
        </label>
        <input
          id="fix-tag-input"
          ref={input}
          className="mono w-[11rem]"
          placeholder="#2PYQ8GJ0"
          aria-invalid={bad || replace.error ? "true" : undefined}
          aria-describedby="fix-tag-help"
          disabled={replace.busy}
          value={next}
          onChange={(ev) => {
            setNext(ev.target.value);
            setBad("");
          }}
        />
        <button className="btn btn--primary btn--sm" disabled={replace.busy}>
          {replace.busy ? "Saving…" : "Track this tag instead"}
        </button>
      </form>
      <span id="fix-tag-help" className="footnote">
        <TagText>
          {bad ||
            (replace.error
              ? writeErrorText(replace.error)
              : `Elixir tracks the corrected tag${claim.is_primary ? " as your primary" : ""} and stops ${wanted}.`)}
        </TagText>
      </span>
      {stop}
    </div>
  );
}
