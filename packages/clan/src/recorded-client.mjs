/** A closed internal reader. The credential is an opaque request-local
 * object supplied after Elixir authenticates a person, never a browser
 * token, OAuth grant or integration key. */
const READS = new Set([
  "elixir_my_players",
  "clans_participation",
  "clans_roster",
  "players_names",
  "players_profile",
  "battles_query",
  "elixir_coverage",
  "live_fetch",
]);
export function createRecordedClient({
  credential,
  initialize,
  invoke,
  writeFact,
  removeFact,
  sendMail,
}) {
  const refused = () => ({ ok: false, status: 401, error: "unauthenticated" });
  return {
    initialize(token) {
      return token === credential ? initialize() : refused();
    },
    callTool(token, name, args = {}) {
      if (token !== credential) return refused();
      if (!READS.has(name))
        return { ok: false, status: 403, error: "unsupported_clan_read" };
      if (name === "live_fetch") {
        let path;
        try {
          path = decodeURIComponent(String(args.path ?? ""));
        } catch {
          path = "";
        }
        if (!/^\/clans\/#[0289PYLQGRJCUV]{3,12}$/.test(path))
          return { ok: false, status: 403, error: "unsupported_clan_read" };
      }
      return invoke(name, args);
    },
    writeFact(token, clanTag, body) {
      if (token !== credential) return refused();
      if (!writeFact)
        return { ok: false, status: 503, error: "clan_writer_unavailable" };
      return writeFact(clanTag, body);
    },
    removeFact(token, clanTag, ref) {
      if (token !== credential) return refused();
      if (!removeFact)
        return { ok: false, status: 503, error: "clan_writer_unavailable" };
      return removeFact(clanTag, ref);
    },
    sendMail(token, clanTag, body) {
      if (token !== credential) return refused();
      if (!sendMail)
        return { ok: false, status: 503, error: "clan_mail_unavailable" };
      return sendMail(clanTag, body);
    },
  };
}
