import { factsOfAction } from "./sharing.mjs";
import { createActionStore } from "./actions.mjs";
import {
  effectivePolicyValues,
  lifecycleWords,
  MIN_MEMBERS,
  openRemovalAtLeave,
  validTribute,
} from "@elixir-mcp/clan-engine";
import { ManageError } from "./service.mjs";

const iso = (t) => new Date(t).toISOString();
const roleFor = { promotion: "member", demotion: "elder" };
const kindFor = (type) => (type === "removal" ? "departure" : type);
const sameStay = (a, b) =>
  a && b && new Date(a).getTime() === new Date(b).getTime();
const sameTurn = (card, row) =>
  sameStay(card.lifecycle?.stay, row.stay_at) &&
  (row.kind === "departure" ||
    String(card.lifecycle?.prior) === String(row.prior_role_id));

/** Connected client supplied by the door. The clan lock serializes Actions.
 * The roster's player lock serializes an in-game observation with confirmation. */
export function createLifecycle(
  db,
  ledger,
  { storyFor, attest = null, wake = null },
) {
  const lockPlayer = (tag) =>
    db.query(
      "select pg_advisory_xact_lock(hashtext('clan_roster_member'),hashtext($1))",
      [tag],
    );
  const notify = async (facts) => {
    for (const f of facts)
      if (wake)
        await wake(f).catch(() => console.warn("clan_lifecycle_wake_failed"));
  };
  const { raiseAction, withdrawAction } = createActionStore({ ledger });
  async function transaction(fn) {
    await db.query("begin");
    try {
      const result = await fn();
      await db.query("commit");
      return result;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }
  async function membership(clan, tag) {
    return (
      await db.query(
        `select m.*,c.name as clan_name,
      (select coalesce(max(event_id),0) from clan_event where clan_tag=m.clan_tag and player_tag=m.player_tag
         and event_type='role_changed' and window_end>=m.joined_observed_at) as prior
      from clan_membership m join clan c using(clan_tag) where clan_tag=$1 and player_tag=$2
      order by joined_observed_at desc limit 1`,
        [clan, tag],
      )
    ).rows[0];
  }
  async function context(clan, tag, kind, stay, end, name) {
    const {
      rows: [info],
    } = await db.query(
      `select c.name as clan,
      exists(select 1 from clan_membership where clan_tag=$1 and player_tag=$2 and joined_observed_at<$3) as returning,
      count(w.season_id)::int as weeks, coalesce(sum(p.decks_used) filter(where w.season_id is not null),0)::int as decks
      from clan c left join war_participation p on p.clan_tag=c.clan_tag and p.player_tag=$2 and p.decks_used>0
      left join war_week w on w.clan_tag=p.clan_tag and w.season_id=p.season_id and w.section_index=p.section_index
        and coalesce(w.closed_at,w.finished_observed_at) >= $3::timestamptz + interval '7 days'
        and coalesce(w.closed_at,w.finished_observed_at) <= $4
      where c.clan_tag=$1 group by c.name`,
      [clan, tag, stay, end],
    );
    const story =
      kind === "welcome"
        ? await storyFor(clan, [tag], { nowMs: Date.parse(end) })
        : null;
    const member = story?.members?.[tag];
    const input = { ...info, name, story, member };
    const lines = lifecycleWords(kind, input);
    return {
      lines,
      evidence: {
        stay_at: iso(stay),
        as_of: iso(end),
        weeks: info.weeks,
        decks: info.decks,
        returning: info.returning,
      },
    };
  }

  async function prepare(clan, tag, type, name, at, contribution = null) {
    const m = await membership(clan, tag);
    if (!m || m.left_observed_at || (roleFor[type] && m.role !== roleFor[type]))
      return null;
    const copy = await context(
      clan,
      tag,
      type === "removal" ? "kick" : type,
      m.joined_observed_at,
      at,
      name,
    );
    if (type === "promotion" && contribution) copy.lines[1] = contribution;
    return {
      stay: iso(m.joined_observed_at),
      prior: String(m.prior),
      phase: "decision",
      lines: copy.lines,
      evidence: copy.evidence,
    };
  }
  async function observed(clan, card) {
    const l = card.lifecycle;
    if (!l) return null;
    return (
      await db.query(
        `select * from clan_lifecycle where clan_tag=$1 and player_tag=$2
      and stay_at=$3 and kind=$4 and (kind='departure' or prior_role_id=$5)
      and event_id is not null and (action_id is null or action_id=$6) and ($7::bigint is null or occasion_id=$7)
      order by occasion_id limit 1`,
        [
          clan,
          card.player_tag,
          l.stay,
          kindFor(card.type),
          l.prior,
          card.card_id,
          l.occasion_id ?? null,
        ],
      )
    ).rows[0];
  }

  async function confirm(
    clan,
    card,
    decided,
    { classification, tribute, hours },
  ) {
    const written = await transaction(async () => {
      await lockPlayer(card.player_tag);
      const row = await observed(clan, card);
      const m = await membership(clan, card.player_tag);
      if (
        !sameStay(m?.joined_observed_at, card.lifecycle.stay) ||
        (card.type === "departure"
          ? !m.left_observed_at || !row
          : m.left_observed_at ||
            (!row &&
              roleFor[card.type] &&
              (roleFor[card.type] !== m.role ||
                String(m.prior) !== card.lifecycle.prior)) ||
            (row &&
              roleFor[card.type] &&
              String(row.event_id) !== String(m.prior)))
      )
        throw new ManageError(409, "membership_changed");
      if (card.type === "welcome")
        throw new ManageError(409, "record_chat_receipt");
      let lines = card.lifecycle.lines;
      const answer =
        card.type === "removal"
          ? "kick"
          : card.type === "departure"
            ? classification
            : null;
      if (card.type === "departure" && answer !== "ignore")
        lines = (
          await context(
            clan,
            card.player_tag,
            answer,
            card.lifecycle.stay,
            row.observed_at,
            card.player_name,
          )
        ).lines;
      if (card.type === "promotion" && tribute != null) {
        if (!validTribute(tribute)) throw new ManageError(400, "bad_tribute");
        lines = tribute;
      }
      let id = row?.occasion_id;
      if (!id) {
        const result = await db.query(
          `insert into clan_lifecycle (clan_tag,player_tag,stay_at,kind,prior_role_id,player_name,reported_at,match_until)
          values($1,$2,$3,$4,$5,$6,$7,$7::timestamptz + $8*interval '1 hour') returning occasion_id`,
          [
            clan,
            card.player_tag,
            card.lifecycle.stay,
            kindFor(card.type),
            card.lifecycle.prior,
            card.player_name,
            decided.decided_at,
            hours,
          ],
        );
        id = result.rows[0].occasion_id;
      }
      if (answer !== "ignore")
        await db.query(
          `update clan_lifecycle set action_id=$2, reported_at=$3,
        published_at=coalesce(published_at,$3), paragraphs=$4, classification=$5,source='leader',evidence=$6 where occasion_id=$1`,
          [
            id,
            card.card_id,
            decided.decided_at,
            lines,
            answer ?? null,
            card.lifecycle.evidence,
          ],
        );
      decided.lifecycle = {
        ...card.lifecycle,
        occasion_id: String(id),
        phase: answer === "ignore" ? "ignored" : "sharing",
        lines: answer === "ignore" ? [] : lines,
      };
      if (!(await ledger.updateCardIf(clan, card, decided)))
        throw new ManageError(409, "action_changed");
      const facts = [];
      if (attest)
        for (const fact of factsOfAction(card, decided))
          facts.push(await attest(clan, fact));
      return facts;
    });
    await notify(written);
    return written.map((f) => ({ type: f.type, ok: true }));
  }

  async function share(clan, card, who, request) {
    const receipts = [];
    const next = await transaction(async () => {
      await lockPlayer(card.player_tag);
      return shareLocked(clan, card, who, request, receipts);
    });
    await notify(receipts);
    return next;
  }

  async function shareLocked(clan, card, who, { part, skip }, facts) {
    const l = card.lifecycle;
    if (!l || who.verified === false) throw new ManageError(403, "forbidden");
    if (
      skip === true
        ? l.phase === "skipped"
        : Number.isInteger(part) && l.receipts?.some((r) => r.part === part)
    )
      return card;
    if (l.phase !== "sharing") throw new ManageError(409, "sharing_closed");
    const m = await membership(clan, card.player_tag);
    if (
      !sameStay(m?.joined_observed_at, l.stay) ||
      (["welcome", "promotion", "demotion"].includes(card.type) &&
        m.left_observed_at) ||
      (roleFor[card.type] &&
        String(m.prior) !== l.prior &&
        String(m.prior) !== String((await observed(clan, card))?.event_id))
    )
      throw new ManageError(409, "membership_changed");
    const at = new Date().toISOString();
    let next;
    if (skip === true)
      next = {
        ...l,
        phase: "skipped",
        skipped_at: at,
        skipped_by: who.player_tag,
      };
    else {
      if (!Number.isInteger(part) || part < 1 || part > l.lines.length)
        throw new ManageError(400, "bad_part");
      const receipts = [
        ...(l.receipts ?? []),
        { part, text: l.lines[part - 1], by: who.player_tag, at },
      ];
      next = {
        ...l,
        receipts,
        phase: receipts.length === l.lines.length ? "sent" : "sharing",
      };
    }
    const patch = { lifecycle: next };
    if (next.phase !== "sharing" && card.status === "proposed")
      Object.assign(patch, {
        status: "done",
        decided_at: at,
        decided_by: who.player_tag,
        decided_by_name: who.name,
      });
    if (!(await ledger.updateCardIf(clan, card, patch)))
      throw new ManageError(409, "action_changed");
    if (
      attest &&
      skip !== true &&
      ["welcome", "promotion", "demotion"].includes(card.type)
    )
      facts.push(
        await attest(clan, {
          type: "clan_message",
          ref: `action:${card.card_id}:message:chat:${part}`,
          occurred_at: at,
          detail: { channel: "clan_chat", body: l.lines[part - 1] },
        }),
      );
    return { ...card, ...patch };
  }

  async function processRow(row) {
    const clan = row.clan_tag,
      tag = row.player_tag,
      kind = row.kind;
    const previous = await ledger.currentPolicy(clan);
    const policy = previous && effectivePolicyValues(previous.values);
    const cards = await ledger.cards(clan);
    const m = await membership(clan, tag);
    const same = sameStay(m?.joined_observed_at, row.stay_at);
    const present = same && !m.left_observed_at;
    const current =
      kind === "departure"
        ? same && !!m.left_observed_at
        : present &&
          (!roleFor[kind] || String(m.prior) === String(row.event_id));
    for (const c of cards.filter((c) => c.player_tag === tag && c.lifecycle)) {
      const l = c.lifecycle;
      const supersededRole =
        roleFor[c.type] &&
        same &&
        String(m.prior) !== l.prior &&
        String(m.prior) !== String((await observed(clan, c))?.event_id);
      const outdated =
        supersededRole ||
        !sameStay(m?.joined_observed_at, l.stay) ||
        (m.left_observed_at &&
          ["welcome", "promotion", "demotion"].includes(c.type));
      if (
        outdated &&
        (l.phase === "sharing" ||
          (c.status === "proposed" && c.type !== "removal"))
      ) {
        if (c.status === "proposed")
          await withdrawAction(clan, c, "The membership changed.");
        else if (c.status === "done")
          await ledger.updateCardIf(clan, c, {
            lifecycle: { ...l, phase: "closed" },
          });
      }
    }
    const copy = row.paragraphs
      ? null
      : await context(
          clan,
          tag,
          kind,
          row.stay_at,
          row.observed_at,
          row.player_name,
        );
    const lines = row.paragraphs ?? copy.lines;
    const eligible =
      current &&
      policy &&
      row.roster_size >= MIN_MEMBERS &&
      (kind === "welcome"
        ? policy.welcome_enabled
        : kind === "departure"
          ? policy.departures_enabled
          : true);
    const match = cards.find(
      (c) =>
        c.player_tag === tag &&
        c.type === kind &&
        c.status === "proposed" &&
        sameTurn(c, row),
    );
    let actionId = row.action_id;
    if (!actionId && eligible) {
      const life = {
        occasion_id: String(row.occasion_id),
        stay: iso(row.stay_at),
        prior: String(row.prior_role_id),
        lines,
        evidence: copy?.evidence ?? row.evidence,
        phase:
          kind === "departure" || (match && roleFor[kind])
            ? "decision"
            : "sharing",
      };
      if (match) {
        await ledger.updateCardIf(clan, match, {
          lifecycle: {
            ...match.lifecycle,
            ...life,
            lines: roleFor[kind] ? match.lifecycle.lines : lines,
          },
        });
        actionId = match.card_id;
      } else {
        const removal =
          kind === "departure" &&
          openRemovalAtLeave(
            cards.filter((c) => !c.lifecycle || sameTurn(c, row)),
            tag,
            iso(row.observed_at),
            [
              {
                type: "member_joined",
                at: iso(row.stay_at),
                detail: { player_tag: tag },
              },
            ],
          );
        const action = await raiseAction(
          clan,
          {
            card_id: `life_${row.occasion_id}`,
            clan_tag: clan,
            player_tag: tag,
            player_name: row.player_name,
            type: kind,
            status: "proposed",
            raised_at: iso(row.observed_at),
            policy_version: previous.version,
            lifecycle: life,
            evidence: {
              ...(kind === "welcome" ? { joined_at: iso(row.stay_at) } : {}),
              ...(kind === "departure"
                ? { left_at: iso(row.observed_at) }
                : {}),
              ...(removal
                ? {
                    removal_card_id: removal.card_id,
                    removal_number: removal.number,
                    suggested_classification: "kick",
                  }
                : {}),
            },
          },
          cards,
          {
            text:
              kind === "departure"
                ? "The roster shows a departure."
                : "The roster recorded the change.",
          },
        );
        actionId = action.card_id;
        if (removal) {
          const link = {
            left_clan: true,
            departure_card_id: actionId,
            departure_number: action.number ?? null,
          };
          if (removal.status === "proposed")
            await withdrawAction(
              clan,
              removal,
              "They are no longer in the clan.",
              link,
            );
          else
            await ledger.updateCardIf(clan, removal, {
              withdraw_detail: { ...removal.withdraw_detail, ...link },
            });
        }
      }
    }
    await db.query(
      `update clan_lifecycle set processed_at=now(),published_at=coalesce(published_at,observed_at),
      action_id=coalesce(action_id,$2), paragraphs=coalesce(paragraphs,$3),
      evidence=coalesce(evidence,$4),source=coalesce(source,'roster') where occasion_id=$1`,
      [row.occasion_id, actionId || null, lines, copy?.evidence ?? null],
    );
  }

  async function drain(limit = 12) {
    const { rows } = await db.query(
      `select occasion_id,clan_tag from clan_lifecycle where event_id is not null and processed_at is null
      and retry_at<=now() order by retry_at,occasion_id limit $1`,
      [limit],
    );
    let processed = 0;
    for (const candidate of rows) {
      try {
        await transaction(async () => {
          await db.query("select pg_advisory_xact_lock(hashtext($1))", [
            `clan-state:${candidate.clan_tag}`,
          ]);
          const {
            rows: [row],
          } = await db.query(
            "select * from clan_lifecycle where occasion_id=$1 and processed_at is null for update",
            [candidate.occasion_id],
          );
          if (row) {
            await processRow(row);
            processed++;
          }
        });
      } catch (e) {
        await db.query(
          `update clan_lifecycle set attempts=attempts+1, retry_at=now()+least(60,attempts+1)*interval '1 minute' where occasion_id=$1 and processed_at is null`,
          [candidate.occasion_id],
        );
        console.warn(
          JSON.stringify({
            at: "clan_lifecycle_retry",
            occasion: candidate.occasion_id,
            code: e.code ?? e.name,
          }),
        );
      }
    }
    return processed;
  }
  async function decline(clan, card, decided) {
    return transaction(async () => {
      if (!(await ledger.updateCardIf(clan, card, decided)))
        throw new ManageError(409, "action_changed");
      await db.query(
        `update clan_lifecycle set action_id=null,processed_at=null,retry_at=now()
        where clan_tag=$1 and action_id=$2 and reported_at is null and event_id is not null`,
        [clan, card.card_id],
      );
    });
  }
  return { prepare, confirm, decline, share, observed, drain };
}
