import mark from "./verification-mark.json" with { type: "json" };
import { createContext, useContext, type ReactNode } from "react";

export type PlayerVerifications = Readonly<Record<string, boolean>>;
const Proof = createContext<PlayerVerifications>({});
const Claims = createContext<PlayerVerifications>({});

/** A player's state (2026-11-15): Verified (an account proved it is this
 *  player; nobody else can claim it), Claimed (an account says it is and
 *  has not verified it) or Imported (followed, so Elixir records it). */
export type PlayerState = "verified" | "claimed" | "imported";

/** Explicit proof and claims from the current website response, never
 *  inferred from art. */
export function PlayerIdentityProvider({
  players,
  claims = {},
  children,
}: {
  players: PlayerVerifications;
  claims?: PlayerVerifications;
  children: ReactNode;
}) {
  return (
    <Proof.Provider value={players}>
      <Claims.Provider value={claims}>{children}</Claims.Provider>
    </Proof.Provider>
  );
}
export function usePlayerVerified(tag?: string | null) {
  const players = useContext(Proof);
  return Boolean(tag && players[tag] === true);
}
/** Claimed and not verified, as the newest response said. */
export function usePlayerClaimed(tag?: string | null) {
  const claims = useContext(Claims);
  const verified = usePlayerVerified(tag);
  return Boolean(tag && !verified && claims[tag] === true);
}
/** The words for each state, as the player page and the docs say them. */
export const PLAYER_STATE_LABEL: Readonly<Record<PlayerState, string>> = {
  verified: "Verified",
  claimed: "Claimed",
  imported: "Imported",
};
export function VerifiedMark() {
  return (
    <svg
      className="kit-verified"
      role="img"
      aria-label={mark.label}
      viewBox={mark.viewBox}
    >
      <path fill="currentColor" d={mark.badge} />
      <path
        fill="none"
        stroke="var(--ground)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d={mark.check}
      />
    </svg>
  );
}
export function PlayerName({
  tag,
  children,
  verified,
}: {
  tag?: string | null | undefined;
  children: ReactNode;
  verified?: boolean | undefined;
}) {
  const known = usePlayerVerified(tag);
  return (
    <span className="kit-player-name">
      {children}
      {(verified ?? known) ? <VerifiedMark /> : null}
    </span>
  );
}

/** Native menus cannot contain SVG. Keep the platform control and carry the
 * same explicit state as a check, with its full accessible meaning. */
export function PlayerOption({
  tag,
  children,
}: {
  tag: string;
  children: ReactNode;
}) {
  const verified = usePlayerVerified(tag);
  return (
    <option
      value={tag}
      aria-label={
        typeof children === "string"
          ? `${children}${verified ? ", Verified player" : ""}`
          : undefined
      }
    >
      {children}
      {verified ? " ✓" : ""}
    </option>
  );
}
