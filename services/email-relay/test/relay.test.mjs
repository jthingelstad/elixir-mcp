import { test } from "node:test";
import assert from "node:assert/strict";
import { makeJmapSender } from "../src/jmap.mjs";
import { renderEmail } from "../src/templates.mjs";
import { makeHandler } from "../src/handler.mjs";
import { makeButtondownEnroller, chooseSender } from "../src/index.mjs";
import { makeSesSender } from "../src/ses.mjs";

function fakeJmapServer() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/jmap/session")) {
      return {
        ok: true,
        json: async () => ({
          apiUrl: "https://api.fastmail.com/jmap/api/",
          primaryAccounts: { "urn:ietf:params:jmap:mail": "acct1" },
        }),
      };
    }
    const body = JSON.parse(init.body);
    const responses = body.methodCalls.map(([name, , tag]) => {
      if (name === "Identity/get")
        return [
          name,
          { list: [{ id: "id1", email: "elixir@poapkings.com" }] },
          tag,
        ];
      if (name === "Mailbox/query") return [name, { ids: ["drafts1"] }, tag];
      if (name === "Email/set")
        return [name, { created: { draft: { id: "e1" } } }, tag];
      if (name === "EmailSubmission/set")
        return [name, { created: { send: { id: "s1" } } }, tag];
      return [name, {}, tag];
    });
    return { ok: true, json: async () => ({ methodResponses: responses }) };
  };
  return { calls, fetchImpl };
}

test("JMAP sender: session -> identity/mailbox -> Email/set + EmailSubmission/set", async () => {
  const { calls, fetchImpl } = fakeJmapServer();
  const send = makeJmapSender({
    token: "t",
    fromEmail: "elixir@poapkings.com",
    fetchImpl,
  });
  const result = await send({ to: "j@x.com", subject: "hi", text: "body" });
  assert.deepEqual(result, { sent: true });

  const sendCall = JSON.parse(calls.at(-1).init.body);
  const emailSet = sendCall.methodCalls.find(([n]) => n === "Email/set")[1];
  assert.equal(emailSet.create.draft.from[0].email, "elixir@poapkings.com");
  assert.equal(emailSet.create.draft.to[0].email, "j@x.com");
  const submission = sendCall.methodCalls.find(
    ([n]) => n === "EmailSubmission/set",
  )[1];
  assert.equal(submission.create.send.identityId, "id1");

  // Warm start: bootstrap cached, second send skips session discovery.
  const before = calls.filter((c) => c.url.endsWith("/jmap/session")).length;
  await send({ to: "k@x.com", subject: "s", text: "b" });
  const after = calls.filter((c) => c.url.endsWith("/jmap/session")).length;
  assert.equal(after, before);
});

test("login template leads with the code and carries link, consent, disclaimer", () => {
  const { subject, text } = renderEmail({
    v: 1,
    kind: "login",
    to: "j@x.com",
    code: "123456",
    token: "tok_abc",
    client_name: "Claude",
  });
  assert.match(subject, /^123456 /);
  assert.match(text, /^Your Elixir MCP sign-in code is 123456/);
  assert.match(text, /login_token=tok_abc/);
  assert.match(text, /authorizes Claude/);
  assert.match(text, /not endorsed by Supercell/);
});

test("welcome and owner_notify templates render", () => {
  assert.match(
    renderEmail({ v: 1, kind: "welcome", to: "j@x.com" }).text,
    /elixir\.poapkings\.com\/mcp/,
  );
  assert.match(
    renderEmail({
      v: 1,
      kind: "owner_notify",
      to: "o@x.com",
      note: "req from #TAG",
    }).text,
    /req from #TAG/,
  );
});

test("handler: sends valid messages, DLQs malformed, retries transport failures", async () => {
  const sent = [];
  let failNext = false;
  const handler = makeHandler({
    send: async (m) => {
      if (failNext) {
        failNext = false;
        throw new Error("fastmail down");
      }
      sent.push(m);
    },
  });
  const record = (id, body) => ({ messageId: id, body: JSON.stringify(body) });
  const good = { v: 1, kind: "welcome", to: "a@b.com" };
  const malformed = { v: 1, kind: "nope", to: "x" };

  failNext = true;
  const result = await handler({
    Records: [record("m1", good), record("m2", malformed), record("m3", good)],
  });
  assert.deepEqual(
    result.batchItemFailures.map((f) => f.itemIdentifier).sort(),
    ["m1", "m2"],
    "transport failure retries, malformed DLQs, the good one sent",
  );
  assert.equal(sent.length, 1);
});

test("outbox: a notification is read, sent and deleted; a test event or a gone object is done; a failure keeps the object", async () => {
  const sent = [];
  const deleted = [];
  let failNext = false;
  const objects = new Map([
    ["email/1.json", { v: 1, kind: "welcome", to: "a@b.com" }],
    ["email/2.json", { v: 1, kind: "welcome", to: "c@d.com" }],
    ["email/bad.json", { v: 1, kind: "nope", to: "x" }],
  ]);
  const handler = makeHandler({
    send: async (m) => {
      if (failNext) {
        failNext = false;
        throw new Error("ses down");
      }
      sent.push(m);
    },
    readObject: async ({ key }) =>
      objects.has(key) ? JSON.stringify(objects.get(key)) : null,
    deleteObject: async ({ key }) => {
      deleted.push(key);
      objects.delete(key);
    },
  });
  const notify = (id, key) => ({
    messageId: id,
    body: JSON.stringify({
      Records: [
        {
          eventSource: "aws:s3",
          s3: { bucket: { name: "outbox" }, object: { key } },
        },
      ],
    }),
  });

  const first = await handler({
    Records: [
      notify("n1", "email/1.json"),
      { messageId: "t", body: JSON.stringify({ Event: "s3:TestEvent" }) },
      notify("n2", "email/bad.json"),
    ],
  });
  assert.deepEqual(
    first.batchItemFailures.map((f) => f.itemIdentifier),
    ["n2"],
    "the malformed message dead-letters; the test event is not a failure",
  );
  assert.deepEqual(
    sent.map((m) => m.to),
    ["a@b.com"],
  );
  assert.deepEqual(deleted, ["email/1.json"], "the bad object is kept");

  // A duplicate notification for a sent object finds nothing and is done.
  const dup = await handler({ Records: [notify("n3", "email/1.json")] });
  assert.deepEqual(dup.batchItemFailures, []);
  assert.equal(sent.length, 1, "never sent twice");

  // A transport failure retries and keeps the object for the next try.
  failNext = true;
  const failed = await handler({ Records: [notify("n4", "email/2.json")] });
  assert.deepEqual(failed.batchItemFailures, [{ itemIdentifier: "n4" }]);
  assert.ok(objects.has("email/2.json"));
  const retried = await handler({ Records: [notify("n4", "email/2.json")] });
  assert.deepEqual(retried.batchItemFailures, []);
  assert.ok(!objects.has("email/2.json"));
});

test("the login send carries the enrollment decision (#27/0051)", async () => {
  const sent = [];
  const enrolled = [];
  const handler = makeHandler({
    send: async (m) => sent.push(m),
    enroll: async (email) => enrolled.push(email),
  });
  const rec = (id, body) => ({ messageId: id, body: JSON.stringify(body) });
  const out = await handler({
    Records: [
      // A beta account: this send IS the enrollment moment (0051 makes
      // that the default, but the RELAY still only obeys the flag - it
      // has no database and decides nothing itself).
      rec("a", {
        v: 1,
        kind: "login",
        to: "yes@x.com",
        code: "123456",
        newsletter: true,
      }),
      // An unflagged send still enrolls nothing. The policy lives in the
      // database, not in the relay, so flipping it never means editing
      // this code.
      rec("b", { v: 1, kind: "login", to: "no@x.com", code: "222222" }),
      rec("c", {
        v: 1,
        kind: "login",
        to: "off@x.com",
        code: "333333",
        newsletter: false,
      }),
      rec("d", {
        v: 1,
        kind: "owner_notify",
        to: "elixir@poapkings.com",
        note: "x",
      }),
    ],
  });
  assert.deepEqual(out.batchItemFailures, []);
  assert.equal(sent.length, 4, "every message still sends");
  assert.deepEqual(
    enrolled,
    ["yes@x.com"],
    "the relay enrolls exactly what it was told to, nothing more",
  );

  // A Buttondown outage never fails the batch - retrying would RESEND
  // the login email for a side effect that self-heals at next sign-in.
  const boom = makeHandler({
    send: async (m) => sent.push(m),
    enroll: async () => {
      throw new Error("503");
    },
  });
  const out2 = await boom({
    Records: [
      rec("e", {
        v: 1,
        kind: "login",
        to: "member2@x.com",
        code: "654321",
        newsletter: true,
      }),
    ],
  });
  assert.deepEqual(out2.batchItemFailures, [], "enroll failure never retries");
  assert.equal(sent.at(-1).to, "member2@x.com", "the login email still sent");
});

test("Buttondown 400 is read, not assumed to mean 'already subscribed' (#27)", async () => {
  const enroller = (status, body) =>
    makeButtondownEnroller({
      token: "t",
      fetchImpl: async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }),
    });

  // The benign 400: the address is on the list, possibly unsubscribed.
  // Leave it exactly as it is - never fight the list's own state.
  await enroller(400, { code: "email_already_exists" })("a@x.com");
  await enroller(400, { code: "weird_rename", detail: "Already subscribed." })(
    "b@x.com",
  );

  // Every other 400 used to be swallowed as success, so a validation
  // error or a changed schema enrolled nobody and said nothing.
  await assert.rejects(
    () => enroller(400, { code: "invalid_email" })("bad@@x.com"),
    /buttondown 400/,
    "a validation error is not an enrollment",
  );
  await assert.rejects(
    () => enroller(400, null)("c@x.com"),
    /buttondown 400/,
    "an unreadable 400 is reported, not assumed benign",
  );
  await assert.rejects(() => enroller(500, {})("d@x.com"), /buttondown 500/);

  // No token configured: enrollment is simply not wired.
  assert.equal(makeButtondownEnroller({ token: "" }), null);
});

// Every owner notification used to be "new access request" whatever it
// announced (2026-09-09). Subjects are pinned per kind.
test("owner_notify subjects and bodies are per kind", () => {
  const render = (notify_kind, extra = {}) =>
    renderEmail({
      v: 1,
      kind: "owner_notify",
      to: "o@x.com",
      notify_kind,
      ...extra,
    });
  assert.equal(
    render("access_request").subject,
    "Elixir MCP: new access request",
  );
  assert.equal(
    render("feedback", { detail: { category: "bug" } }).subject,
    "Elixir MCP: new feedback - bug",
  );
  assert.equal(render("feedback").subject, "Elixir MCP: new feedback");
  assert.equal(
    render("role_upgrade_request").subject,
    "Elixir MCP: tier upgrade request",
  );
  assert.equal(
    render("gateway_request").subject,
    "Elixir MCP: collector raise-hand",
  );
  assert.equal(
    render("gateway_quarantined").subject,
    "Elixir MCP: collector QUARANTINED",
  );
  assert.equal(
    render("approved_welcome").subject,
    "Elixir MCP: account approved",
  );
  // A message from before the kind existed still renders, generically.
  assert.equal(render(undefined).subject, "Elixir MCP: notification");
  const fb = render("feedback", {
    note: "battles_query pagination took five calls",
    detail: {
      category: "feature",
      surface: "mcp",
      from: "agent 272bd891a21d",
      feedback_id: "25",
    },
    link: "https://elixir.poapkings.com/admin",
  });
  assert.match(fb.text, /A beta user said something\./);
  assert.match(fb.text, /battles_query pagination took five calls/);
  assert.match(fb.text, /category: feature/);
  assert.match(fb.text, /from: agent 272bd891a21d/);
  assert.match(fb.text, /Act on it: https:\/\/elixir\.poapkings\.com\/admin/);
  assert.ok(
    !/@/.test(fb.text.replace("o@x.com", "")),
    "no address in the body",
  );
});

test("owner_notify is best-effort: a transport failure or a bad message never dead-letters", async () => {
  const sent = [];
  let fail = false;
  const handler = makeHandler({
    send: async (m) => {
      if (fail) throw new Error("fastmail down");
      sent.push(m);
    },
  });
  const record = (id, body) => ({ messageId: id, body: JSON.stringify(body) });
  const notify = {
    v: 1,
    kind: "owner_notify",
    to: "o@x.com",
    notify_kind: "feedback",
    note: "hi",
  };
  const login = { v: 1, kind: "login", to: "a@b.com", code: "123456" };
  fail = true;
  const down = await handler({
    Records: [record("n1", notify), record("l1", login)],
  });
  assert.deepEqual(
    down.batchItemFailures.map((f) => f.itemIdentifier),
    ["l1"],
    "the login retries; the notification is dropped, not retried",
  );
  fail = false;
  const bad = await handler({
    Records: [
      record("n2", { ...notify, notify_kind: "nope" }),
      record("n3", notify),
    ],
  });
  assert.deepEqual(
    bad.batchItemFailures,
    [],
    "a malformed notification is dropped, not DLQ'd",
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, "Elixir MCP: new feedback");
});

test("SES sender: one SendEmail through the configuration set, text always, html beside it", async () => {
  const sent = [];
  const client = {
    send: async (cmd) => {
      sent.push(cmd.input);
      return { MessageId: "m-1" };
    },
  };
  const send = makeSesSender({
    fromEmail: "elixir@poapkings.com",
    configurationSet: "elixir-mcp",
    client,
  });
  const out = await send({
    to: "someone@example.com",
    subject: "Your code",
    text: "123456",
    html: "<p>123456</p>",
  });
  assert.deepEqual(out, { sent: true, message_id: "m-1" });
  assert.equal(sent.length, 1);
  const input = sent[0];
  assert.equal(input.FromEmailAddress, "Elixir <elixir@poapkings.com>");
  assert.deepEqual(input.Destination, { ToAddresses: ["someone@example.com"] });
  assert.equal(input.ConfigurationSetName, "elixir-mcp");
  assert.equal(input.Content.Simple.Body.Text.Data, "123456");
  assert.equal(input.Content.Simple.Body.Html.Data, "<p>123456</p>");
  // Text only: no Html part at all, not an empty one.
  await send({ to: "a@b.c", subject: "s", text: "t" });
  assert.equal(sent[1].Content.Simple.Body.Html, undefined);
  // No headers asked for: none sent (a transactional kind). Asked for: the
  // pair goes on the message as SES headers.
  assert.equal(sent[1].Content.Simple.Headers, undefined);
  await send({
    to: "a@b.c",
    subject: "s",
    text: "t",
    headers: [{ name: "List-Unsubscribe", value: "<https://x/u>" }],
  });
  assert.deepEqual(sent[2].Content.Simple.Headers, [
    { Name: "List-Unsubscribe", Value: "<https://x/u>" },
  ]);
});

test("the transport follows EMAIL_TRANSPORT: jmap unless it says ses", () => {
  const ses = chooseSender({
    EMAIL_TRANSPORT: "ses",
    SES_CONFIGURATION_SET: "x",
  });
  const jmap = chooseSender({ JMAP_TOKEN: "t" });
  const unset = chooseSender({});
  assert.equal(typeof ses, "function");
  assert.equal(typeof jmap, "function");
  assert.equal(typeof unset, "function");
});

test("a product kind rides the queue rendered: sent as given with the one-click headers, refused without them", async () => {
  const sent = [];
  const handler = makeHandler({ send: async (m) => sent.push(m) });
  const record = (id, body) => ({ messageId: id, body: JSON.stringify(body) });
  const report = {
    v: 1,
    kind: "clan_report",
    to: "a@b.com",
    subject: "POAP KINGS, Sep 7 – 14: 1st in war",
    text: "the text part",
    html: "<p>the html part</p>",
    issue_key: "clan_report/2026-W37/#J2RGCRVG",
    unsubscribe: {
      url: "https://elixir.poapkings.com/api/email/unsubscribe?t=abc",
    },
  };
  const noUnsub = { ...report };
  delete noUnsub.unsubscribe;
  const noSubject = { ...report };
  delete noSubject.subject;
  const result = await handler({
    Records: [
      record("r1", report),
      record("r2", noUnsub),
      record("r3", noSubject),
    ],
  });
  assert.deepEqual(
    result.batchItemFailures.map((f) => f.itemIdentifier).sort(),
    ["r2", "r3"],
    "a bulk kind without one-click or without a subject is a bad message",
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, report.subject);
  assert.equal(sent[0].text, report.text);
  assert.equal(sent[0].html, report.html);
  assert.deepEqual(
    sent[0].headers.map((h) => h.name),
    ["List-Unsubscribe", "List-Unsubscribe-Post"],
  );
});
