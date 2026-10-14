import assert from "node:assert/strict";
import test from "node:test";
import { gatewayCardIcon, gatewayCardView } from "../src/gateway-cards.mjs";

test("collector art follows catalog presence, never stale stored CDN art", () => {
  const stored = {
    card_name: "Knight",
    card_icon: "https://api-assets.clashroyale.com/old.png",
  };
  assert.deepEqual(
    gatewayCardView({
      ...stored,
      card_id: 26000000,
      icon_medium: "https://upstream/knight.png",
    }),
    {
      card_name: "Knight",
      card_icon: "https://elixir.poapkings.com/assets/cards/26000000.png",
    },
  );
  assert.equal(gatewayCardIcon({ card_id: 26000000, icon_medium: null }), null);
  assert.deepEqual(
    gatewayCardView({ ...stored, card_id: null, icon_medium: null }),
    { ...stored, card_icon: null },
  );
  assert.equal(
    gatewayCardIcon({
      card_id: 159000000,
      icon_medium: "https://upstream/tower.png",
    }),
    null,
  );
});
