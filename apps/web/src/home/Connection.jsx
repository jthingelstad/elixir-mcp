import { Icon, TagText } from "@elixir-mcp/ui";

/** The server distinguishes current clan membership from an explicit friend. */
export const isClanmateConnection = (person) =>
  Boolean(person?.clanmate) &&
  ["clanmate", "friend"].includes(person?.connection);

export function ClanmateState({ friend = false, close = false }) {
  const label = friend ? (close ? "Close friend" : "Friend") : "Clanmate";
  return (
    <span className="kit-connection-state">
      <span
        className={`kit-badge kit-connection-state__primary${friend ? " kit-connection-state__primary--friend" : ""}${friend && close ? " kit-connection-state__primary--close" : ""}`}
      >
        <Icon name={friend ? (close ? "star" : "check") : "users"} size={13} />{" "}
        {label}
      </span>
      {friend ? (
        <span className="kit-tiny kit-connection-state__secondary">
          Clanmate
        </span>
      ) : null}
    </span>
  );
}

export function ClanmateConnection({ you }) {
  if (!isClanmateConnection(you) || you.blocked) return null;
  const clan = you.shared_clan;
  return (
    <div className="kit-clanmate-connection" aria-label="Clanmate connection">
      <p className="kit-clanmate-connection__state">
        <ClanmateState
          friend={you.connection === "friend"}
          close={you.close === true}
        />
        <TagText>{clan?.name ?? clan?.clan_tag ?? you.clanmate}</TagText>
      </p>
      <p className="kit-tiny">
        {you.connection === "friend"
          ? "Your friend connection includes game activity and stays if either of you leaves the clan."
          : "Clanmates connect automatically. A friend connection includes game activity and stays if either of you leaves the clan."}
      </p>
    </div>
  );
}
