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
  // "Your clan" is the primary player's CURRENT clan, the same fact an
  // omitted clan_tag resolves to (entitlements: primary only, never an
  // alt's or a tracked clan's; 2026-09-25), recorded or not.
  const {
    rows: [primaryClan],
  } = await db.query(
    `select m.clan_tag, c.name,
            exists (select 1 from recording r
                     where r.subject_type = 'clan' and r.subject_tag = m.clan_tag
                       and r.status = 'active') as recorded
       from claim cl
       join clan_membership m on m.player_tag = cl.player_tag
                             and m.left_observed_at is null
       left join clan c on c.clan_tag = m.clan_tag
      where cl.account_id = $1 and cl.is_primary
      limit 1`,
    [account.accountId],
  );
  // is_primary is still the read path during 0055's expand window; the label
  // follows it so the two can never appear to disagree.
  const grouped = {};
  for (const row of players) {
    const rel = row.is_primary ? "primary" : (row.relationship ?? "watching");
    (grouped[rel] ??= []).push(row);
  }
  return { kind, grouped, clans, primaryClan: primaryClan ?? null };
}

async function countIdentities(db, account) {
  const { rows } = await db.query(
    `select count(*)::int as n from agent_identity where account_id = $1`,
    [account.accountId],
  );
  return rows[0].n;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The identity paragraph, or null when there is nothing true to say.
 *
 * `compact` names only the primary and "your clan" (an agent: its clan and
 * its leader) and counts the rest. The brief takes it when the full list
 * would push the brief past what a client shows (protocol.mjs,
 * INSTRUCTIONS_BUDGET; review 2026-09-27 §6.1): a heavy account's fifty
 * players used to fill Claude Code's 2,048 characters alone.
 * elixir_my_players lists them all.
 */
export function identitySentences(identity, { compact = false } = {}) {
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
      const clan = identity.primaryClan;
      if (clan)
        out.push(
          `Your clan is ${clan.name ? `${clan.name} ` : ""}${clan.clan_tag}${clan.recorded ? "" : " (not recorded yet: an omitted clan_tag refuses until elixir_track_clan records it)"}.`,
        );
      // Silence about the others is what made the mismatch unresolvable:
      // a tester could not tell a wrong default from a second clan. They
      // are clans you TRACK, which is not the same as being in them.
      const others = (identity.clans ?? []).filter(
        (c) => c.clan_tag !== clan?.clan_tag,
      );
      const named = [];
      const counts = [];
      let tracked = 0;
      for (const rel of RELATIONSHIP_ORDER.slice(1)) {
        const rows = identity.grouped[rel] ?? [];
        if (rows.length === 0) continue;
        tracked += rows.length;
        const names = rows.map(label).join(", ");
        named.push(
          rel === "alt"
            ? `Also you, under ${rows.length === 1 ? "another tag" : "other tags"}: ${names}.`
            : rel === "friend"
              ? `Friends you follow: ${names}.`
              : `You are also watching: ${names}.`,
        );
        counts.push(
          rel === "alt"
            ? plural(rows.length, "alt")
            : rel === "friend"
              ? plural(rows.length, "friend")
              : `${rows.length} you watch`,
        );
      }
      if (others.length > 0)
        named.push(
          `You also track ${others
            .map((c) => (c.name ? `${c.name} ${c.clan_tag}` : c.clan_tag))
            .join(", ")} - name the tag to mean those.`,
        );
      // Counted when compact (an alt is still you, so the count says
      // which kind each is).
      if (!compact) out.push(...named);
      else if (tracked || others.length) {
        const players = counts.length
          ? `${plural(tracked, "more player")} (${counts.join(", ")})`
          : "";
        const clans = others.length ? plural(others.length, "more clan") : "";
        out.push(
          `You also track ${[players, clans].filter(Boolean).join(" and ")}: elixir_my_players lists them; name the tag to mean those.`,
        );
      }
      out.push(
        "OMIT player_tag and clan_tag to mean these; never look yourself up, and name a tag only for somebody else.",
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
    const extra = identity.clans.slice(1);
    if (extra.length)
      out.push(
        compact
          ? `Also ${plural(extra.length, "more clan")}: name the clan_tag to mean one.`
          : `Also: ${extra
              .map((c) => `${c.name ?? ""} ${c.clan_tag}`.trim())
              .join(", ")}.`,
      );
    if (identity.leaders?.length) {
      const role = (l) => (l.role === "leader" ? "leader" : "co-leader");
      // Compact: the leader, and the co-leaders counted (clans_roster
      // has every role).
      const leader = identity.leaders.filter((l) => l.role === "leader");
      const co = identity.leaders.length - leader.length;
      out.push(
        compact
          ? `Leadership: ${[
              ...leader.map((l) => `${l.name ?? l.player_tag} (leader)`),
              ...(co ? [plural(co, "co-leader")] : []),
            ].join(" and ")}.`
          : `Leadership: ${identity.leaders
              .map((l) => `${l.name ?? l.player_tag} (${role(l)})`)
              .join(", ")}.`,
      );
    }
    out.push(
      "OMIT clan_tag to mean it. Pull clans_roster ONCE per run and reuse it (the roster is not here: it changes daily).",
    );
    out.push(
      "Nothing defaults to 'you': for a human asking about themselves, pass on_behalf_of (their id on your surface); unmapped, ask who they are and call elixir_identify once.",
    );
    if (identity.identityCount)
      out.push(`You already know ${identity.identityCount} of them.`);
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
