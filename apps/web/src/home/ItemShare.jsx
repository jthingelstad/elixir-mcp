import { useEffect, useRef, useState } from "react";
import { Icon } from "@elixir-mcp/ui";
import { shareableItem } from "@elixir-mcp/sharing/projection";
import { CopyButton } from "../views/JoinElixir.jsx";
import { api } from "../api.js";

/** Sharing never creates a post. Only the server's canonical URL enters
 * the outbound message; the signed-in item's names may be private aliases. */
export function ItemShare({ it, battle, onReady, compact = false }) {
  if (!battle && !shareableItem(it)) return null;
  return (
    <ShareAction
      key={battle ? `battle:${battle.id}` : `item:${it.id}`}
      it={it}
      battle={battle}
      onReady={onReady}
      compact={compact}
    />
  );
}

/** A target owns its cached capability and every pending side effect. */
function ShareAction({ it, battle, onReady, compact }) {
  const [state, setState] = useState("idle");
  const [url, setUrl] = useState(null);
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const run = async () => {
    if (busy.current || !active.current) return;
    busy.current = true;
    setState("pending");
    try {
      let link = url;
      if (!link) {
        const subject =
          it?.subjects?.find((s) => s.tag === it.subject_tag) ??
          it?.subjects?.[0];
        const out = await api.shareItem(
          battle
            ? { source: "battle", battle_ref: battle.id }
            : {
                item_id: it.id,
                kind: it.kind,
                source:
                  it.kind === "post"
                    ? "post"
                    : it.section === "people"
                      ? "people"
                      : "game",
                post_id: it.post?.id,
                subject,
                account: it.facts?.account_id,
                at: it.facts?.started_at ?? it.sort_at ?? it.at,
              },
        );
        if (!active.current) return;
        if (!out.ok || !out.data?.url) throw new Error("unavailable");
        link = out.data.url;
        setUrl(link);
        onReady?.(link);
      }
      if (!active.current) return;
      if (navigator.share) {
        try {
          await navigator.share({ url: link });
          if (active.current) setState("shared");
          return;
        } catch (error) {
          if (!active.current) return;
          if (error?.name === "AbortError") {
            setState("link");
            return;
          }
        }
      }
      try {
        if (!active.current) return;
        if (!navigator.clipboard?.writeText)
          throw new Error("clipboard_unavailable");
        await navigator.clipboard.writeText(link);
        if (active.current) setState("copied");
      } catch {
        if (active.current) setState("link");
      }
    } catch {
      if (active.current) setState("error");
    } finally {
      busy.current = false;
    }
  };
  const feedback = {
    pending: "Getting link…",
    copied: "Link copied",
    shared: "Shared",
  }[state];
  return (
    <span className="kit-item-share">
      <button
        type="button"
        className="btn btn--quiet btn--sm kit-item-share__action"
        aria-label={
          compact ? (feedback ?? "Share") : feedback ? undefined : "Share"
        }
        title={feedback ?? "Share"}
        disabled={state === "pending"}
        onClick={run}
      >
        <Icon
          name={state === "copied" || state === "shared" ? "check" : "share-2"}
          size={20}
        />
        {compact ? <span className="sr-only">{feedback}</span> : feedback}
      </button>
      <span className="kit-item-share__details">
        {state === "error" ? (
          <span role="status" className="kit-tiny">
            Couldn't get a link. Try again.
          </span>
        ) : null}
        {url && state !== "pending" ? (
          <>
            {state === "link" ? (
              <label className="kit-share-link">
                Share link
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.target.select()}
                />
              </label>
            ) : null}
            <a href={`${url}.png`} className="btn btn--quiet btn--sm" download>
              Share image
            </a>
            <CopyButton
              label="Copy for a post"
              text={`<a href="${url}"><img src="${url}.png" alt="A Timeline item shared on Elixir" width="1200" height="630"></a>`}
            />
          </>
        ) : null}
        {state === "copied" || state === "shared" ? (
          <span role="status" className="sr-only">
            Share link ready
          </span>
        ) : null}
      </span>
    </span>
  );
}
