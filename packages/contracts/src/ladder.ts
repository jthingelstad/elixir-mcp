/**
 * The gateway ladder — arenas a gateway climbs by making API calls
 * (one point per admitted fetch). Thresholds are cumulative points.
 * Flavor only; the budget/scheduler never reads this.
 */

export const GATEWAY_ARENAS: ReadonlyArray<{ points: number; name: string }> = [
  { points: 0, name: "Goblin Gateway" },
  { points: 500, name: "Bone Pit Relay" },
  { points: 2_000, name: "Barbarian Bandwidth" },
  { points: 8_000, name: "Spell Valley Switch" },
  { points: 25_000, name: "Hog Mountain Hub" },
  { points: 75_000, name: "Electro Valley Exchange" },
  { points: 200_000, name: "Spooky Town Spine" },
  { points: 500_000, name: "Legendary Backbone" },
  { points: 1_500_000, name: "Ultimate Champion Uplink" },
];

export function gatewayArena(points: number): {
  name: string;
  next: { name: string; points_needed: number } | null;
} {
  let current = GATEWAY_ARENAS[0]!;
  let next: { points: number; name: string } | null = null;
  for (const tier of GATEWAY_ARENAS) {
    if (points >= tier.points) current = tier;
    else {
      next = tier;
      break;
    }
  }
  return {
    name: current.name,
    next: next
      ? { name: next.name, points_needed: next.points - points }
      : null,
  };
}
