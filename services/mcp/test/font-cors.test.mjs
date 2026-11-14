import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const template = readFileSync(
  new URL("../../../infra/template.yaml", import.meta.url),
  "utf8",
);
const block = template.slice(
  template.indexOf("\n  FontCors:"),
  template.indexOf("\n  AlarmTopic:"),
);
const lines = block
  .slice(block.indexOf("      FunctionCode: |"))
  .split("\n")
  .slice(1);
const script = [];
for (const line of lines) {
  if (line.trim() && !line.startsWith("        ")) break;
  script.push(line);
}
const code = script.join("\n");
const handle = new Function(`${code}\nreturn handler;`)();

test("mail fonts are cross-origin readable without opening application responses", () => {
  for (const uri of [
    "/assets/fonts/Clash_Regular.otf",
    "/assets/fonts/Rubik-latin.woff2",
    "/assets/fonts/Inter-Regular.ttf",
  ])
    for (const method of ["GET", "HEAD"])
      for (const statusCode of [200, 206, 304]) {
        const response = {
          statusCode,
          headers: { "x-content-type-options": { value: "nosniff" } },
        };
        const result = handle({ request: { uri, method }, response });
        assert.equal(result, response);
        assert.deepEqual(result.headers["access-control-allow-origin"], {
          value: "*",
        });
        assert.deepEqual(result.headers["x-content-type-options"], {
          value: "nosniff",
        });
        assert.equal(
          result.headers["access-control-allow-credentials"],
          undefined,
        );
      }
  for (const uri of [
    "/",
    "/home",
    "/api/me",
    "/api/clan/me",
    "/assets/site.css",
    "/assets/fonts/README.md",
    "/assets/fonts/../api/me",
    "/assets/fonts/fake.svg",
  ])
    assert.deepEqual(
      handle({
        request: { uri, method: "GET" },
        response: { statusCode: 200, headers: {} },
      }).headers,
      {},
    );
  for (const [method, statusCode] of [
    ["POST", 200],
    ["GET", 404],
    ["GET", 403],
    ["GET", 500],
  ])
    assert.deepEqual(
      handle({
        request: { uri: "/assets/fonts/Rubik-latin.woff2", method },
        response: { statusCode, headers: {} },
      }).headers,
      {},
    );
  const fallback = template.slice(
    template.indexOf("        DefaultCacheBehavior:"),
    template.indexOf("        CacheBehaviors:"),
  );
  assert.match(
    fallback,
    /EventType: viewer-response\n\s+FunctionARN: !GetAtt FontCors/,
  );
  const from = template.indexOf("        CacheBehaviors:");
  const to = template.indexOf("\n  WebAccessLogDelivery:", from);
  assert.ok(to > from);
  assert.doesNotMatch(template.slice(from, to), /FontCors/);
});
