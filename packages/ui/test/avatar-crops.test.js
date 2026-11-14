import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  avatarCrop,
  DEFAULT_AVATAR_CROP,
  DROP_AVATAR_CROPS,
  ELIXIR_AVATAR_CROPS,
} from "../src/avatar-crops.ts";

/** The profile image's crop tables (2026-11-14): Drop's, moved unchanged,
 *  Elixir's own rows, which win, and every catalog card resolving to a
 *  crop. Plain JavaScript because the
 *  kit's typecheck has no Node types. */
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const catalog = JSON.parse(
  readFileSync(path.join(repo, "fixtures/cards/catalog.json"), "utf8"),
);

/** The table as one canonical string: ids in order, each crop's keys in
 *  order, no spaces. Its sha256 was taken from Drop's file on 2026-11-14. */
function canonical(table) {
  return `{${Object.keys(table)
    .sort()
    .map((id) => {
      const crop = table[id];
      return `${JSON.stringify(id)}:{${Object.keys(crop)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${JSON.stringify(crop[k])}`)
        .join(",")}}`;
    })
    .join(",")}}`;
}

describe("the crop table", () => {
  test("carries Drop's 121 values exactly", () => {
    expect(Object.keys(DROP_AVATAR_CROPS)).toHaveLength(121);
    expect(DEFAULT_AVATAR_CROP).toEqual({ x: 50, y: 48, scale: 1.21 });
    expect(
      createHash("sha256").update(canonical(DROP_AVATAR_CROPS)).digest("hex"),
    ).toBe("89ae5a7f5609c59c9cbea7a0ff2dc941a439e577fb6101999184b06c2287ebfd");
  });

  test("every catalog card resolves to a whole crop; one takes the default", () => {
    const ids = new Set(catalog.items.map(({ id }) => id));
    const missing = [];
    for (const id of ids) {
      const c = avatarCrop(id);
      for (const v of [c.x, c.y, c.scale])
        expect(Number.isFinite(v)).toBe(true);
      expect(c.scale).toBeGreaterThan(0);
      if (!(id in DROP_AVATAR_CROPS) && !(id in ELIXIR_AVATAR_CROPS))
        missing.push(id);
    }
    // Spirit Empress, which Drop never listed: the default frames it well.
    expect(missing).toEqual([28000025]);
    expect(avatarCrop(28000025)).toEqual(DEFAULT_AVATAR_CROP);
    // Every Elixir row is a catalog card.
    for (const id of Object.keys(ELIXIR_AVATAR_CROPS))
      expect(ids.has(Number(id))).toBe(true);
  });

  test("Elixir's own row wins over Drop's and the default", () => {
    expect(avatarCrop(28000006)).toEqual({ x: 50, y: 46, scale: 1.3 });
    for (const [id, row] of Object.entries(ELIXIR_AVATAR_CROPS))
      expect(avatarCrop(Number(id))).toEqual({
        ...DEFAULT_AVATAR_CROP,
        ...DROP_AVATAR_CROPS[id],
        ...row,
      });
  });

  test("a partial row keeps the default's other fields", () => {
    const c = avatarCrop(26000009);
    expect(c.x).toBe(DEFAULT_AVATAR_CROP.x);
    expect(c.y).toBe(38);
    expect(c.scale).toBe(1.45);
  });
});
