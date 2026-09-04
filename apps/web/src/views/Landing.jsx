import { UPDATES } from "../updates.js";
import { useState } from "react";
import { api } from "../api.js";

export function Landing({ authed, navigate }) {
  const [form, setForm] = useState({ email: "", player_tag: "", note: "" });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  return (
    <>
      <section className="hero">
        <h2>Clash Royale history, recorded.</h2>
        <p>
          The official API only knows the present — a rotating ~30-battle log,
          no trophy timeline, no season history. Elixir MCP records your
          battles, progression, and clan life as they happen, and serves the
          history to <strong>your own AI agent</strong> over MCP. Your agent
          brings the brain; we bring the memory.
        </p>
        <p>
          Ask{" "}
          <em>
            &ldquo;what&rsquo;s my win rate since I swapped to
            Firecracker?&rdquo;
          </em>{" "}
          or
          <em> &ldquo;show my trophy graph this season&rdquo;</em> — questions
          the game itself cannot answer.
        </p>
      </section>

      {authed ? (
        <div className="panel">
          <h3>You&rsquo;re in</h3>
          <p>
            Head to the{" "}
            <a
              href="/dashboard"
              onClick={(e) => {
                e.preventDefault();
                navigate("/dashboard");
              }}
            >
              dashboard
            </a>{" "}
            to claim your tag, start recording, and connect your agent.
          </p>
        </div>
      ) : (
        <div className="panel">
          <h3>Request access</h3>
          <p>
            Access is invite-approved while the recorder grows. Tell us who you
            are in the arena.
          </p>
          {sent ? (
            <p className="notice">
              If your request is approved, you&rsquo;ll hear from us by email.
            </p>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                const res = await api.requestAccess(form);
                if (res.ok) setSent(true);
                else
                  setError(
                    res.data.error === "invalid_tag"
                      ? "That doesn’t look like a CR tag."
                      : "Something went wrong — try again.",
                  );
              }}
            >
              <label>
                Email
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <label>
                Your player tag
                <input
                  placeholder="#20JJJ2CCRU"
                  required
                  value={form.player_tag}
                  onChange={(e) =>
                    setForm({ ...form, player_tag: e.target.value })
                  }
                />
              </label>
              <label>
                Anything we should know? (optional)
                <input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </label>
              {error && <p className="error">{error}</p>}
              <button>Request access</button>
            </form>
          )}
        </div>
      )}

      <div className="panel">
        <h3>How it works</h3>
        <p>
          1. Claim your player tag. 2. Opt into recording — an adaptive recorder
          starts watching your battle log and profile. 3. Connect{" "}
          <code>https://elixir.poapkings.com/mcp</code> to Claude or any MCP
          client, and ask away. Free while in early access.
        </p>
      </div>
      <div className="panel">
        <h3>What&rsquo;s new</h3>
        {UPDATES.slice(0, 4).map((u) => (
          <p key={u.title}>
            <strong>{u.title}</strong>{" "}
            <span className="notice">({u.date})</span>
            <br />
            {u.body}
          </p>
        ))}
      </div>
    </>
  );
}
