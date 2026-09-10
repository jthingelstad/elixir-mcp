/**
 * Who this connection IS, answered once at initialize instead of by tool calls.
 *
 * The instructions used to open with "Start with elixir_my_players", a holdover
 * from when an account could only read its own players. Reads have been
 * universal since 0.19, so that line survived only as a habit — and an
 * expensive one: every session spent a round trip, sometimes three, discovering
 * facts the server knew before the first message. One observed sequence was
 * `elixir_my_players, war_rivals`, where the first call existed purely to learn
 * a clan tag.
 *
 * The tools have ALWAYS defaulted to the caller when a tag is omitted. Nothing
 * ever said so. This block says so, and names the values, so an agent can
 * answer "how am I playing" without asking the service who it is talking to.
 *
 * One query, once per connection. Deliberately NOT refreshed per call: a
 * connection is a session, the facts here are stable across one, and a roster
 * that changed at lunchtime is not worth paying for on every request.
 */

const RELATIONSHIP_ORDER = ["primary", "alt", "friend", "watching"];

/** Compact "Name #TAG", the form every tool takes back. */
const label = (row) =>
  row?.name ? `${row.name} ${row.player_tag}` : (row?.player_tag ?? null);

export async function describeIdentity(db, account) {
  const kind = account?.kind ?? "person";
  if (kind === "integration") return { kind };

  if (kind === "agent") {
    const { rows: clans } = await db.query(
      `select ac.clan_tag, c.name,
              (select count(*)::int from clan_membership m
                where m.clan_tag = ac.clan_tag and m.left_observed_at is null) as members
       from account_clan ac
       left join clan c on c.clan_tag = ac.clan_tag
       where ac.account_id = $1
       order by ac.is_primary desc, ac.clan_tag`,
      [account.accountId],
    );
    if (clans.length === 0) return { kind };

    // Leadership only, never the whole roster. The roster is volatile — joins,
    // leaves and promotions land daily — and a long-lived agent holds these
    // instructions until it reconnects, so an embedded roster would be
    // confidently wrong by evening in the most authoritative place in its
    // context. Leadership changes rarely and answers "who do I escalate to".
    const { rows: leaders } = await db.query(
      `select m.player_tag, p.name, m.role
       from clan_membership m
       left join player p on p.player_tag = m.player_tag
       where m.clan_tag = $1 and m.left_observed_at is null
         and m.role in ('leader', 'coLeader')
       order by case m.role when 'leader' then 0 else 1 end, p.name`,
      [clans[0].clan_tag],
    );
    return {
      kind,
      clans,
      leaders,
      identityCount: await countIdentities(db, account),
    };
  }

  const { rows: players } = await db.query(
    `select c.player_tag, c.relationship, c.is_primary, p.name
     from claim c
     left join player p on p.player_tag = c.player_tag
     where c.account_id = $1`,
    [account.accountId],
  );
  // The clan of the PRIMARY PLAYER leads. This ordered by account_clan's
  // own is_primary, which is a different fact: on an account whose primary
  // player is in one clan and whose alt is in another, the opening
  // instructions named a clan players_summary did not report, and three of
  // five testers changed behaviour over it (playtest round, 2026-09-09).
  const { rows: clans } = await db.query(
    `select ac.clan_tag, c.name,
            exists (select 1 from claim cl
                    join clan_membership m on m.player_tag = cl.player_tag
                                          and m.left_observed_at is null
                    where cl.account_id = ac.account_id and cl.is_primary
                      and m.clan_tag = ac.clan_tag) as primary_players_clan
     from account_clan ac
     left join clan c on c.clan_tag = ac.clan_tag
     where ac.account_id = $1
     order by primary_players_clan desc, ac.is_primary desc, ac.clan_tag`,
    [account.accountId],
  );
  // is_primary is still the read path during 0055's expand window; the label
  // follows it so the two can never appear to disagree.
  const grouped = {};
  for (const row of players) {
    const rel = row.is_primary ? "primary" : (row.relationship ?? "watching");
    (grouped[rel] ??= []).push(row);
  }
  return { kind, grouped, clans };
}

async function countIdentities(db, account) {
  const { rows } = await db.query(
    `select count(*)::int as n from agent_identity where account_id = $1`,
    [account.accountId],
  );
  return rows[0].n;
}

/** The identity paragraph, or null when there is nothing true to say. */
export function identitySentences(identity) {
  if (!identity) return null;
  const out = [];

  if (identity.kind === "person") {
    const primary = identity.grouped?.primary?.[0];
    if (!primary) {
      out.push(
        "You have no player yet. elixir_track_player tracks one and your first becomes your primary; until then nothing here defaults to you.",
      );
    } else {
      out.push(`YOU ARE ${label(primary)}.`);
      for (const rel of RELATIONSHIP_ORDER.slice(1)) {
        const rows = identity.grouped[rel] ?? [];
        if (rows.length === 0) continue;
        const names = rows.map(label).join(", ");
        out.push(
          rel === "alt"
            ? `Also you, under ${rows.length === 1 ? "another tag" : "other tags"}: ${names}.`
            : rel === "friend"
              ? `Friends you follow: ${names}.`
              : `You are also watching: ${names}.`,
        );
      }
      const clan = identity.clans?.[0];
      if (clan) {
        out.push(
          `Your clan is ${clan.name ? `${clan.name} ` : ""}${clan.clan_tag}.`,
        );
        // Silence about the others is what made the mismatch unresolvable:
        // a tester could not tell a wrong default from a second clan.
        if (identity.clans.length > 1)
          out.push(
            `You are also in ${identity.clans
              .slice(1)
              .map((c) => (c.name ? `${c.name} ${c.clan_tag}` : c.clan_tag))
              .join(", ")} - name the tag to mean those.`,
          );
      }
      out.push(
        "OMIT player_tag and clan_tag to mean these — do not look yourself up first. Name a tag only when you mean somebody else.",
      );
    }
    return out.join(" ");
  }

  if (identity.kind === "agent") {
    const clan = identity.clans?.[0];
    if (!clan) return "You act for a clan, but none is on this connection yet.";
    out.push(
      `YOU ACT FOR ${clan.name ? `${clan.name} ` : ""}${clan.clan_tag}${
        clan.members ? ` (${clan.members} members)` : ""
      }.`,
    );
    if (identity.clans.length > 1)
      out.push(
        `Also: ${identity.clans
          .slice(1)
          .map((c) => `${c.name ?? ""} ${c.clan_tag}`.trim())
          .join(", ")}.`,
      );
    if (identity.leaders?.length) {
      const say = identity.leaders
        .map(
          (l) =>
            `${l.name ?? l.player_tag} (${l.role === "leader" ? "leader" : "co-leader"})`,
        )
        .join(", ");
      out.push(`Leadership: ${say}.`);
    }
    out.push(
      "OMIT clan_tag to mean it. Pull clans_roster ONCE and reuse it — it is not in this block because it changes daily and this text does not.",
    );
    out.push(
      "You have no player of your own, so nothing defaults to 'you'. When a human asks about themselves, pass on_behalf_of with their id from your surface; if it is not mapped yet, ask which player they are and call elixir_identify once — then it is remembered.",
    );
    if (identity.identityCount)
      out.push(
        `You already know ${identity.identityCount} of them (elixir_my_identities).`,
      );
    return out.join(" ");
  }

  return "You have no subject of your own: name player_tag and clan_tag on every call. Nothing here defaults to 'yours', because there is no yours.";
}

/**
 * Who this connection is, as DATA rather than prose.
 *
 * `instructions` already says "YOU ACT FOR POAP KINGS #J2RGCRVG", which is
 * the right shape for the model reading it and the wrong shape for the client
 * hosting the model. A Discord bot that wants to refuse to boot on a person
 * token, or label its channel with the clan it serves, had two options: regex
 * the prose, or infer the kind from which tools are absent. Both break the
 * moment the wording changes -- and the wording is tuned for the model, so it
 * changes often. (Reported by the elixir-mcp-discord author.)
 *
 * This rides in `_meta` on the initialize result, not on `serverInfo`.
 * serverInfo is a spec-defined shape (name, title, version, websiteUrl) and
 * anything we invent there is squatting on a namespace the MCP spec owns;
 * `_meta` is the extension point the spec provides for exactly this, and its
 * keys are meant to be prefixed. If MCP later standardises a principal field,
 * we adopt it without having collided with it first.
 *
 * Deliberately NOT an authorization surface: it reports the connection you
 * already hold. Every tool re-derives the caller's rights server-side, so a
 * client that lies to itself about this changes nothing but its own labels.
 */
export const PRINCIPAL_META_KEY = "elixir.poapkings.com/principal";

export function principalBlock(kind, identity) {
  const resolved = kind ?? "person";
  const block = { kind: resolved };

  if (resolved === "agent") {
    const clan = identity?.clans?.[0];
    if (clan)
      block.subject = {
        type: "clan",
        tag: clan.clan_tag,
        ...(clan.name ? { name: clan.name } : {}),
        ...(clan.members ? { members: clan.members } : {}),
      };
    // An agent with no clan is a misconfiguration a client SHOULD be able to
    // catch at boot, so say so rather than omitting the key and looking the
    // same as a client that did not ask.
    else block.subject = null;
    return block;
  }

  if (resolved === "person") {
    const primary = identity?.grouped?.primary?.[0];
    block.subject = primary
      ? {
          type: "player",
          tag: primary.player_tag,
          ...(primary.name ? { name: primary.name } : {}),
        }
      : null;
    const clan = identity?.clans?.[0];
    if (clan)
      block.clan = {
        tag: clan.clan_tag,
        ...(clan.name ? { name: clan.name } : {}),
      };
    return block;
  }

  // An integration serves its own users and has no subject of its own.
  block.subject = null;
  return block;
}
