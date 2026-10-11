import { expect, test } from "vitest";
import { untilWritten } from "../src/lib/pending.js";

const ok = (data) => ({ ok: true, status: 200, data });

test("a use that outlasts its request is asked for again with its id until it lands", async () => {
  const asked = [];
  const answers = [
    ok({ pending: "p1" }),
    ok({ pending: "p1" }),
    ok({ words: 1 }),
  ];
  const r = await untilWritten(
    async (pending) => {
      asked.push(pending);
      return answers.shift();
    },
    { pause: async () => {} },
  );
  expect(asked).toEqual([null, "p1", "p1"]);
  expect(r).toEqual(ok({ words: 1 }));
});

test("a refusal ends it, and so does the page's own limit", async () => {
  const refused = await untilWritten(async () => ({
    ok: false,
    data: { error: "model_spend_cap" },
  }));
  expect(refused.data.error).toBe("model_spend_cap");
  const late = await untilWritten(async () => ok({ pending: "p1" }), {
    forMs: 0,
    pause: async () => {},
  });
  expect(late).toEqual({ ok: false, data: { error: "still_pending" } });
});
