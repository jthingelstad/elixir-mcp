import { test } from "node:test";
import assert from "node:assert/strict";
import { makeJmapSender } from "../src/jmap.mjs";
import { renderEmail } from "../src/templates.mjs";
import { makeHandler } from "../src/handler.mjs";

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
