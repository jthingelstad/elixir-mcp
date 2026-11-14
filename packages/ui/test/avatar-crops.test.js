import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  AVATAR_CROP_OVERRIDES,
  avatarCrop,
  DEFAULT_AVATAR_CROP,
} from "../src/avatar-crops.ts";

/** The profile image's crop table (2026-11-14), moved from Drop unchanged,
 *  and every catalog card resolving to a crop. Plain JavaScript because the
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
    expect(Object.keys(AVATAR_CROP_OVERRIDES)).toHaveLength(121);
    expect(DEFAULT_AVATAR_CROP).toEqual({ x: 50, y: 48, scale: 1.21 });
    expect(
      createHash("sha256")
        .update(canonical(AVATAR_CROP_OVERRIDES))
        .digest("hex"),
    ).toBe("89ae5a7f5609c59c9cbea7a0ff2dc941a439e577fb6101999184b06c2287ebfd");
  });

  test("every catalog card resolves to a whole crop; two take the default", () => {
    const missing = [];
    for (const { id } of catalog.items) {
      const c = avatarCrop(id);
      for (const v of [c.x, c.y, c.scale])
        expect(Number.isFinite(v)).toBe(true);
      expect(c.scale).toBeGreaterThan(0);
      if (!(id in AVATAR_CROP_OVERRIDES)) missing.push(id);
    }
    // Mirror and one card Drop never listed: the default until re-tuned.
    expect(missing.sort()).toEqual([28000006, 28000025]);
    expect(avatarCrop(28000006)).toEqual(DEFAULT_AVATAR_CROP);
  });

  test("a partial row keeps the default's other fields", () => {
    const c = avatarCrop(26000009);
    expect(c.x).toBe(DEFAULT_AVATAR_CROP.x);
    expect(c.y).toBe(38);
    expect(c.scale).toBe(1.45);
  });
});
