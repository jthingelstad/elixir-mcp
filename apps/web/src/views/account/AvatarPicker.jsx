import { Avatar, avatarCardOf, Link, Panel } from "@elixir-mcp/ui";
import { useMemo, useState } from "react";
import { api } from "../../api.js";
import { useCardCatalog } from "../../lib/queries.js";
import { SETTINGS } from "../../lib/settings.js";

/** The sentence that says where the image shows. Kept true to the code:
 *  each place it names reads `avatar_card_id` (services/web-api). */
export const AVATAR_PROMISE =
  "Your profile image shows on the players you've verified: in feeds, on player pages, in Find, in clan lists and on shared posts.";

/** Whether the account verified a player as itself (its main or an alt),
 *  the players its image shows on. */
export function hasVerifiedPlayer(me) {
  return (me?.claims ?? []).some(
    (c) =>
      c.status === "verified" &&
      (c.is_primary ||
        c.relationship === "primary" ||
        c.relationship === "alt"),
  );
}

/**
 * Settings › Profile's picture (2026-11-14): one Clash Royale card, its
 * base art cropped to the avatar's circle. Pick a tile, then Save; Remove
 * goes back to initials. The catalog's cards only, never a tower troop.
 */
export function AvatarPicker({ me, refresh }) {
  const current = avatarCardOf(me?.avatar_card_id);
  // undefined: nothing picked since the last save, so the saved one shows.
  const [draft, setDraft] = useState(undefined);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const catalog = useCardCatalog();
  const cards = useMemo(
    () =>
      (Array.isArray(catalog.data?.cards) ? catalog.data.cards : [])
        .filter((c) => avatarCardOf(c?.id) !== null && c.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [catalog.data],
  );
  const picked = draft === undefined ? current : draft;
  const pickedName = cards.find((c) => c.id === picked)?.name ?? null;
  const q = query.trim().toLowerCase();
  const shown = q
    ? cards.filter((c) => c.name.toLowerCase().includes(q))
    : cards;
  const main = (me?.claims ?? []).find((c) => c.is_primary) ?? null;

  async function save(card) {
    setBusy(true);
    setNote(null);
    const r = await api.setAvatar(card);
    setBusy(false);
    if (r?.ok) {
      setDraft(undefined);
      setNote(card === null ? "Removed. Your initials are back." : "Saved.");
    } else setNote(r?.data?.message ?? "That could not be saved. Try again.");
    refresh();
  }

  return (
    <Panel title="Profile image" titleAs="h2">
      <div className="avpick st-inset">
        <div className="avpick__head">
          <Avatar
            large
            name={main?.name ?? me?.email ?? null}
            tag={main?.player_tag ?? null}
            card={picked}
          />
          <div className="min-w-0">
            <p className="avpick__picked m-0">
              {picked === null
                ? "No image. Your initials show."
                : (pickedName ?? "Your card")}
            </p>
            <p className="page-head__note m-0">{AVATAR_PROMISE}</p>
            {!hasVerifiedPlayer(me) && (
              <p className="page-head__note m-0">
                None of your players is verified yet, so for now only you see
                it, in your top bar.{" "}
                <Link to={`${SETTINGS}/players`}>Verify your player</Link>
              </p>
            )}
          </div>
        </div>
        <input
          type="search"
          className="input avpick__search"
          aria-label="Search cards"
          placeholder="Search cards"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
        />
        {catalog.isPending ? (
          <p className="page-head__note m-0">Loading cards…</p>
        ) : catalog.isError || cards.length === 0 ? (
          <p className="page-head__note m-0">
            The cards could not be loaded. Try again later.
          </p>
        ) : shown.length === 0 ? (
          <p className="page-head__note m-0">No card matches that.</p>
        ) : (
          <div className="avpick__grid" role="group" aria-label="Cards">
            {shown.map((c) => (
              <button
                key={c.id}
                type="button"
                className="avpick__tile"
                aria-pressed={c.id === picked}
                onClick={() => {
                  setNote(null);
                  setDraft(c.id);
                }}
              >
                <Avatar name={c.name} card={c.id} />
                <span className="avpick__name">{c.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="avpick__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || picked === current || picked === null}
            onClick={() => save(picked)}
          >
            Save
          </button>
          {current !== null && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => save(null)}
            >
              Remove
            </button>
          )}
          <span className="page-head__note" role="status">
            {note}
          </span>
        </div>
      </div>
    </Panel>
  );
}
