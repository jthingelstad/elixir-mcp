import { useEffect, useState } from "react";
import { api } from "../api.js";
import { CardPicker } from "../components/CardPicker.jsx";
import { Icon } from "../components/Icon.jsx";

/**
 * Status ▸ Collectors ▸ Run a collector — raising a hand, on a page of
 * its own (Jamie, 2026-09-11: it sat on top of the fleet list, and a
 * form is not a thing to read past on the way to a table).
 *
 * Raising a hand is the ONLY way a collector comes to exist, for
 * anyone, any number of times: a collector is bound to the account
 * that raised it, so an admin never creates one — the admin lane
 * manages what was raised. The operator names the machine (private)
 * and picks the Clash Royale card it wears (public, and one nobody
 * else holds). A raise lands on the new collector's own record, where
 * its pending state and, later, its token live.
 */
export function RaiseCollector({ navigate }) {
  const [mine, setMine] = useState(null);
  const [cards, setCards] = useState([]);
  const [name, setName] = useState("");
  const [card, setCard] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const loadCards = () =>
    api.gatewayCards().then((r) => r.ok && setCards(r.data.cards ?? []));
  useEffect(() => {
    api.myGateways().then((r) => r.ok && setMine(r.data.gateways ?? []));
    loadCards();
  }, []);

  const runsOne = (mine ?? []).length > 0;
  const ready = name.trim() && (cards.length === 0 || card);

  return (
    <>
      <div className="page__crumb">
        <a onClick={() => navigate("/status/collectors")}>‹ Collectors</a>
      </div>
      <h1 className="page__title">
        {runsOne ? "Run another collector" : "Run a collector"}
      </h1>
      <p className="page__lede" style={{ maxWidth: "64ch" }}>
        {runsOne
          ? "Every collector you run is yours and earns on the same ladder. Name the new machine, pick its card, and raise your hand again."
          : "A collector is a machine that fetches for the corpus on a schedule. It earns you bonus quota — 10 fetches buys one extra daily call, up to 4× your base."}
      </p>

      <section className="panel" style={{ marginBottom: "14px" }}>
        <div className="panel__head">The machine</div>
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
            Private — seen by you and the owner, nobody else. Call it what the
            box is actually called.
          </p>
        </div>
      </section>

      {cards.length > 0 && (
        <section className="panel" style={{ marginBottom: "14px" }}>
          <div className="panel__head">Its card</div>
          <div style={{ padding: "14px 16px" }}>
            <CardPicker cards={cards} value={card} onChange={setCard} />
            <p className="footnote" style={{ margin: "10px 0 0" }}>
              Public — the card is the collector&rsquo;s name on every fleet
              page. Pick a favourite; one that is dimmed is already another
              collector&rsquo;s.
            </p>
          </div>
        </section>
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
                `/status/collectors/${encodeURIComponent(r.data.card ?? name.trim())}`,
              );
              return;
            }
            setNote(r.data?.message ?? "Could not send that.");
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
          {note || "Raising your hand emails the owner. Approval is by hand."}
        </span>
      </div>
    </>
  );
}
