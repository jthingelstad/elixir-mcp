import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';

export function Admin({ me }) {
  const [requests, setRequests] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [clans, setClans] = useState([]);
  const [clanTag, setClanTag] = useState('');
  const [clanError, setClanError] = useState('');

  const load = useCallback(async () => {
    const [r, g, c] = await Promise.all([api.adminRequests(), api.adminGateways(), api.adminClans()]);
    if (r.ok) setRequests(r.data.requests);
    if (g.ok) setGateways(g.data.gateways);
    if (c.ok) setClans(c.data.clans);
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
        <h3>Recorded clans</h3>
        <p>Each active clan records its roster, war race, and every open member&rsquo;s battles and profile.</p>
        {clans.length > 0 && (
          <table>
            <thead>
              <tr><th>Clan</th><th>Name</th><th>Status</th><th>Members</th><th>Last roster poll</th><th></th></tr>
            </thead>
            <tbody>
              {clans.map((c) => (
                <tr key={`${c.clan_tag}-${c.status}`}>
                  <td><code>{c.clan_tag}</code></td>
                  <td>{c.name ?? '—'}</td>
                  <td><span className={`status ${c.status}`}>{c.status}</span></td>
                  <td>{c.open_members}</td>
                  <td>{c.last_roster_poll ? new Date(c.last_roster_poll).toLocaleTimeString() : 'never'}</td>
                  <td>
                    {c.status === 'active' && (
                      <button className="quiet" onClick={async () => { await api.adminClanAction(c.clan_tag, 'stop'); load(); }}>
                        Stop
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setClanError('');
            const res = await api.adminClanAction(clanTag, 'start');
            if (res.ok) {
              setClanTag('');
              load();
            } else setClanError('That doesn’t look like a CR clan tag.');
          }}
        >
          <label>
            Record a clan
            <input placeholder="#J2RGCRVG" value={clanTag} onChange={(e) => setClanTag(e.target.value)} />
          </label>
          {clanError && <p className="error">{clanError}</p>}
          <button>Start recording</button>
        </form>
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
