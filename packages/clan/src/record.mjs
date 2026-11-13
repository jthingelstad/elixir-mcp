/** Clan's reads of Elixir's record, in process (2026-11-13). Clan is a set
 * of features inside Elixir, not a client of it: no credential, no tool
 * call, no audit row. The reads are the same tools every door answers
 * from (`makeRecordReader` in `@elixir-mcp/tools/invoker`), closed to the
 * nine Clan uses. Who may see what stays with Clan's own checks: the gate
 * (membership and verification), `RUN_READS` and the roles, the role's
 * freshness, and each service's leader checks. */
export const READS = new Set([
  "elixir_my_players",
  "clans_participation",
  "clans_roster",
  "players_names",
  "players_profile",
  "battles_query",
  "elixir_coverage",
  "live_fetch",
  "war_history",
]);

/** The morning run reads as Elixir itself: no account, so no claims,
 *  nicknames or follows of anyone's, exactly what the `elixir-clan`
 *  integration it replaced could see. */
export const SYSTEM_READER = Object.freeze({
  accountId: null,
  kind: "system",
  role: "member",
  timezone: null,
});

/** A tool's error class as the HTTP status Clan answers with. */
const STATUS = {
  input: 400,
  subject: 404,
  budget: 429,
  retry: 503,
  server: 502,
};

const CLAN_PATH = /^\/clans\/#[0289PYLQGRJCUV]{3,12}$/;
const unsupported = () => ({
  ok: false,
  status: 403,
  error: "unsupported_clan_read",
});

/**
 * `read(name, args)` is the tools reader (`{ body, isError }`); `identity`
 * the signed-in person's players and principal (the web path only).
 * Writes are Elixir's own: a leader's fact as that leader, the morning
 * run's as the system writer.
 */
export function createRecord({
  read,
  identity = null,
  writeFact = null,
  removeFact = null,
  sendMail = null,
}) {
  return {
    identity() {
      return identity
        ? identity()
        : { ok: false, status: 401, error: "unauthenticated" };
    },
    async read(name, args = {}) {
      if (!READS.has(name)) return unsupported();
      if (name === "live_fetch") {
        let path;
        try {
          path = decodeURIComponent(String(args.path ?? ""));
        } catch {
          path = "";
        }
        if (!CLAN_PATH.test(path)) return unsupported();
      }
      const r = await read(name, args);
      return r.isError
        ? {
            ok: false,
            status: STATUS[r.body.error.class] ?? 502,
            code: r.body.error.code,
            error: r.body.error.message,
            hint: r.body.error.hint,
            body: r.body,
          }
        : { ok: true, body: r.body };
    },
    writeFact(clanTag, body) {
      if (!writeFact)
        return { ok: false, status: 503, error: "clan_writer_unavailable" };
      return writeFact(clanTag, body);
    },
    removeFact(clanTag, ref) {
      if (!removeFact)
        return { ok: false, status: 503, error: "clan_writer_unavailable" };
      return removeFact(clanTag, ref);
    },
    sendMail(clanTag, body) {
      if (!sendMail)
        return { ok: false, status: 503, error: "clan_mail_unavailable" };
      return sendMail(clanTag, body);
    },
  };
}
