import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { splitTags, Tag, TagText } from "../src/Tag.tsx";

test("a tag in a sentence is marked, the words around it are not", () => {
  expect(splitTags("We couldn't find #9YOLV2QCL in Clash Royale.")).toEqual([
    { text: "We couldn't find ", tag: false },
    { text: "#9YOLV2QCL", tag: true },
    { text: " in Clash Royale.", tag: false },
  ]);
  expect(splitTags("#20JJJ2CCRU and #J2RGCRVG")).toEqual([
    { text: "#20JJJ2CCRU", tag: true },
    { text: " and ", tag: false },
    { text: "#J2RGCRVG", tag: true },
  ]);
});

test("numbers, short runs and lowercase words are not tags", () => {
  for (const s of ["PR #345", "Season #136", "#AB", "#hashtag", "no tag"])
    expect(splitTags(s).some((p) => p.tag)).toBe(false);
});

test("a tag draws in the tag face, and a sentence keeps its words", () => {
  expect(renderToStaticMarkup(<Tag tag="#9YOLV2QCL" />)).toBe(
    '<span class="cr-tag" translate="no">#9YOLV2QCL</span>',
  );
  expect(renderToStaticMarkup(<Tag tag={null} />)).toBe("");
  expect(
    renderToStaticMarkup(<TagText>{"Tag not found: #9YOLV2QCL"}</TagText>),
  ).toBe(
    '<span>Tag not found: </span><span class="cr-tag" translate="no">#9YOLV2QCL</span>',
  );
  expect(renderToStaticMarkup(<TagText>{"Nothing here"}</TagText>)).toBe(
    "Nothing here",
  );
});
