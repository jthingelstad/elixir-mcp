/** Clan routes use the authenticated Elixir account. Gate and roster state
 * live only for a request; no OAuth grant or second session is stored here. */
import { normalizeTag, runGate, verifyNotice } from "./gate.mjs";
import {
  withTrace,
  current,
  annotate,
  summarize,
  serverTiming,
} from "./trace.mjs";
import { roleLabel, roleRank } from "./roles.mjs";

const json = (statusCode, body, extra = {}) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extra.headers,
  },
  cookies: extra.cookies,
  body: JSON.stringify(body),
});

export function createHandler({
  mcp,
  identity,
  store,
  appUrl,
  elixirUrl,
  manage = null,
  awards = null,
  scout = null,
  recruit = null,
  /** the clan's own model: its key and its uses (`manage/model.mjs`) */
  model = null,
  /** Leader Messages drafted by the clan's model (`manage/drafts.mjs`) */
  drafts = null,
  feedback = null,
  /** the clan's Social section: the clan map (`manage/social.mjs`) */
  social = null,
  memberActivity = null,
  /** Verified player tags of the product's maintainer(s): MaintainerTags. */
  maintainerTags = [],
  now = () => Date.now(),
  log = console,
}) {
  for (const [k, v] of Object.entries({
    mcp,
    identity,
    store,
    appUrl,
    elixirUrl,
  })) {
    if (!v) throw new Error(`handler needs ${k}`);
  }
  const loadSession = (event) => identity.load(event);

  async function withToken(session, fn) {
    const credential = identity.credential(session);
    if (!credential) return { signInRequired: true };
    const result = await fn(credential);
    return result?.status === 401 ? { signInRequired: true } : { result };
  }

  async function gateFor(session) {
    const ran = await withToken(session, (credential) =>
      runGate({ mcp, token: credential }),
    );
    if (ran.signInRequired) return { signInRequired: true };
    if (ran.result?.error) return { error: "elixir_unavailable" };
    return { gate: ran.result, checkedAt: now() };
  }

  /** The preference key: the primary's tag, or the first tag on the
   *  account for an account with alts but no primary. */
  const prefKey = (gate) =>
    gate.primary?.player_tag ?? gate.identities?.[0]?.player_tag ?? null;

  /**
   * Which clan this session works in. Valid only while it is in the clan
   * set; a remembered preference wins, then a lone clan; more than one
   * with nothing remembered is `null`, and the page shows the chooser.
   */
  async function selectionFor(session, gate) {
    if (!gate.ok) return null;
    const inSet = (tag) => gate.clans.find((c) => c.clan_tag === tag) ?? null;
    if (session.selected && inSet(session.selected.clan_tag))
      return inSet(session.selected.clan_tag);
    let chosen = null;
    const key = session.id;
    let pref = key ? await store.getPreference(key) : null;
    if (!pref && prefKey(gate)) pref = await store.getPreference(prefKey(gate));
    if (pref?.clan_tag) chosen = inSet(pref.clan_tag);
    if (!chosen && gate.clans.length === 1) chosen = gate.clans[0];
    if (chosen) {
      await store.updateSession(session.id, {
        selected: { clan_tag: chosen.clan_tag, player_tag: chosen.acting_as },
      });
      session.selected = {
        clan_tag: chosen.clan_tag,
        player_tag: chosen.acting_as,
      };
    }
    return chosen;
  }

  /**
   * Who a session is, for feedback: the primary's tag (or the first tag
   * on the account), the name, and whether a VERIFIED tag of theirs is a
   * maintainer's. Works for a refused person too: "I am stuck at
   * unverified" is feedback worth having.
   */
  const personFor = (gate) => {
    const tag = prefKey(gate);
    if (!tag) return null;
    const id = (gate.identities ?? []).find((i) => i.player_tag === tag);
    const maintainer = (gate.identities ?? []).some(
      (i) =>
        i.claim_status === "verified" && maintainerTags.includes(i.player_tag),
    );
    return {
      player_tag: tag,
      name: id?.name ?? gate.primary?.name ?? null,
      maintainer,
    };
  };

  /**
   * The notice after sign-in: where an unverified player's in-game role
   * (Elder and up) waits for Elixir → Verify. `acknowledged` once the
   * person has said so for this very list in this session; a new one
   * (another clan, another role) is shown again.
   */
  const noticeFor = (session, gate) => {
    const notice = gate.ok ? verifyNotice(gate) : null;
    if (!notice) return null;
    return {
      clans: notice.clans,
      acknowledged: session.verifyAck === notice.key,
    };
  };

  const meBody = (session, gate, checkedAt, selected, person = null) => ({
    signed_in: true,
    maintainer: person?.maintainer === true,
    ok: gate.ok,
    reason: gate.ok ? null : gate.reason,
    principal: gate.principal ?? null,
    identities: gate.identities ?? [],
    clans: gate.clans ?? [],
    primary: gate.primary ?? null,
    selected: selected
      ? {
          clan_tag: selected.clan_tag,
          name: selected.name,
          player_tag: selected.acting_as,
          player_name: selected.acting_as_name,
          role: selected.role,
          role_label: selected.role_label,
          verified: selected.verified !== false,
          unlock: selected.unlock ?? null,
          your_tags: selected.your_tags,
        }
      : null,
    verify_notice: noticeFor(session, gate),
    checked_at: new Date(checkedAt).toISOString(),
    scope: session.scope ?? null,
    elixir_url: elixirUrl,
  });

  const signedOut = (extra) => json(401, { signed_in: false, ...extra });

  async function me(event) {
    const session = await loadSession(event);
    if (!session) return signedOut();
    const answer = await gateFor(session);
    if (answer.signInRequired) return signedOut({ reason: "session_expired" });
    if (answer.error)
      return json(502, { signed_in: true, error: "elixir_unavailable" });
    const selected = await selectionFor(session, answer.gate);
    const person = personFor(answer.gate);
    const body = meBody(
      session,
      answer.gate,
      answer.checkedAt,
      selected,
      person,
    );
    return json(200, await decorateMe(body, selected, person));
  }

  async function decorateMe(body, selected, person = null) {
    if (feedback && person)
      body.feedback_unseen = await feedback.unseen(person).catch(() => 0);
    // Which pages the selected clan's policy turns on (nothing in clan
    // management exists until a leader saves one), and the rail's Inbox
    // count for a leader: what is waiting, no evaluation.
    // Whether the selected clan's Social section is on (the rail's Map).
    if (social && selected)
      body.social = await social
        .setting(selected.clan_tag)
        .then((x) => ({ enabled: x.enabled }))
        .catch(() => ({ enabled: true }));
    if (manage && selected) {
      body.policy = await manage
        .policySummary(selected.clan_tag)
        .catch(() => null);
      // The rail's Actions count: what waits for this person, as who they
      // are in this clan.
      body.open_actions = await manage
        .openActionCount(selected.clan_tag, {
          player_tag: selected.acting_as ?? selected.player_tag,
          role: selected.role,
        })
        .catch(() => 0);
    }
    return body;
  }

  /** The feedback routes: a person's own, and the maintainer's lane. */
  async function feedbackRoute(event, method, path) {
    const session = await loadSession(event);
    if (!session) return signedOut();
    const gated = await gateFor(session);
    if (gated.signInRequired) return signedOut({ reason: "session_expired" });
    if (gated.error) return json(502, { error: "elixir_unavailable" });
    const person = personFor(gated.gate);
    if (!person) return json(403, { error: "no_player" });
    const body = method === "GET" ? {} : parseBody(event);
    if (body === null) return json(400, { error: "bad_request" });
    try {
      if (method === "GET" && path === "/api/feedback")
        return json(200, {
          feedback: await feedback.list(person),
          maintainer: person.maintainer,
        });
      if (method === "POST" && path === "/api/feedback")
        return json(200, await feedback.file(person, body));
      const one = /^\/api\/feedback\/([A-Za-z0-9_-]{4,16})$/.exec(path);
      if (method === "GET" && one)
        return json(200, await feedback.item(person, one[1]));
      if (method === "GET" && path === "/api/maintain/feedback")
        return json(200, { feedback: await feedback.queue(person) });
      const decide = /^\/api\/maintain\/feedback\/([A-Za-z0-9_-]{4,16})$/.exec(
        path,
      );
      if (method === "POST" && decide)
        return json(200, await feedback.decide(person, decide[1], body));
      return json(404, { error: "not_found" });
    } catch (err) {
      if (err?.status) return json(err.status, { error: err.code });
      throw err;
    }
  }

  /** "I understand": the notice after sign-in is acknowledged for this
   *  session, for the list it showed. */
  async function acknowledgeVerify(event) {
    const session = await loadSession(event);
    if (!session) return signedOut();
    const gated = await gateFor(session);
    if (gated.signInRequired) return signedOut({ reason: "session_expired" });
    if (gated.error) return json(502, { error: "elixir_unavailable" });
    const notice = gated.gate.ok ? verifyNotice(gated.gate) : null;
    if (notice) {
      await store.updateSession(session.id, { verifyAck: notice.key });
      session.verifyAck = notice.key;
    }
    const selected = await selectionFor(session, gated.gate);
    const person = personFor(gated.gate);
    return json(
      200,
      await decorateMe(
        meBody(session, gated.gate, gated.checkedAt, selected, person),
        selected,
        person,
      ),
    );
  }

  /** Choose the clan to work in. Remembered for the next sign-in too. */
  async function select(event) {
    const session = await loadSession(event);
    if (!session) return signedOut();
    let body = {};
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return json(400, { error: "bad_request" });
    }
    const tag = normalizeTag(body.clan_tag);
    if (!tag) return json(400, { error: "bad_request", hint: "clan_tag" });
    const gated = await gateFor(session);
    if (gated.signInRequired) return signedOut({ reason: "session_expired" });
    if (gated.error) return json(502, { error: "elixir_unavailable" });
    if (!gated.gate.ok)
      return json(403, { error: "gate", reason: gated.gate.reason });
    const chosen = gated.gate.clans.find((c) => c.clan_tag === tag);
    if (!chosen) return json(403, { error: "not_your_clan", clan_tag: tag });
    const selected = {
      clan_tag: chosen.clan_tag,
      player_tag: chosen.acting_as,
    };
    await store.updateSession(session.id, { selected });
    session.selected = selected;
    const key = session.id;
    if (key)
      await store.putPreference(key, {
        clan_tag: chosen.clan_tag,
        chosen_at: new Date(now()).toISOString(),
      });
    return json(
      200,
      await decorateMe(
        meBody(
          session,
          gated.gate,
          gated.checkedAt,
          chosen,
          personFor(gated.gate),
        ),
        chosen,
        personFor(gated.gate),
      ),
    );
  }

  async function roster(event) {
    const session = await loadSession(event);
    if (!session) return signedOut();
    const gated = await gateFor(session);
    if (gated.signInRequired) return signedOut({ reason: "session_expired" });
    if (gated.error) return json(502, { error: "elixir_unavailable" });
    if (!gated.gate.ok)
      return json(403, { error: "gate", reason: gated.gate.reason });

    // The clan is named in the query (the page's URL), else the selection.
    // Either way it must be one of the person's clans.
    const q = event.queryStringParameters ?? {};
    let clan = null;
    if (q.clan) {
      const tag = normalizeTag(q.clan);
      clan = tag ? gated.gate.clans.find((c) => c.clan_tag === tag) : null;
      if (!clan)
        return json(403, { error: "not_your_clan", clan_tag: tag ?? q.clan });
    } else {
      clan = await selectionFor(session, gated.gate);
      if (!clan) return json(409, { error: "no_selection" });
    }
    const got = await loadRoster(session, clan);
    if (got.response) return got.response;
    return json(200, got.body);
  }

  /** Read the named clan from the recorded facts for this request. */
  async function loadRoster(session, clan) {
    const clanTag = clan.clan_tag;
    const t = now();
    // The clan is named explicitly rather than left to the tool's default,
    // which is the first RECORDED clan among the account's claims and can
    // be an alt's clan when the primary's is not recorded.
    const ran = await withToken(session, (token) =>
      mcp.callTool(token, "clans_roster", { clan_tag: clanTag }),
    );
    if (ran.signInRequired)
      return { response: signedOut({ reason: "session_expired" }) };
    if (ran.unavailable)
      return { response: json(502, { error: "elixir_unavailable" }) };
    const r = ran.result;
    if (!r.ok) {
      if (r.code === "not_recorded" || r.code === "no_subject")
        return {
          body: {
            clan_tag: clanTag,
            name: clan.name,
            not_recorded: true,
            hint: r.hint ?? null,
            cached_at: new Date(t).toISOString(),
          },
        };
      log.warn?.("roster_failed", { error: r.error, code: r.code });
      return { response: json(502, { error: "elixir_unavailable" }) };
    }
    const body = shapeRoster(r.body, { yourTags: clan.your_tags });
    // The roster read is also how the policy gate learns the clan's size.
    if (manage)
      await manage
        .noteSize(clanTag, body.member_count)
        .catch((e) =>
          log.warn?.("clan_size_note_failed", { error: e.message }),
        );
    return { body: { ...body, cached_at: new Date(t).toISOString() } };
  }

  /** A person's verified player tags: one place is written under each. */
  const verifiedTags = (gate) =>
    (gate.identities ?? [])
      .filter((i) => i.claim_status === "verified")
      .map((i) => i.player_tag);

  /** The person's own place for the clan map: read, set, cleared. One
   *  place per person, whichever of their clans they set it from. */
  async function placeRoute(event, method) {
    const session = await loadSession(event);
    if (!session) return signedOut();
    const gated = await gateFor(session);
    if (gated.signInRequired) return signedOut({ reason: "session_expired" });
    if (gated.error) return json(502, { error: "elixir_unavailable" });
    const tags = verifiedTags(gated.gate);
    if (!tags.length) return json(403, { error: "gate", reason: "unverified" });
    const person = { tags };
    try {
      if (method === "GET")
        return json(200, { place: await social.myPlace(person) });
      if (method === "PUT") {
        const body = parseBody(event);
        if (body === null) return json(400, { error: "bad_request" });
        return json(200, { place: await social.setMyPlace(person, body) });
      }
      if (method === "DELETE")
        return json(200, await social.clearMyPlace(person));
      return json(404, { error: "not_found" });
    } catch (err) {
      if (err?.status)
        return json(err.status, { error: err.code, ...(err.detail ?? {}) });
      throw err;
    }
  }

  /**
   * The signed-in person in one of THEIR clans: the session, the gate, the
   * clan from the set and who they are there (tag, name, role). Every
   * Manage route starts here; role checks happen in the service.
   */
  async function clanContext(event, tagInput) {
    const session = await loadSession(event);
    if (!session) return { response: signedOut() };
    const gated = await gateFor(session);
    if (gated.signInRequired)
      return { response: signedOut({ reason: "session_expired" }) };
    if (gated.error)
      return { response: json(502, { error: "elixir_unavailable" }) };
    if (!gated.gate.ok)
      return {
        response: json(403, { error: "gate", reason: gated.gate.reason }),
      };
    const tag = normalizeTag(tagInput);
    const clan = tag ? gated.gate.clans.find((c) => c.clan_tag === tag) : null;
    if (!clan)
      return {
        response: json(403, {
          error: "not_your_clan",
          clan_tag: tag ?? tagInput,
        }),
      };
    const token = identity.credential(session);
    if (!token) return { response: signedOut({ reason: "session_expired" }) };
    return {
      session,
      gate: gated.gate,
      clan,
      token,
      who: {
        player_tag: clan.acting_as,
        name: clan.acting_as_name ?? null,
        role: clan.role,
        verified: clan.verified !== false,
      },
    };
  }

  function parseBody(event) {
    try {
      return JSON.parse(event.body ?? "{}") ?? {};
    } catch {
      return null;
    }
  }

  async function manageRoute(event, method, path) {
    const m = /^\/api\/clans\/([0-9A-Za-z]{3,12})(\/.*)?$/.exec(path);
    if (!m) return null;
    const rest = m[2] ?? "";
    // Every clan route needs a session: Elixir Clan is an app for a
    // clan's members and publishes nothing (Jamie, 2026-09-25).
    const ctx = await clanContext(event, m[1]);
    if (ctx.response) return ctx.response;
    const { clan, who, token } = ctx;
    const tag = clan.clan_tag;
    annotate({ clan: tag, role: who.role });
    // An unverified player is a member who reads (Jamie, 2026-09-26):
    // Elixir lets several accounts claim one tag unproven, so nothing is
    // done here in its name, and the map, where members say where they
    // play from, stays with verified members.
    if (!who.verified && (method !== "GET" || rest === "/map"))
      return json(403, { error: "unverified", player_tag: who.player_tag });
    const body =
      method === "GET" || method === "DELETE" ? {} : parseBody(event);
    if (body === null) return json(400, { error: "bad_request" });
    try {
      const activity = /^\/members\/([0-9A-Za-z]{3,12})\/activity$/.exec(rest);
      if (memberActivity && method === "GET" && activity)
        return json(
          200,
          await memberActivity(tag, token, activity[1], {
            cursor: event.queryStringParameters?.cursor ?? null,
            to: event.queryStringParameters?.to ?? null,
          }),
        );
      // Social (2026-09-26): the clan map for the clan's members; the
      // switch is read by every member and set by leaders.
      if (social && rest === "/social") {
        if (method === "GET") return json(200, await social.setting(tag));
        if (method === "PUT")
          return json(200, await social.setEnabled(tag, who, body.enabled));
      }
      if (social && method === "GET" && rest === "/map") {
        const got = await loadRoster(ctx.session, ctx.gate, clan);
        if (got.response) return got.response;
        if (got.body.not_recorded)
          return json(200, { clan_tag: tag, not_recorded: true, entries: [] });
        return json(
          200,
          await social.map(tag, got.body.members ?? [], {
            tags: verifiedTags(ctx.gate),
          }),
        );
      }
      // Recruiting: every member reads and copies; leaders write the pitch.
      if (recruit && rest === "/recruit") {
        if (method === "GET")
          return json(
            200,
            await recruit.view(tag, who, token, {
              refresh: event.queryStringParameters?.refresh === "1",
            }),
          );
        if (method === "POST")
          return json(
            200,
            await recruit.savePitch(
              tag,
              who,
              body.values ?? {},
              body.note ?? null,
            ),
          );
      }
      // A leader drafts the pitch with the clan's own model.
      if (recruit && method === "POST" && rest === "/recruit/draft")
        return json(
          200,
          await recruit.draft(tag, who, token, body.note ?? null),
        );
      // The clan's own model: leaders add, change and remove its key. It
      // works for any clan, with or without a policy (Recruit does).
      if (model && rest === "/model") {
        if (method === "GET")
          return json(200, await model.status(tag, who, token));
        if (method === "PUT" && body.key)
          return json(
            200,
            await model.setKey(tag, who, {
              key: body.key,
              model: body.model ?? null,
            }),
          );
        if (method === "PUT" && body.model)
          return json(200, await model.setModel(tag, who, body.model));
        if (method === "DELETE") {
          await model.removeKey(tag, who);
          return json(200, { ok: true });
        }
        return json(400, { error: "bad_request" });
      }
      // An action's message in the clan's voice, by the clan's own model.
      const draft = /^\/actions\/([A-Za-z0-9_-]+)\/draft$/.exec(rest);
      if (method === "POST" && draft) {
        if (!drafts) return json(404, { error: "not_found" });
        return json(
          200,
          await drafts.leaderMessage(tag, who, token, draft[1], {
            note: body.note ?? null,
            clanName: clan.name ?? null,
            expectedDraftVersion: body.expected_draft_version ?? null,
            channel: body.channel ?? null,
          }),
        );
      }
      if (!manage) return json(404, { error: "not_found" });
      if (method === "GET" && rest === "/manage")
        return json(
          200,
          await manage.manageView(tag, who, token, {
            refresh: event.queryStringParameters?.refresh === "1",
          }),
        );
      if (method === "GET" && rest === "/history")
        return json(200, await manage.history(tag, who, token));
      // "You here": a member's own numbers and place in this clan.
      if (method === "GET" && rest === "/me")
        return json(200, await manage.memberView(tag, who, token));
      // The week in the clan: every member's, any clan, any size.
      if (method === "GET" && rest === "/week") {
        const week = event.queryStringParameters?.week ?? null;
        if (week !== null && !/^[0-9]{4}-[Ww][0-9]{2}$/.test(week))
          return json(400, { error: "bad_request" });
        return json(200, await manage.weekView(tag, who, token, { week }));
      }
      if (method === "GET" && rest === "/season")
        return json(200, await manage.seasonView(tag, who, token));
      // A member's own away: their page, their word, the policy's cap.
      if (rest === "/me/away") {
        if (method === "GET") return json(200, await manage.myAway(tag, who));
        if (method === "PUT")
          return json(200, await manage.setAway(tag, who, body, token));
        if (method === "DELETE") {
          await manage.clearAway(tag, who, token);
          return json(200, { ok: true });
        }
      }
      // Core context keeps the existing person/session Clan audience and
      // requires verified membership. It is not an agent or public API door.
      if (method === "GET" && rest === "/policy/context") {
        if (who.verified !== true)
          return json(403, { error: "gate", reason: "unverified" });
        return json(200, await manage.policyContext(tag, who));
      }
      if (method === "GET" && rest === "/policy")
        return json(200, await manage.policyView(tag, who, token));
      if (method === "POST" && rest === "/policy")
        return json(
          200,
          await manage.savePolicy(
            tag,
            who,
            body.values ?? {},
            body.note ?? null,
            token,
            body.expected_version ?? null,
          ),
        );
      if (method === "POST" && rest === "/policy/preview")
        return json(
          200,
          await manage.previewPolicy(tag, who, token, body.values ?? {}),
        );
      if (method === "GET" && rest === "/actions") {
        const view = await manage.actionsView(tag, who, token, {
          refresh: event.queryStringParameters?.refresh === "1",
        });
        // Leaders are told whether the clan's model can draft messages.
        if (model && ["leader", "coLeader"].includes(who.role))
          view.model = await model.summary(tag);
        return json(200, view);
      }
      // One action by its number, for "take a look at action 37".
      const byNumber = /^\/actions\/([0-9]{1,7})$/.exec(rest);
      if (method === "GET" && byNumber) {
        const view = await manage.actionByNumber(
          tag,
          who,
          Number(byNumber[1]),
          token,
        );
        if (model && ["leader", "coLeader"].includes(who.role))
          view.model = await model.summary(tag);
        return json(200, view);
      }
      const reopen = /^\/actions\/([A-Za-z0-9_-]+)\/reopen$/.exec(rest);
      if (method === "POST" && reopen)
        return json(200, await manage.reopen(tag, who, reopen[1], body, token));
      const decide = /^\/actions\/([A-Za-z0-9_-]+)\/decide$/.exec(rest);
      const sentMessage =
        /^\/actions\/([A-Za-z0-9_-]+)\/messages\/([0-9]{1,3})\/sent$/.exec(
          rest,
        );
      if (method === "POST" && sentMessage)
        return json(
          200,
          await manage.messageSent(
            tag,
            who,
            sentMessage[1],
            Number(sentMessage[2]),
            body,
            token,
          ),
        );
      if (method === "POST" && decide)
        return json(200, await manage.decide(tag, who, decide[1], body, token));
      // What the clan records in Elixir (door 3): read-only, always on.
      if (rest === "/sharing" && method === "GET")
        return json(200, await manage.sharingView(tag, who));
      const comment = /^\/actions\/([A-Za-z0-9_-]+)\/comments$/.exec(rest);
      if (method === "POST" && comment)
        return json(200, await manage.comment(tag, who, comment[1], body.text));
      const hold = /^\/holds\/([0-9A-Za-z]{3,12})$/.exec(rest);
      if (hold) {
        const ptag = normalizeTag(hold[1]);
        if (!ptag) return json(400, { error: "bad_request" });
        if (method === "PUT")
          return json(200, await manage.setHold(tag, who, ptag, body));
        if (method === "DELETE") {
          await manage.clearHold(tag, who, ptag, token);
          return json(200, { ok: true });
        }
      }
      const notes = /^\/members\/([0-9A-Za-z]{3,12})\/notes$/.exec(rest);
      if (notes) {
        const ptag = normalizeTag(notes[1]);
        if (!ptag) return json(400, { error: "bad_request" });
        if (method === "GET")
          return json(200, { notes: await manage.notesFor(tag, who, ptag) });
        if (method === "POST")
          return json(200, await manage.addNote(tag, who, ptag, body.text));
      }
      const note = /^\/notes\/([A-Za-z0-9_-]+)$/.exec(rest);
      if (method === "DELETE" && note) {
        await manage.removeNote(tag, who, note[1]);
        return json(200, { ok: true });
      }
      if (method === "GET" && rest === "/standing")
        return json(200, await manage.standing(tag, who, token));
      if (awards) {
        if (method === "POST" && rest === "/awards/update")
          return json(
            200,
            await awards.currentUpdate(tag, who, token, body.request_id),
          );
        if (method === "GET" && ["/awards", "/awards/manage"].includes(rest))
          return json(
            200,
            await awards.manageView(tag, who, token, {
              refresh: event.queryStringParameters?.refresh === "1",
            }),
          );
        if (method === "POST" && rest === "/awards/config")
          return json(
            200,
            await awards.saveConfig(
              tag,
              who,
              body.values ?? {},
              body.note ?? null,
            ),
          );
        if (method === "POST" && rest === "/awards/grants") {
          const ptag = normalizeTag(String(body.player_tag ?? ""));
          if (!ptag) return json(400, { error: "bad_request" });
          return json(
            200,
            await awards.grant(tag, who, { ...body, player_tag: ptag }),
          );
        }
        const grant =
          /^\/awards\/grants\/([0-9]{1,4})\/([a-z][a-z0-9_]{1,31})\/([0-9A-Za-z]{3,12})$/.exec(
            rest,
          );
        if (method === "DELETE" && grant) {
          const ptag = normalizeTag(grant[3]);
          if (!ptag) return json(400, { error: "bad_request" });
          await awards.revoke(tag, who, {
            season_id: Number(grant[1]),
            award_id: grant[2],
            player_tag: ptag,
          });
          return json(200, { ok: true });
        }
        // The clan's trophy case, for every member.
        if (method === "GET" && rest === "/trophies")
          return json(200, await awards.trophyCase(tag, who, token));
        // One member's trophy case.
        const trophy = /^\/members\/([0-9A-Za-z]{3,12})\/grants$/.exec(rest);
        if (method === "GET" && trophy) {
          const ptag = normalizeTag(trophy[1]);
          if (!ptag) return json(400, { error: "bad_request" });
          return json(200, { grants: await awards.forMember(tag, ptag) });
        }
      }
      if (method === "POST" && rest === "/scout") {
        if (!["leader", "coLeader", "elder"].includes(who.role))
          return json(403, { error: "elders_only" });
        // Scout works before a clan has a policy: the applicant's own
        // statistics, with nothing of the clan's to check them against.
        const policy = await manage.policyFor(tag);
        const r = await scout({
          token,
          tagInput: body.tag,
          policy: policy.set ? policy.values : null,
        });
        return json(r.ok ? 200 : r.status === 401 ? 401 : 400, r);
      }
      return json(404, { error: "not_found" });
    } catch (err) {
      if (err?.status) {
        if (err.code === "session_expired")
          return signedOut({ reason: "session_expired" });
        return json(err.status, {
          error: err.code,
          ...(err.errors ? { errors: err.errors } : {}),
          ...(err.detail ?? {}),
        });
      }
      throw err;
    }
  }

  return function handler(event, { lockMs = null } = {}) {
    const method = event.requestContext?.http?.method ?? event.httpMethod;
    const path = mountedPath(event.rawPath ?? event.path ?? "/");
    return withTrace(
      {
        http: routeKey(method, path),
        request_id: event.requestContext?.requestId ?? null,
        ...(Number.isFinite(lockMs) && lockMs >= 0 ? { lock_ms: lockMs } : {}),
      },
      async () => {
        const trace = current();
        // The trusted request adapter acquired its lock before this trace.
        trace.started -= trace.meta.lock_ms ?? 0;
        const res = await dispatch(event, method, path);
        const summary = summarize(trace, res.statusCode ?? 200);
        (summary.level === "warn" ? log.warn : log.info)?.(
          JSON.stringify(summary),
        );
        return {
          ...res,
          headers: {
            ...(res.headers ?? {}),
            "server-timing": serverTiming(summary),
          },
        };
      },
    );
  };

  async function dispatch(event, method, path) {
    try {
      if (
        (manage || awards || recruit || social || memberActivity) &&
        path.startsWith("/api/clans/")
      ) {
        const answered = await manageRoute(event, method, path);
        if (answered) return answered;
      }
      if (
        feedback &&
        (path.startsWith("/api/feedback") ||
          path.startsWith("/api/maintain/feedback"))
      )
        return await feedbackRoute(event, method, path);
      if (method === "GET" && path === "/api/health")
        return json(200, { ok: true });
      if (method === "GET" && path === "/auth/login")
        return await identity.login(event);
      if (path === "/auth/callback")
        return json(410, { error: "retired_oauth_callback" });
      if (method === "POST" && path === "/auth/logout")
        return await identity.logout(event);
      if (method === "GET" && path === "/api/me") return await me(event);
      if (method === "POST" && path === "/api/select")
        return await select(event);
      if (method === "POST" && path === "/api/verify-notice")
        return await acknowledgeVerify(event);
      if (method === "GET" && path === "/api/roster")
        return await roster(event);
      if (social && path === "/api/me/place")
        return await placeRoute(event, method);
      return json(404, { error: "not_found" });
    } catch (error) {
      log.error?.("unhandled", { path, error: error?.message });
      return json(500, { error: "internal" });
    }
  }
}

/**
 * This API as Elixir serves it, under /api/clan (2026-09-28), read in the
 * form the routes name: /api/clan/auth/* is /auth/*, and any other
 * /api/clan/* is /api/*. A path already in that form is itself, as the
 * tests and the HTTP API's own execute-api address call it.
 */
export function mountedPath(path) {
  if (path.startsWith("/api/clan/auth/")) return path.slice("/api/clan".length);
  if (path.startsWith("/api/clan/"))
    return `/api/${path.slice("/api/clan/".length)}`;
  return path;
}

/**
 * The request as the log names it: ids and tags replaced by `*` so one
 * route is one series, never a line per member.
 */
export function routeKey(method, path) {
  const generic = path
    .replace(/^\/api\/clans\/[0-9A-Za-z]+/, "/api/clans/*")
    .replace(/\/(actions|notes|holds|members)\/[^/]+/g, "/$1/*")
    .replace(/\/messages\/[0-9]+\/sent$/, "/messages/*/sent")
    .replace(/\/awards\/grants\/.+$/, "/awards/grants/*")
    .replace(/^(\/api\/(?:maintain\/)?feedback)\/[^/]+$/, "$1/*");
  return `${method} ${generic}`;
}

/** The roster's events the clan page shows as comings and goings: joins,
 *  departures and the clan's own race results, newest first. Role
 *  changes stay on The week. */
const COMINGS = new Set(["member_joined", "member_left", "week_resolved"]);
const COMINGS_SHOWN = 6;

/** The roster as the page wants it: grouped by role rank, then trophies,
 *  the signed-in person's row marked, the API's role spelling kept beside
 *  its label. Nothing is added that the tool did not say. The clan's own
 *  figures (what it asks of a joiner, its war trophies, its donations a
 *  week) and its newest comings and goings ride along for the clan page
 *  (the October 2026 canvas). */
export function shapeRoster(body, { yourTags = [] }) {
  const yours = new Set(yourTags);
  const members = (body.members ?? [])
    .map((m) => ({
      player_tag: m.player_tag,
      name: m.name ?? null,
      role: m.role ?? null,
      role_label: roleLabel(m.role),
      trophies: m.trophies ?? null,
      donations_this_week: m.donations_this_week ?? null,
      last_recorded_battle: m.last_recorded_battle ?? null,
      last_seen_in_game: m.last_seen_in_game ?? null,
      first_observed_in_clan: m.first_observed_in_clan ?? null,
      rejoined_observed_at: m.rejoined_observed_at ?? null,
      you: yours.has(m.player_tag),
    }))
    .sort(
      (a, b) =>
        roleRank(a.role) - roleRank(b.role) ||
        (b.trophies ?? -1) - (a.trophies ?? -1) ||
        String(a.name).localeCompare(String(b.name)),
    );
  const roleCounts = {};
  for (const m of members) roleCounts[m.role] = (roleCounts[m.role] ?? 0) + 1;
  return {
    clan_tag: body.clan_tag,
    name: body.name ?? null,
    member_count: body.member_count ?? members.length,
    type: body.type ?? null,
    description: body.description ?? null,
    required_trophies: body.required_trophies ?? null,
    clan_war_trophies: body.clan_war_trophies ?? null,
    donations_per_week: body.donations_per_week ?? null,
    scores_observed_at: body.scores_observed_at ?? null,
    role_counts: roleCounts,
    members,
    comings: (Array.isArray(body.recent_events) ? body.recent_events : [])
      .filter((e) => COMINGS.has(e?.type) && e.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, COMINGS_SHOWN)
      .map((e) => ({
        type: e.type,
        at: e.at,
        player_tag: e.detail?.player_tag ?? null,
        name: e.detail?.name ?? null,
        season_id: e.detail?.season_id ?? null,
        section_index: e.detail?.section_index ?? null,
        is_colosseum: e.detail?.is_colosseum === true,
        rank: e.detail?.rank ?? null,
        fame: e.detail?.fame ?? null,
        trophy_change: e.detail?.trophy_change ?? null,
      })),
    events_recorded_since: body.events_recorded_since ?? null,
    your_tags: [...yours],
    notes: Array.isArray(body.notes) ? body.notes : [],
    docs: body.docs ?? null,
    meta: {
      as_of: body.meta?.as_of ?? null,
      freshness_seconds: body.meta?.freshness_seconds ?? null,
      source_polls: body.meta?.source_polls ?? null,
      completeness_note: body.meta?.completeness_note ?? null,
      contract_version: body.meta?.contract_version ?? null,
      disclaimer: body.meta?.disclaimer ?? null,
      timezone_applied: body.meta?.timezone_applied ?? null,
    },
  };
}
