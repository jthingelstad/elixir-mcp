import { test, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { FAMILY_PRODUCTS, Icon } from "../src/index.ts";

afterEach(cleanup);

// The manifest (src/family.json) names each product's icon as a string,
// and family.ts hands it on as an IconName. That is only true if Icon
// can draw it: a name outside the kit's set renders nothing, and the
// button would lose its glyph without a word.
test("every product's icon is one the kit's Icon draws", () => {
  expect(FAMILY_PRODUCTS.length).toBeGreaterThan(0);
  for (const p of FAMILY_PRODUCTS) {
    const { container } = render(<Icon name={p.icon} size={17} />);
    expect(container.querySelector("svg"), `${p.key}: ${p.icon}`).toBeTruthy();
    cleanup();
  }
});
