import { Icon } from "@elixir-mcp/ui";
import { useState } from "react";
import { useMyClans } from "../lib/queries.js";
import { SIGNUP_URL, clanChatLine, clanMessage } from "../lib/invite.js";

/** A line to copy: the words on screen to select by hand too, and one
 *  button. Deliberately no analytics event: nothing records who copied
 *  what (lib/invite.js). */
function Copyable({ text, label, multiline = false }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-control border border-line-soft bg-ground-sunken px-2.5 py-2 text-[13px]">
      <span
        className={`min-w-0 flex-auto break-words ${multiline ? "whitespace-pre-line" : ""}`}
      >
        {text}
      </span>
      <button
        type="button"
        className="btn btn--sm"
        title={label}
        aria-label={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            // The words are on screen to select by hand.
          }
        }}
      >
        <Icon name={done ? "check" : "copy"} size={14} />
      </button>
    </div>
  );
}

/**
 * Bring your clanmates (2026-10-08), on Console ▸ Overview and Ladder:
 * shown only when the account's primary player has a recorded clan
 * (`/api/me/clans` home_clan), and named for it. A line for clan chat,
 * a longer note for Discord or a message, and the device's share sheet
 * where there is one. Without a clan it draws nothing.
 */
export function BringClanmates({ className = "" }) {
  const { data } = useMyClans();
  const home = data?.home_clan ?? null;
  const [shareNote, setShareNote] = useState("");
  if (!home) return null;
  const name = home.name ?? null;
  const shown = name ?? home.clan_tag;
  const chat = clanChatLine(name);
  const message = clanMessage(name);
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <section
      className={`panel ${className}`.trim()}
      aria-labelledby="bring-clanmates"
    >
      <div className="panel__head">
        <h2 id="bring-clanmates" className="m-0 text-[14px] font-semibold">
          Bring your clanmates
        </h2>
      </div>
      <div className="panel__body grid gap-2.5">
        <p className="m-0 text-[13.5px] text-ink-body">
          Anyone in {shown} who signs up gets their own battle history kept and
          the clan&rsquo;s week by email every Monday. Free and unofficial.
        </p>
        <div className="label">For clan chat</div>
        <Copyable text={chat} label="Copy the line for clan chat" />
        <div className="label">For Discord or a message</div>
        <Copyable
          text={`${message}\n${SIGNUP_URL}`}
          label="Copy the message"
          multiline
        />
        {canShare && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn--sm"
              onClick={async () => {
                setShareNote("");
                try {
                  await navigator.share({
                    title: "Elixir",
                    text: message,
                    url: SIGNUP_URL,
                  });
                } catch (err) {
                  if (err?.name !== "AbortError")
                    setShareNote(
                      "Sharing did not finish. Copy the message instead.",
                    );
                }
              }}
            >
              Share the message
            </button>
            {shareNote && (
              <span className="text-[12.5px] text-ink-dim">{shareNote}</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
