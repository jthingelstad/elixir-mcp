import { useWrite } from "@elixir-mcp/client";
import { ConfirmAction, TagText, writeErrorText } from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { SETTINGS } from "../../lib/settings.js";
import { tagPath } from "../../lib/tag-url.js";

/** The add form's test: Tracking.jsx says the same. */
const TAG_OK = /^#?[0289PYLQGRJCUVO]{3,12}$/i;
const canonical = (raw) =>
  `#${raw.trim().toUpperCase().replace(/^#/, "").replaceAll("O", "0")}`;

/**
 * "Stop following", asked once in a dialog (a mis-click must not stop a
 * recording). `run` is the page's removal; it answers { ok }. A refusal
 * (your main player, while you track others) stays in the dialog and says
 * why.
 */
export function StopFollowing({ name, run, busy, onDone }) {
  return (
    <ConfirmAction
      label="Stop following"
      className="btn btn--sm btn--danger"
      disabled={busy}
      title={<>Stop following {name}?</>}
      body="History stays for at least a year after the last person stops following. Elixir stops recording them for you, and they leave your timeline and your digest."
      confirm="Yes, stop"
      run={run}
      onDone={(r) => {
        if (r?.ok) onDone?.();
      }}
    />
  );
}

/**
 * A tag the game answered "not found" for, fixed where it is said
 * (2026-10-08): type the right tag and Elixir tracks it in this one's
 * place (main player stays main player, a relationship carries over), then stops
 * this one. The add goes first, so a refused add (a bad tag, a full
 * tier) leaves everything as it was. Home's "Fix the tag" lands here
 * (#fix-tag).
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
  const problem = !next.trim()
    ? null
    : !TAG_OK.test(next.trim())
      ? "That doesn't look like a CR tag."
      : canonical(next) === wanted
        ? "That is the tag the game did not find."
        : null;
  const tag = canonical(next);
  const historyStays =
    "History stays for at least a year after the last person stops following.";
  return (
    <div id="fix-tag" className="mt-3 flex flex-col gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          setBad(problem ?? "");
        }}
      >
        <label className="text-[13.5px]" htmlFor="fix-tag-input">
          Correct tag
        </label>
        <input
          id="fix-tag-input"
          ref={input}
          className="mono w-[11rem]"
          placeholder="#2PYQ8GJ0"
          aria-invalid={problem || bad || replace.error ? "true" : undefined}
          aria-describedby="fix-tag-help"
          disabled={replace.busy}
          value={next}
          onChange={(ev) => {
            setNext(ev.target.value);
            setBad("");
          }}
        />
        <ConfirmAction
          label="Follow this tag instead"
          className="btn btn--primary btn--sm"
          disabled={replace.busy || !next.trim() || Boolean(problem)}
          title={`Follow ${tag} instead?`}
          body={`Elixir follows the corrected tag${claim.is_primary ? " as your main player" : ""} and stops the old one. ${historyStays}`}
          confirm="Follow this tag instead"
          run={() => replace.run(tag)}
          onDone={(r) => {
            if (r?.ok)
              navigate(
                `${SETTINGS}/players/${tagPath(r.data?.player_tag ?? tag)}`,
              );
          }}
        />
      </form>
      <span id="fix-tag-help" className="footnote">
        <TagText>
          {problem ||
            bad ||
            (replace.error
              ? writeErrorText(replace.error)
              : `Elixir follows the corrected tag${claim.is_primary ? " as your main player" : ""} and stops ${wanted}.`)}
        </TagText>
      </span>
      {stop}
    </div>
  );
}
