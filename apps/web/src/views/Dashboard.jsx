import { useState } from 'react';
import { api } from '../api.js';

function freshness(ts) {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - Date.parse(ts)) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export function Dashboard({ me, refresh, navigate }) {
  const [tag, setTag] = useState('');
  const [error, setError] = useState('');
  const [tzSaved, setTzSaved] = useState(false);

  if (me === null) return <p className="notice">Loading…</p>;
  if (!me.authenticated) {
    return (
      <div className="panel">
        <h3>Sign in first</h3>
        <p>
          <a href="/signin" onClick={(e) => { e.preventDefault(); navigate('/signin'); }}>Sign in</a> to see your dashboard.
        </p>
      </div>
    );
  }

  const recordingFor = (t) => me.recordings.find((r) => r.subject_tag === t);
  const timezones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];

  return (
    <>
      <div className="panel">
        <h3>Your players</h3>
        {me.claims.length === 0 && <p>No tags claimed yet — add yours below.</p>}
        {me.claims.length > 0 && (
          <table>
            <thead>
              <tr><th>Tag</th><th>Name</th><th>Clan</th><th>Recording</th><th>Last poll</th><th></th></tr>
            </thead>
            <tbody>
              {me.claims.map((c) => {
                const rec = recordingFor(c.player_tag);
                return (
                  <tr key={c.player_tag}>
                    <td><code>{c.player_tag}</code>{c.is_primary ? ' ★' : ''}</td>
                    <td>{c.name ?? '—'}</td>
                    <td>{c.last_known_clan_tag ? <code>{c.last_known_clan_tag}</code> : '—'}</td>
                    <td><span className={`status ${rec?.status ?? 'not_recording'}`}>{rec?.status ?? 'off'}</span></td>
                    <td>{freshness(rec?.freshest_poll)}</td>
                    <td>
                      <button
                        className="quiet"
                        onClick={async () => {
                          await api.setRecording(c.player_tag, rec?.status === 'active' ? 'stop' : 'start');
                          refresh();
                        }}
                      >
                        {rec?.status === 'active' ? 'Stop' : 'Record'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            const res = await api.addClaim(tag);
            if (res.ok) {
              setTag('');
              refresh();
            } else setError('That doesn’t look like a CR tag.');
          }}
        >
          <label>
            Claim a player tag
            <input placeholder="#20JJJ2CCRU" value={tag} onChange={(e) => setTag(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button>Claim</button>
        </form>
      </div>

      <div className="panel">
        <h3>Connect your agent</h3>
        <p>
          Add this MCP server to Claude (or any MCP client) and sign in with your email when it
          asks: <code>https://elixir.poapkings.com/mcp</code>
        </p>
        <p>
          Start with <code>list_my_players</code>, then try <em>&ldquo;what&rsquo;s my record this week?&rdquo;</em>
        </p>
      </div>

      <div className="panel">
        <h3>Timezone</h3>
        <p>Battle times and daily windows resolve in your local time.</p>
        <select
          value={me.timezone ?? 'UTC'}
          onChange={async (e) => {
            await api.setTimezone(e.target.value);
            setTzSaved(true);
            refresh();
          }}
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
        {tzSaved && <p className="notice">Saved.</p>}
      </div>
    </>
  );
}
