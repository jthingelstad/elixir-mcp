import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationCursors } from "../src/conversations.mjs";

test("conversation cursors conceal denied-row metadata and bind both account and purpose key", () => {
  const cursors = conversationCursors([
    "synthetic-current",
    "synthetic-previous",
  ]);
  const tuple = {
    id: "tl_0123456789abcdef0099",
    at: "2026-11-18T10:00:00.123456Z",
  };
  const token = cursors.write("invented-member", tuple);
  const visibleEnvelope = Buffer.from(token, "base64url").toString();
  assert.ok(
    !visibleEnvelope.includes(tuple.id) && !visibleEnvelope.includes(tuple.at),
  );
  assert.deepEqual(cursors.read("invented-member", token), tuple);
  assert.equal(cursors.read("another-member", token), null);
  assert.equal(
    conversationCursors("different-key").read("invented-member", token),
    null,
  );
  const envelope = JSON.parse(visibleEnvelope);
  envelope.ct = (envelope.ct[0] === "A" ? "B" : "A") + envelope.ct.slice(1);
  assert.equal(
    cursors.read(
      "invented-member",
      Buffer.from(JSON.stringify(envelope)).toString("base64url"),
    ),
    null,
  );
  assert.equal(cursors.read("invented-member", "broken"), null);
  assert.equal(conversationCursors(null), null);
  const old = conversationCursors("synthetic-previous").write(
    "invented-member",
    tuple,
  );
  assert.deepEqual(
    cursors.read("invented-member", old),
    tuple,
    "existing current/previous rotation remains supported",
  );
});
