import { Icon, Link, Panel, PageHead } from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../api.js";
import {
  keys,
  useGatewayCards,
  useInvalidate,
  useMyGateways,
} from "../lib/queries.js";
import { CardPicker } from "../components/CardPicker.jsx";
import { SETTINGS } from "../lib/settings.js";

/**
 * Settings ▸ Collectors ▸ Run a collector: raising a hand, on a page of
 * its own (Jamie, 2026-09-11: it sat on top of the fleet list, and a
 * form is not a thing to read past on the way to a table).
 *
 * Raising a hand is the ONLY way a collector comes to exist, for
 * anyone, any number of times: a collector is bound to the account
 * that raised it, so an admin never creates one — the admin lane
 * manages what was raised. The operator names the machine (private)
 * and picks the Clash Royale card it wears (public, and one nobody
 * else holds). A raise lands on the new collector's own record, where
 * its token waits to be revealed once: whoever raises a hand is
 * approved (Jamie, 2026-10-12, #540).
 */
export function RaiseCollector({ navigate }) {
  const mine = useMyGateways().data?.gateways ?? null;
  const cards = useGatewayCards().data?.cards ?? [];
  const [name, setName] = useState("");
  const [card, setCard] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const invalidate = useInvalidate();
  const loadCards = () => invalidate(keys.gatewayCards);

  const runsOne = (mine ?? []).length > 0;
  const ready = name.trim() && (cards.length === 0 || card);

  return (
    <>
      <PageHead
        crumb={
          <div className="page__crumb">
            <Link to={`${SETTINGS}/collectors`}>‹ Collectors</Link>
          </div>
        }
        title={runsOne ? "Run another collector" : "Run a collector"}
        sub={
          runsOne
            ? "Every collector you run is yours. One active collector already raises your limits to Family. Name the new machine, pick its card, and raise your hand again."
            : "A collector is a machine that fetches for the record on a schedule. While it is active, it raises your limits to Family."
        }
      />

      <Panel title="The machine" titleAs="div" style={{ marginBottom: "14px" }}>
        <div style={{ padding: "14px 16px" }}>
          <input
            className="input"
            placeholder="a name for the machine"
            aria-label="a name for the machine"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: "100%", maxWidth: "24rem", padding: "9px 12px" }}
          />
          <p className="footnote" style={{ margin: "10px 0 0" }}>
            Private: seen by you and the owner, nobody else. Call it what the
            box is actually called.
          </p>
        </div>
      </Panel>

      {cards.length > 0 && (
        <Panel title="Its card" titleAs="div" style={{ marginBottom: "14px" }}>
          <div style={{ padding: "14px 16px" }}>
            <CardPicker cards={cards} value={card} onChange={setCard} />
            <p className="footnote" style={{ margin: "10px 0 0" }}>
              Public: the card is the collector&rsquo;s name on every list. Its
              status and fetch counts are public, credited to your main player.
              Pick a favourite. One that is dimmed is already another
              collector&rsquo;s.
            </p>
          </div>
        </Panel>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <button
          className="btn btn--primary"
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            const r = await api.raiseGateway(name.trim(), card || null);
            setBusy(false);
            if (r.ok) {
              navigate(
                `${SETTINGS}/collectors/${encodeURIComponent(r.data.card ?? name.trim())}`,
              );
              return;
            }
            setNote(r.data?.message ?? "Could not change that.");
            // The catalog may have moved: a refusal means somebody took
            // the card since it was drawn.
            loadCards();
          }}
        >
          <Icon name="plus" size={16} />
          Raise my hand
        </button>
        <a className="btn" href="/docs/operators">
          Operators guide <Icon name="arrow-right" size={15} />
        </a>
        <span className="footnote">
          {note ||
            "Approved at once. Its token waits on its own page, to reveal once."}
        </span>
      </div>
    </>
  );
}
