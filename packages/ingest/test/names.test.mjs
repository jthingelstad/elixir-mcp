import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, cleanPayloadNames } from "../src/names.mjs";

test("colour markup leaves a name, wherever and however it was typed", () => {
  assert.equal(cleanName("<c2>Stoat"), "Stoat");
  assert.equal(cleanName("<c0> Stoat"), "Stoat");
  assert.equal(cleanName("<c9>Sto<c5>at"), "Stoat");
  assert.equal(cleanName("<c2>Stoat<\\c>"), "Stoat");
  assert.equal(cleanName("<C2>Stoat</c>"), "Stoat");
  assert.equal(cleanName("< c2>Stoat"), "Stoat");
});

test("a name that only looks like markup is the player's own", () => {
  for (const name of ["<Ox>~Stoat", "4<Stoat", "<c", "<c>", "a<b>c", "Stoat"])
    assert.equal(cleanName(name), name);
});

test("a name that is nothing but markup stays rather than becoming no name", () => {
  assert.equal(cleanName("<c2>"), "<c2>");
});

test("every name in a payload is cleaned, and nothing else moves", () => {
  const payload = {
    tag: "#P",
    name: "<c1>Stoat",
    clan: { tag: "#C", name: "<c3>Otters<\\c>", description: "<c2>keep" },
    team: [{ name: "<c2>Ferret", cards: [{ name: "Hog Rider", id: 1 }] }],
    memberList: [{ name: "<c4>Marten", trophies: 3 }, null, 7],
  };
  assert.equal(cleanPayloadNames(payload), payload);
  assert.deepEqual(payload, {
    tag: "#P",
    name: "Stoat",
    clan: { tag: "#C", name: "Otters", description: "<c2>keep" },
    team: [{ name: "Ferret", cards: [{ name: "Hog Rider", id: 1 }] }],
    memberList: [{ name: "Marten", trophies: 3 }, null, 7],
  });
});
