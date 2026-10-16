import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail } from "../src/templates.mjs";
import { makeHandler, queueUrlOf } from "../src/handler.mjs";
import { makeButtondownEnroller } from "../src/index.mjs";
import { makeSesSender, makeSuppressionCheck } from "../src/ses.mjs";

test("login template leads with the code and carries link, consent, disclaimer", () => {
  const { subject, text, html } = renderEmail({
    v: 1,
    kind: "login",
    to: "j@x.com",
    code: "123456",
    token: "tok_abc",
    client_name: "Claude",
  });
  assert.match(subject, /^123456 /);
  assert.match(text, /^Your Elixir sign-in code is 123456/);
  // The preheader repeats the code, phrased for Apple Mail's detector.
  assert.match(
    html,
    /<span style="display:none[^"]*"[^>]*>Your Elixir sign-in code is 123456\. It expires in 15 minutes\.<\/span>/,
  );
  // The token rides the fragment, which never leaves the browser: a
  // query string would reach the CDN's access logs (#129).
  assert.match(text, /\/console\/signin#login_token=tok_abc/);
  assert.doesNotMatch(text, /\?login_token=/);
  assert.match(text, /signing in to Claude with Elixir/);
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

test("the sign-in code and the welcome wear the one mail shell: the Elixir wordmark, the logo, no unsubscribe", () => {
  const login = renderEmail({
    v: 1,
    kind: "login",
    to: "j@x.com",
    code: "123456",
    token: "tok_abc",
  });
  const welcome = renderEmail({ v: 1, kind: "welcome", to: "j@x.com" });
  const notice = renderEmail({
    v: 1,
    kind: "owner_notify",
    to: "o@x.com",
    notify_kind: "feedback",
  });
  assert.equal(login.subject, "123456 is your Elixir sign-in code");
  assert.equal(welcome.subject, "Your Elixir account is ready");
  for (const [name, m] of [
    ["login", login],
    ["welcome", welcome],
    ["owner_notify", notice],
  ]) {
    assert.ok(
      m.html.includes(
        'src="https://elixir.poapkings.com/assets/mail/elixir-96.png"',
      ),
      `${name} logo`,
    );
    assert.match(m.html, />Elixir</, `${name} wordmark`);
    assert.ok(!/ELIXIR|Elixir MCP<|Elixir&nbsp;MCP/.test(m.html), name);
    assert.ok(!/unsubscribe|Turn off|Manage your emails/i.test(m.html), name);
    assert.match(m.html, /not endorsed by Supercell/, `${name} disclaimer`);
    assert.ok(!/display:\s*(flex|grid)/.test(m.html), `${name} tables only`);
  }
  assert.match(login.html, />Account<\/span>/);
  assert.match(welcome.html, />Account<\/span>/);
  assert.match(login.html, /tinylytics[^"]*%2Fmail%2Flogin/);
  assert.match(welcome.html, /tinylytics[^"]*%2Fmail%2Fwelcome/);
  assert.ok(
    !/tinylytics/.test(notice.html),
    "the operator's own mail is never counted",
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

test("an enroll-only message enrolls and sends no mail; a failure never retries", async () => {
  const sent = [];
  const enrolled = [];
  const handler = makeHandler({
    send: async (m) => sent.push(m),
    enroll: async (email) => enrolled.push(email),
  });
  const rec = (id, body) => ({ messageId: id, body: JSON.stringify(body) });
  const out = await handler({
    Records: [
      rec("a", { kind: "newsletter_enroll", to: " list@x.com " }),
      rec("b", { kind: "newsletter_enroll", to: "nobody" }),
    ],
  });
  assert.deepEqual(enrolled, ["list@x.com"]);
  assert.deepEqual(sent, [], "no mail");
  assert.deepEqual(out.batchItemFailures, [{ itemIdentifier: "b" }]);

  const boom = makeHandler({
    send: async (m) => sent.push(m),
    enroll: async () => {
      throw new Error("503");
    },
  });
  const out2 = await boom({
    Records: [rec("c", { kind: "newsletter_enroll", to: "list@x.com" })],
  });
  assert.deepEqual(out2.batchItemFailures, []);
  assert.deepEqual(sent, []);
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

test("Buttondown enrollment carries the viewer IP through the outbox, without exposing it in mail", async () => {
  const requests = [];
  const sent = [];
  const objects = new Map();
  const deleted = [];
  for (const [id, kind, ip] of [
    ["ipv4", "login", "203.0.113.17"],
    ["ipv6", "welcome", "2001:db8::17"],
    ["opt-out", "welcome", "203.0.113.18"],
    ["import", "newsletter_enroll", undefined],
    ["old", "login", undefined],
    ["invalid", "welcome", "unknown"],
  ]) {
    objects.set(
      `email/${id}.json`,
      JSON.stringify({
        v: 1,
        kind,
        to: `${id}@example.com`,
        code: "123456",
        newsletter: id !== "opt-out",
        ...(ip ? { ip_address: ip } : {}),
      }),
    );
  }
  const handler = makeHandler({
    send: async (m) => sent.push(m),
    enroll: makeButtondownEnroller({
      token: "test-token",
      fetchImpl: async (url, options) => {
        requests.push({ url, ...options, body: JSON.parse(options.body) });
        return { ok: true };
      },
    }),
    readObject: async ({ key }) => objects.get(key),
    deleteObject: async ({ key }) => deleted.push(key),
  });
  const result = await handler({
    Records: [...objects.keys()].map((key) => ({
      messageId: key,
      body: JSON.stringify({
        Records: [
          {
            eventSource: "aws:s3",
            s3: { bucket: { name: "outbox" }, object: { key } },
          },
        ],
      }),
    })),
  });
  assert.deepEqual(result.batchItemFailures, []);
  assert.equal(deleted.length, 6);
  assert.equal(sent.length, 5, "the import sends no mail");
  assert.deepEqual(
    requests.map(({ body }) => [body.email_address, body.ip_address]),
    [
      ["ipv4@example.com", "203.0.113.17"],
      ["ipv6@example.com", "2001:db8::17"],
      ["import@example.com", undefined],
      ["old@example.com", undefined],
      ["invalid@example.com", undefined],
    ],
  );
  for (const request of requests) {
    assert.equal(request.url, "https://api.buttondown.com/v1/subscribers");
    assert.equal(request.method, "POST");
    assert.equal(request.body.type, "regular");
    assert.equal(request.headers["X-Buttondown-Bypass-Firewall"], undefined);
  }
  for (const mail of sent)
    assert.doesNotMatch(JSON.stringify(mail), /203\.0\.113\.|2001:db8/);
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
  assert.equal(render("access_request").subject, "Elixir: new access request");
  assert.equal(
    render("feedback", { detail: { category: "bug" } }).subject,
    "Elixir: new feedback - bug",
  );
  assert.equal(render("feedback").subject, "Elixir: new feedback");
  assert.equal(
    render("role_upgrade_request").subject,
    "Elixir: tier upgrade request",
  );
  assert.equal(render("gateway_request").subject, "Elixir: collector enrolled");
  assert.equal(
    render("gateway_quarantined").subject,
    "Elixir: collector quarantined",
  );
  assert.equal(render("approved_welcome").subject, "Elixir: account approved");
  // A message from before the kind existed still renders, generically.
  assert.equal(render(undefined).subject, "Elixir: notification");
  const fb = render("feedback", {
    note: "battles_query pagination took five calls",
    detail: {
      category: "feature",
      surface: "mcp",
      from: "agent 272bd891a21d",
      feedback_id: "25",
    },
    link: "https://elixir.poapkings.com/console/admin",
  });
  assert.match(fb.text, /New feedback\./);
  assert.match(fb.text, /battles_query pagination took five calls/);
  assert.match(fb.text, /category: feature/);
  assert.match(fb.text, /from: agent 272bd891a21d/);
  assert.match(
    fb.text,
    /Act on it: https:\/\/elixir\.poapkings\.com\/console\/admin/,
  );
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
  assert.equal(sent[0].subject, "Elixir: new feedback");
});

test("relay failure logs are bounded and never include transport error detail", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  const sensitive = new Error(
    "delivery for member@example.com included private message body",
  );
  const record = (id, body) => ({ messageId: id, body: JSON.stringify(body) });

  const owner = makeHandler({
    send: async () => {
      throw sensitive;
    },
  });
  await owner({
    Records: [
      record("owner", {
        v: 1,
        kind: "owner_notify",
        to: "owner@example.com",
        note: "private message body",
      }),
    ],
  });

  const retry = makeHandler({
    send: async () => {
      throw sensitive;
    },
  });
  await retry({
    Records: [
      record("retry", { v: 1, kind: "welcome", to: "member@example.com" }),
    ],
  });

  const enrollment = makeHandler({
    send: async () => {},
    enroll: async () => {
      throw sensitive;
    },
  });
  await enrollment({
    Records: [
      record("enroll", {
        v: 1,
        kind: "login",
        to: "member@example.com",
        code: "123456",
        newsletter: true,
      }),
    ],
  });

  const outbox = makeHandler({
    send: async () => {},
    readObject: async () =>
      JSON.stringify({ v: 1, kind: "welcome", to: "member@example.com" }),
    deleteObject: async () => {
      throw sensitive;
    },
  });
  await outbox({
    Records: [
      record("outbox", {
        Records: [
          {
            eventSource: "aws:s3",
            s3: { bucket: { name: "outbox" }, object: { key: "email/1.json" } },
          },
        ],
      }),
    ],
  });

  assert.deepEqual(errors, [
    ["owner_notify_drop", "transport_error"],
    ["send_retry", "transport_error"],
    ["buttondown_drop", "transport_error"],
    ["outbox_delete_failed", "transport_error"],
  ]);
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

test("retired direct, outbox and malformed editorial messages are consumed without sending", async () => {
  for (const kind of ["top_100", "card_of_week"]) {
    const deleted = [];
    const handler = makeHandler({
      send: () => {
        throw new Error("retired mail sent");
      },
      readObject: async () => JSON.stringify({ kind }),
      deleteObject: async (o) => deleted.push(o),
    });
    const direct = await handler({
      Records: [{ messageId: "direct", body: JSON.stringify({ kind }) }],
    });
    assert.deepEqual(direct.batchItemFailures, []);
    const body = JSON.stringify({
      Records: [
        {
          eventSource: "aws:s3",
          s3: {
            bucket: { name: "outbox" },
            object: { key: "email/test.json" },
          },
        },
      ],
    });
    const queued = await handler({ Records: [{ messageId: "queued", body }] });
    assert.deepEqual(queued.batchItemFailures, []);
    assert.equal(deleted.length, 1);
  }
});

test("verified signup welcome carries the explicit enrollment decision; unflagged welcome does not", async () => {
  const enrolled = [];
  const handler = makeHandler({
    send: async () => {},
    enroll: async (email) => enrolled.push(email),
  });
  const result = await handler({
    Records: [
      {
        messageId: "verified",
        body: JSON.stringify({
          v: 1,
          kind: "welcome",
          to: "new@example.com",
          newsletter: true,
        }),
      },
      {
        messageId: "plain",
        body: JSON.stringify({
          v: 1,
          kind: "welcome",
          to: "off@example.com",
          newsletter: false,
        }),
      },
    ],
  });
  assert.deepEqual(result.batchItemFailures, []);
  assert.deepEqual(enrolled, ["new@example.com"]);
  const welcome = renderEmail({ v: 1, kind: "welcome", to: "new@example.com" });
  assert.match(welcome.text, /Add your player in Console/);
  assert.doesNotMatch(welcome.text, /already being recorded/);
});

test("a Discord lane that knows when to try again holds its record back that long; the last receive is final", async () => {
  const deferred = [];
  const seen = [];
  const later = Object.assign(new Error("timeline_discord_rate_limited"), {
    code: "rate_limited",
    retryAfterMs: 61_500,
  });
  let answer = later;
  const handler = makeHandler({
    send: async () => {},
    timelineDiscordObject: async (obj, opts) => {
      seen.push(opts);
      if (answer) throw answer;
    },
    defer: async (record, seconds) => {
      deferred.push([record.receiptHandle, seconds]);
    },
    discordMaxReceives: 20,
  });
  const record = (count) => ({
    messageId: `m${count}`,
    receiptHandle: `rh${count}`,
    eventSourceARN:
      "arn:aws:sqs:us-east-1:123456789012:elixir-mcp-timeline-discord",
    attributes: { ApproximateReceiveCount: String(count) },
    body: JSON.stringify({
      Records: [
        {
          eventSource: "aws:s3",
          s3: {
            bucket: { name: "outbox" },
            object: { key: "timeline-discord/x.json" },
          },
        },
      ],
    }),
  });
  const out = await handler({ Records: [record(1)] });
  assert.deepEqual(out.batchItemFailures, [{ itemIdentifier: "m1" }]);
  assert.deepEqual(deferred, [["rh1", 62]], "Discord's wait, not six minutes");
  assert.deepEqual(seen, [{ final: false }]);

  // An error with no wait keeps the queue's own timeout.
  answer = new Error("boom");
  await handler({ Records: [record(2)] });
  assert.equal(deferred.length, 1);

  answer = null;
  const last = await handler({ Records: [record(20)] });
  assert.deepEqual(last.batchItemFailures, []);
  assert.deepEqual(seen.at(-1), { final: true });
});

test("a record's queue is found from its ARN", () => {
  assert.equal(
    queueUrlOf(
      "arn:aws:sqs:us-east-1:123456789012:elixir-mcp-timeline-discord",
    ),
    "https://sqs.us-east-1.amazonaws.com/123456789012/elixir-mcp-timeline-discord",
  );
  assert.equal(queueUrlOf("arn:aws:sns:us-east-1:123456789012:x"), null);
  assert.equal(queueUrlOf(undefined), null);
});

test("code-only OAuth mail describes the client without promising a link or another consent page", () => {
  const { text, html } = renderEmail({
    kind: "login",
    code: "482913",
    client_name: "Elixir <Drop>",
  });
  assert.match(text, /^Your Elixir sign-in code is 482913/);
  assert.match(text, /signing in to Elixir <Drop> with Elixir/);
  assert.match(html, /Elixir &lt;Drop&gt;/);
  assert.doesNotMatch(
    text + html,
    /code and (?:the )?link|next page|authorizes|login_token=/,
  );
  assert.match(text, /code expires in 15 minutes/);
  assert.match(html, /This code expires in 15 minutes/);
});

test("welcome starts the record and every service mail includes the disclaimer in both alternatives", () => {
  const welcome = renderEmail({ kind: "welcome" });
  assert.match(
    welcome.html,
    /href="https:\/\/elixir.poapkings.com\/console\/account\/tracking"[^>]*>Start your record/,
  );
  assert.doesNotMatch(welcome.html, /when your access is approved/);
  for (const kind of ["login", "welcome", "owner_notify"]) {
    const out = renderEmail({ kind, code: "482913", note: "Example <notice>" });
    for (const body of [out.html, out.text])
      assert.match(body, /not endorsed by Supercell/);
  }
});

test("an address SES suppresses is skipped and logged by send id and reason, never by address; a failed lookup still sends", async () => {
  const report = {
    v: 1,
    kind: "tracking_report",
    to: "gone@example.com",
    subject: "Your friends this week",
    text: "the text part",
    html: "<p>the html part</p>",
    issue_key: "tracking_report/2026-W41",
    send_id: "11111111-2222-3333-4444-555555555555",
    unsubscribe: {
      url: "https://elixir.poapkings.com/api/email/unsubscribe?t=abc",
    },
  };
  const record = (id, body) => ({ messageId: id, body: JSON.stringify(body) });
  const sent = [];
  const logged = [];
  const log = console.log;
  console.log = (...args) => logged.push(args.join(" "));
  try {
    const handler = makeHandler({
      send: async (m) => {
        sent.push(m.to);
        return { sent: true, message_id: "m" };
      },
      suppressed: async (to) => (to === "gone@example.com" ? "BOUNCE" : null),
    });
    const out = await handler({
      Records: [
        record("a", report),
        record("b", { ...report, to: "here@example.com" }),
        record("c", {
          v: 1,
          kind: "owner_notify",
          to: "gone@example.com",
          subject: "s",
          text: "t",
        }),
      ],
    });
    assert.deepEqual(out.batchItemFailures, [], "a skip is done, not a retry");
    assert.deepEqual(sent, ["here@example.com"]);
    const skip = logged.find((l) =>
      l.startsWith("mail_suppressed tracking_report"),
    );
    assert.equal(
      skip,
      "mail_suppressed tracking_report 11111111-2222-3333-4444-555555555555 tracking_report/2026-W41 BOUNCE",
    );
    assert.ok(logged.some((l) => l.startsWith("mail_suppressed owner_notify")));
    assert.ok(logged.every((l) => !l.includes("gone@example.com")));
  } finally {
    console.log = log;
  }

  // The lookup failing (throttled, or the permission not yet deployed)
  // never stops mail: it sends as before, with a bounded log line.
  const errors = [];
  const error = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const both = [];
    const handler = makeHandler({
      send: async (m) => both.push(m.to),
      suppressed: async () => {
        const e = new Error("rate exceeded for gone@example.com");
        e.name = "TooManyRequestsException";
        throw e;
      },
    });
    await handler({ Records: [record("a", report)] });
    assert.deepEqual(both, ["gone@example.com"]);
    assert.deepEqual(errors, [
      "suppression_check_failed TooManyRequestsException",
    ]);
  } finally {
    console.error = error;
  }
});

test("the suppression check: the listed reason, null when SES does not list the address, a throw otherwise", async () => {
  const asked = [];
  const check = makeSuppressionCheck({
    client: {
      send: async (cmd) => {
        asked.push(cmd.input.EmailAddress);
        if (cmd.input.EmailAddress === "listed@example.com")
          return { SuppressedDestination: { Reason: "COMPLAINT" } };
        const e = new Error("not found");
        e.name =
          cmd.input.EmailAddress === "boom@example.com"
            ? "AccessDeniedException"
            : "NotFoundException";
        throw e;
      },
    },
  });
  assert.equal(await check("listed@example.com"), "COMPLAINT");
  assert.equal(await check("fine@example.com"), null);
  await assert.rejects(check("boom@example.com"), /not found/);
  assert.deepEqual(asked, [
    "listed@example.com",
    "fine@example.com",
    "boom@example.com",
  ]);
});
