import { useState } from "react";
import { CLAN } from "../lib/base.js";

const ALL = "__all__";

/**
 * The Clan picker: a plain select beside the clan's name, only with two or
 * more clans (the ruling of 2026-11-05 on the old rail picker). Most players
 * are in one clan and never see it. One clan at a time stays: choosing one
 * remembers it on the server, then goes to its Feed. While a selection is
 * pending the picker is busy, so a second pick never races the first.
 */
export function ClanPicker({ me, navigate, select, selecting }) {
  const here = me.selected;
  const [picking, setPicking] = useState(null);
  if ((me.clans?.length ?? 0) < 2) return null;
  return (
    <label className="clan-head__picker">
      <span className="field-label">Clan</span>
      <select
        className="scope-select"
        disabled={selecting}
        value={selecting && picking ? picking : here.clan_tag}
        onChange={async (e) => {
          const next = e.target.value;
          if (next === ALL) return navigate(`${CLAN}/clans`);
          if (selecting || next === here.clan_tag) return undefined;
          setPicking(next);
          try {
            await select(next);
          } finally {
            setPicking(null);
          }
          return undefined;
        }}
      >
        {me.clans.map((c) => (
          <option key={c.clan_tag} value={c.clan_tag}>
            {c.name ?? c.clan_tag}, {c.role_label}
            {c.verified === false ? ", unverified" : ""}
          </option>
        ))}
        <option value={ALL}>All your clans…</option>
      </select>
    </label>
  );
}
