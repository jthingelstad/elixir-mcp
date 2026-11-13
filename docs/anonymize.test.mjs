/**
 * The anonymizer (`infra/scripts/lib/anonymize.mjs`): invented tags and
 * names keep the shape tests rely on, one real value is one invented value,
 * and nothing named is touched. Every tag here is invented and listed in
 * `docs/invented-tags.json`; a test salt stands in for the local one.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  NAMED_NAMES,
  TAG_ALPHABET,
  collectNames,
  inventDescription,
  inventName,
  replaceNames,
  replaceTags,
  tagInventor,
} from "../infra/scripts/lib/anonymize.mjs";

const SALT = "a test salt, never the real one";

test("an invented tag keeps its length, starts #0, uses the alphabet", () => {
  const invent = tagInventor(SALT);
  for (const tag of ["#0PYLQ2", "#0GRJCUV", "#0Q2L8", "#0YY9P"]) {
    const out = invent(tag);
    assert.equal(out.length, tag.length);
    assert.match(out, new RegExp(`^#0[${TAG_ALPHABET}]+$`));
    assert.notEqual(out, tag);
    assert.equal(invent(tag), out, "the same tag, the same invention");
    assert.equal(tagInventor(SALT)(tag), out, "and across runs");
  }
  assert.notEqual(tagInventor("another salt")("#0PYLQ2"), invent("#0PYLQ2"));
});

test("the named tags are never replaced, and nothing seen is invented", () => {
  const invent = tagInventor(SALT);
  assert.equal(invent("#20JJJ2CCRU"), "#20JJJ2CCRU");
  assert.equal(invent("#J2RGCRVG"), "#J2RGCRVG");
  const first = tagInventor(SALT)("#0PYLQ2");
  const avoiding = tagInventor(SALT, new Set([first]))("#0PYLQ2");
  assert.notEqual(avoiding, first);
  // Short tags have few inventions; two never share one.
  const short = tagInventor(SALT);
  const outs = new Set();
  for (const a of "289PYLQGRJCUV")
    for (const b of "PYLQ") outs.add(short(`#${a}${b}Q`));
  assert.equal(outs.size, 13 * 4);
});

test("a tag is replaced in every spelling, and colours and numbers are not", () => {
  const known = new Set(["#0PYLQ2", "#0Q2L8"]);
  const invent = tagInventor(SALT);
  const a = invent("#0PYLQ2").slice(1);
  const b = invent("#0Q2L8").slice(1);
  const { text, count } = replaceTags(
    'p #0PYLQ2 u %230pylq2 id 0PYLQ2_x k "0Q2L8" t #0Q2L8 bare 0Q2L8 colour #28c2c8 issue #868',
    known,
    invent,
  );
  assert.equal(
    text,
    `p #${a} u %23${a.toLowerCase()} id ${a}_x k "${b}" t #${b} bare 0Q2L8 colour #28c2c8 issue #868`,
  );
  assert.equal(count, 5);
});

test("in a test, a tag it declares moves in every form, and only then", () => {
  const known = new Set(["#0Q2L8", "#0CCC", "#0YY9P", "#888"]);
  const invent = tagInventor(SALT);
  const a = invent("#0Q2L8").slice(1);
  const c = invent("#0CCC").slice(1);
  const z = invent("#888").slice(1);
  const src =
    'const T = "#0Q2L8"; go("/home/player/0Q2L8"); "0q2l8,x"; {"tag":"#0CCC"} shown #0CCC; bare 0YY9P; 9,888 shown #888 at /c/888/ and /9,888/';
  const { text } = replaceTags(src, known, invent, { bare: true });
  assert.equal(
    text,
    `const T = "#${a}"; go("/home/player/${a}"); "${a.toLowerCase()},x"; {"tag":"#${c}"} shown #${c}; bare 0YY9P; 9,888 shown #${z} at /c/${z}/ and /9,888/`,
  );
  // Without the option a short bare body stays, as for captured data.
  assert.match(replaceTags(src, known, invent).text, /\/home\/player\/0Q2L8/);
});

test("a keyed tag of eleven or twelve characters is replaced too", () => {
  const known = new Set(["#0PYLQGRJCUV"]);
  const invent = tagInventor(SALT);
  const { text, count } = replaceTags(
    '{"player_tag":"#0PYLQGRJCUV"}',
    known,
    invent,
  );
  assert.equal(count, 1);
  assert.equal(text, `{"player_tag":"${invent("#0PYLQGRJCUV")}"}`);
  assert.equal(invent("#0PYLQGRJCUV").length, 12);
});

test("an invented name keeps the shape of the real one", () => {
  const cases = [
    ["Brisk Otter", /^[A-Z][a-z]+ [A-Z][a-z]+$/],
    ["LOUD", /^[A-Z]+$/],
    ["quiet99", /^[a-z]+[0-9]{2}$/],
    ["  padded ", /^ {2}\S+ $/],
    ["Zoë", /[^ -~]/],
    ["Лиса", /\p{Script=Cyrillic}/u],
    ["星", /\p{Script=Han}/u],
    ["⚡ Bolt", /^\p{Extended_Pictographic}/u],
    [`<img src=x>"&'`, /^<\w+ \w+=\w+>"&'$/],
  ];
  for (const [real, shape] of cases) {
    const out = inventName(SALT, real);
    assert.match(out, shape, `${real} -> ${out}`);
    assert.notEqual(out, real);
    assert.equal(inventName(SALT, real), out);
  }
  for (const named of NAMED_NAMES) assert.equal(inventName(SALT, named), named);
  const d = inventDescription(SALT, "x".repeat(60));
  assert.ok(d.length > 20 && d.length <= 60, d);
});

test("names are collected beside a tag, never from cards or badges", () => {
  const found = collectNames({
    tag: "#0PYLQ2",
    name: "Brisk Otter",
    clan: { tag: "#0GRJCUV", name: "Calm Harbor", description: "hi all" },
    badges: [{ name: "MasteryKnight", level: 1, maxLevel: 8, progress: 3 }],
    cards: [{ id: 26000000, name: "Knight", maxLevel: 16 }],
    owner: { tag: "#20JJJ2CCRU", name: "King Thing" },
    names: ["Old Otter"],
    subject_tag: "#0Q2L8",
    subject_name: "Lucky Lynx",
    battles: [{ arena: "Frozen Peak", tag: "#0YY9P", name: "Brisk Otter" }],
  });
  assert.deepEqual(
    [...found.names].sort(),
    ["Brisk Otter", "Calm Harbor", "Lucky Lynx", "Old Otter"].sort(),
  );
  assert.deepEqual([...found.descriptions], ["hi all"]);
  assert.ok(found.vocabulary.has("masteryknight"));
  assert.ok(found.vocabulary.has("knight"));
  assert.ok(found.vocabulary.has("frozen peak"));
});

test("names are replaced as values everywhere, as words only when safe", () => {
  const map = new Map([
    ["Brisk Otter", "Calm Heron"],
    ["Knight", "Fern"],
    ["bonus", "zebra"],
  ]);
  const stop = new Set(["knight"]);
  const { text } = replaceNames(
    'a "Brisk Otter" b Brisk Otter won; Knight; "bonus" and a bonus',
    map,
    { stop },
  );
  assert.equal(
    text,
    'a "Calm Heron" b Calm Heron won; Knight; "zebra" and a bonus',
  );
});
