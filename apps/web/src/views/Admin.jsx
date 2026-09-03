import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';

export function Admin({ me }) {
  const [requests, setRequests] = useState([]);
  const [gateways, setGateways] = useState([]);

  const load = useCallback(async () => {
    const [r, g] = await Promise.all([api.adminRequests(), api.adminGateways()]);
    if (r.ok) setRequests(r.data.requests);
    if (g.ok) setGateways(g.data.gateways);
  }, []);

  useEffect(() => {
    if (me?.is_owner) load();
  }, [me, load]);

  if (!me?.is_owner) return <p className="notice">Owner only.</p>;

  return (
    <>
      <div className="panel">
        <h3>Access requests</h3>
        {requests.length === 0 && <p>Queue is empty.</p>}
        {requests.length > 0 && (
          <table>
            <thead>
              <tr><th>Tag</th><th>Note</th><th>Requested</th><th></th></tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.email_hash}>
                  <td>{r.requested_player_tag ? <code>{r.requested_player_tag}</code> : '—'}</td>
                  <td>{r.request_note ?? ''}</td>
                  <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>
                    <button onClick={async () => { await api.adminDecide(r.email_hash, 'approved'); load(); }}>Approve</button>{' '}
                    <button className="quiet" onClick={async () => { await api.adminDecide(r.email_hash, 'denied'); load(); }}>Deny</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3>Gateways</h3>
        <table>
          <thead>
            <tr><th>Name</th><th>Status</th><th>IP</th><th>Heartbeat</th><th>Fetches (1h)</th></tr>
          </thead>
          <tbody>
            {gateways.map((g) => (
              <tr key={g.gateway_id}>
                <td>{g.name}</td>
                <td><span className={`status ${g.status}`}>{g.status}</span></td>
                <td><code>{g.static_ip}</code></td>
                <td>{g.last_heartbeat_at ? new Date(g.last_heartbeat_at).toLocaleTimeString() : 'never'}</td>
                <td>{g.fetches_last_hour}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
