import { createContext, useContext, type ReactNode } from "react";

export type PlayerVerifications = Readonly<Record<string, boolean>>;
const Proof = createContext<PlayerVerifications>({});

/** Explicit proof from the current website response, never inferred from art. */
export function PlayerIdentityProvider({
  players,
  children,
}: {
  players: PlayerVerifications;
  children: ReactNode;
}) {
  return <Proof.Provider value={players}>{children}</Proof.Provider>;
}
export function usePlayerVerified(tag?: string | null) {
  const players = useContext(Proof);
  return Boolean(tag && players[tag] === true);
}
export function VerifiedMark() {
  return (
    <svg
      className="kit-verified"
      role="img"
      aria-label="Verified player"
      viewBox="0 0 16 16"
    >
      <path
        fill="currentColor"
        d="m8 0 2 2 3-.1.1 3L16 8l-2.9 3.1-.1 3-3-.1L8 16l-2-2-3 .1-.1-3L0 8l2.9-3.1.1-3 3 .1Z"
      />
      <path
        fill="none"
        stroke="var(--ground)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m4.5 8 2.2 2.2 4.8-4.5"
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
