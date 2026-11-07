import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/Markdown";

const parse = (md: string) => {
  const host = document.createElement("div");
  host.innerHTML = renderMarkdown(md);
  return host;
};

describe("renderMarkdown with hostile text", () => {
  it("makes no element from raw HTML", () => {
    const host = parse(
      '<img src=x onerror=alert(1)> <script>x()</script> "><b>',
    );
    expect(host.querySelector("img, script, b")).toBeNull();
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("keeps a quote in a link inside the href", () => {
    const link = parse(
      '[x](http://a.example"onmouseover="alert(1))',
    ).querySelector("a");
    expect(link?.getAttribute("onmouseover")).toBeNull();
    expect(link?.getAttribute("href")).toBe(
      'http://a.example"onmouseover="alert(1)',
    );
  });

  it("keeps a bare URL's quote inside the href", () => {
    const link = parse('https://a.example/"onfocus="alert(1)').querySelector(
      "a",
    );
    expect(link?.getAttribute("onfocus")).toBeNull();
  });

  it("does not double-escape an ampersand in a link", () => {
    const link = parse("[x](https://a.example/?a=1&b=2)").querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://a.example/?a=1&b=2");
  });

  it("drops a javascript: link to text", () => {
    const host = parse("[x](javascript:alert(1))");
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain("x");
  });

  it("keeps a quote in an image inside its attribute", () => {
    const img = parse(
      '![x](http://a.example/"onerror="alert(1))',
    ).querySelector("img");
    expect(img?.getAttribute("onerror")).toBeNull();
  });
});
