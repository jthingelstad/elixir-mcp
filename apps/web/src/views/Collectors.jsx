import { useEffect, useState } from "react";
import { api } from "../api.js";

/** The collector ladder, promoted from the Dashboard basement to public
 *  Explore — the machines that fetch, their cards, points, and arenas. */
export function Collectors() {
  const [ladder, setLadder] = useState(null);

  useEffect(() => {
    api.gatewayLadder().then((r) => {
      if (r.ok) setLadder(r.data.ladder ?? []);
    });
  }, []);

  return (
    <section>
      <div className="panel">
        <h3>Collector ladder</h3>
        <p>
          Operator-run machines fetch from the Clash Royale API and earn a point
          per call. More collectors mean resilience — never a bigger rate
          budget.
        </p>
        {ladder === null && <p>Loading…</p>}
        {ladder?.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Collector</th>
                <th>Card</th>
                <th>Arena</th>
                <th>Points</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((g) => (
                <tr key={g.name}>
                  <td>{g.rank}</td>
                  <td>{g.name}</td>
                  <td>
                    {g.card_icon ? (
                      <img
                        src={g.card_icon}
                        alt={g.card ?? ""}
                        style={{ height: "1.6em", verticalAlign: "middle" }}
                      />
                    ) : null}{" "}
                    {g.card ?? "—"}
                  </td>
                  <td>{g.arena}</td>
                  <td>{g.points.toLocaleString()}</td>
                  <td>
                    <span className={`status ${g.status}`}>{g.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="fine">
          Want on the board? Raise your hand from Account ▸ Overview.
        </p>
      </div>
    </section>
  );
}
