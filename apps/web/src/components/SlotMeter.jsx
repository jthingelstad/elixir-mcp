/**
 * One slot meter, read by Overview and Settings & tier. Same numbers,
 * same names, same ink on both pages — the design's rule is that shared
 * numbers are derived once, and the two pages used to name the same
 * limit "Clan slots" and "clan watches" a click apart.
 *
 * Gold INK at the limit, never a gold bar: gold marks ownership and
 * brand, and a gold fill would make it a measurement. A limit of 0 is
 * "your tier does not include any", which is not the same statement as
 * "you have used them all", so it says so rather than painting gold.
 */
function SlotMeter({ label, slot }) {
  if (!slot) return null;
  const { used, limit } = slot;
  const none = limit === 0;
  const full = !none && limit != null && used >= limit;
  return (
    <div style={{ flex: "1 1 200px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "8px",
          marginBottom: "8px",
          fontSize: "13.5px",
        }}
      >
        <span style={{ color: "var(--ink-body)" }}>{label}</span>
        {none ? (
          <span style={{ marginLeft: "auto", color: "var(--ink-faint)" }}>
            none on this tier
          </span>
        ) : (
          <span
            className={"meter__value" + (full ? " meter__value--full" : "")}
            style={{ marginLeft: "auto" }}
          >
            {used}/{limit ?? "∞"}
          </span>
        )}
      </div>
      <div className="meter">
        <div
          className="meter__fill"
          style={{
            width:
              limit && limit > 0
                ? `${Math.min(100, (used / limit) * 100)}%`
                : used > 0
                  ? "6%"
                  : "0%",
          }}
        />
      </div>
    </div>
  );
}

/** The four slots every tier has, in the order both pages show them. */
export function SlotMeters({ entitlements: e }) {
  if (!e) return null;
  return (
    <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
      <SlotMeter label="Player slots" slot={e.player_slots} />
      {/* Two clan limits, not one: an activity slot cannot hold a
          comprehensive clan, so a single combined meter would read as
          room you do not have. */}
      <SlotMeter label="Clan slots · activity" slot={e.activity_clans} />
      <SlotMeter
        label="Clan slots · comprehensive"
        slot={e.comprehensive_clans}
      />
      <SlotMeter label="Collections" slot={e.collections} />
    </div>
  );
}
