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

const RELATIONSHIP_ORDER = ["primary", "alt", "friend"];

/** Compact "Name #TAG", the form every tool takes back. */
const label = (row) =>
  row?.name ? `${row.name} ${row.player_tag}` : (row?.player_tag ?? null);

export async function describeIdentity(db, account) {
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
    const rel = row.is_primary ? "primary" : (row.relationship ?? "friend");
    (grouped[rel] ??= []).push(row);
  }
  return { kind: "person", grouped, clans, primaryClan: primaryClan ?? null };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The identity paragraph, or null when there is nothing true to say.
 *
 * `compact` names only the primary and "your clan" and counts the rest. The brief takes it when the full list
 * would push the brief past what a client shows (protocol.mjs,
 * INSTRUCTIONS_BUDGET): a heavy account's fifty
 * players used to fill Claude Code's 2,048 characters alone.
 * elixir_my_players lists them all.
 */
export function identitySentences(identity, { compact = false } = {}) {
  if (!identity) return null;
  const out = [];

  const primary = identity.grouped?.primary?.[0];
  // Players but no primary: the primary ended when another account
  // verified its tag (#556), and nothing is promoted in its place.
  const tracked = RELATIONSHIP_ORDER.slice(1).some(
    (rel) => (identity.grouped?.[rel] ?? []).length > 0,
  );
  if (!primary && tracked) {
    out.push(
      "You follow players but have no primary, so nothing here defaults to you: elixir_follow_player with relationship primary names yours, and elixir_my_players lists who you follow.",
    );
  } else if (!primary) {
    out.push(
      "You have no player yet. elixir_follow_player follows one and your first becomes your primary; until then nothing here defaults to you.",
    );
  } else {
    out.push(`YOU ARE ${label(primary)}.`);
    const clan = identity.primaryClan;
    if (clan)
      out.push(
        `Your clan is ${clan.name ? `${clan.name} ` : ""}${clan.clan_tag}${clan.recorded ? "" : " (not recorded yet: an omitted clan_tag refuses until elixir_follow_clan records it)"}.`,
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
          : `Friends you follow: ${names}.`,
      );
      counts.push(
        rel === "alt"
          ? plural(rows.length, "alt")
          : plural(rows.length, "friend"),
      );
    }
    if (others.length > 0)
      named.push(
        `You also follow ${others
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
        `You also follow ${[players, clans].filter(Boolean).join(" and ")}: elixir_my_players lists them; name the tag to mean those.`,
      );
    }
    out.push(
      "OMIT player_tag and clan_tag to mean these; never look yourself up, and name a tag only for somebody else.",
    );
  }
  return out.join(" ");
}

/**
 * Who this connection is, as DATA rather than prose.
 *
 * `instructions` already says "YOU ARE King Thing #20JJJ2CCRU", which is
 * the right shape for the model reading it and the wrong shape for the client
 * hosting the model. A client that wants to label itself with the player it
 * serves would otherwise regex the prose, which breaks the moment the
 * wording changes -- and the wording is tuned for the model, so it changes
 * often.
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

export function principalBlock(
  kind,
  identity,
  personClan = identity?.clans?.[0],
) {
  const block = { kind: kind ?? "person" };
  const primary = identity?.grouped?.primary?.[0];
  block.subject = primary
    ? {
        type: "player",
        tag: primary.player_tag,
        ...(primary.name ? { name: primary.name } : {}),
      }
    : null;
  const clan = personClan;
  if (clan)
    block.clan = {
      tag: clan.clan_tag,
      ...(clan.name ? { name: clan.name } : {}),
    };
  return block;
}
