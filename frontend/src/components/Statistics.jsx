import { useEffect, useState } from 'react';
import { api } from '../api';

// Approximate USD per 1M tokens (input, output). Prices change — treat as estimates.
const PRICING = {
  deepseek: { input: 0.28, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  gemini: { input: 0.3, output: 2.5 },
};

function fmtBytes(bytes) {
  if (bytes == null) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(1) + ' ' + units[i];
}

function fmtNum(n) {
  if (n == null) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function Stat({ label, value }) {
  return (
    <div className="stat-box">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function Statistics({ onBack }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getStats()
      .then((r) => setStats(r))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="stats-page">
      <button className="btn" onClick={onBack}>← Back</button>
      <h1>📊 Statistics</h1>

      {loading && <div className="muted">Loading…</div>}
      {error && <div className="epaper-error">⚠ {error}</div>}

      {stats && (
        <>
          <div className="stats-card">
            <h2>📦 App usage</h2>
            <div className="stats-grid">
              <Stat label="Users" value={stats.app.users} />
              <Stat label="Canvases" value={stats.app.canvases} />
              <Stat label="Topics (nodes)" value={stats.app.nodes} />
              <Stat label="Attachments" value={stats.app.attachments} />
              <Stat label="Cross-links" value={stats.app.edges} />
            </div>
          </div>

          <div className="stats-card">
            <h2>🗄️ Database</h2>
            <div className="stats-grid">
              <Stat label="Database size" value={fmtBytes(stats.database.size_bytes)} />
            </div>
            <p className="stats-gap">
              ⚠️ Neon doesn't expose RAM/memory usage without the Neon API, so only the on-disk
              database size is shown here.
            </p>
            <div className="stats-links">
              <a href="https://console.neon.tech/" target="_blank" rel="noreferrer">Neon console — storage &amp; compute usage ↗</a>
            </div>
          </div>

          <div className="stats-card">
            <h2>🤖 AI token usage <span className="stats-sub">(all users · last 30 days)</span></h2>
            {stats.aiUsage && stats.aiUsage.length > 0 ? (
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>Provider / Model</th>
                    <th>Calls</th>
                    <th>Prompt</th>
                    <th>Completion</th>
                    <th>Total</th>
                    <th>Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.aiUsage.map((u, i) => {
                    const p = PRICING[u.provider] || { input: 0, output: 0 };
                    const cost =
                      (u.prompt_tokens / 1e6) * p.input + (u.completion_tokens / 1e6) * p.output;
                    return (
                      <tr key={i}>
                        <td>{u.provider} / {u.model}</td>
                        <td>{u.calls}</td>
                        <td>{fmtNum(u.prompt_tokens)}</td>
                        <td>{fmtNum(u.completion_tokens)}</td>
                        <td>{fmtNum(u.total_tokens)}</td>
                        <td>${cost.toFixed(4)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="muted">No AI usage recorded yet — usage is tracked from now on.</div>
            )}
            <p className="stats-gap">
              ⚠️ Cost is an estimate using approximate per-token prices. Check the provider
              dashboards for exact billing. Usage before this feature was added isn't recorded.
            </p>
          </div>

          <div className="stats-card">
            <h2>💰 DeepSeek balance</h2>
            {stats.deepseekBalance ? (
              <div className="stats-balance">
                {Array.isArray(stats.deepseekBalance.balance_infos) ? (
                  stats.deepseekBalance.balance_infos.map((b, i) => (
                    <div key={i}>
                      {b.currency} {b.total_balance}
                      {b.topped_up_balance != null ? ` (topped up: ${b.topped_up_balance})` : ''}
                    </div>
                  ))
                ) : (
                  <pre>{JSON.stringify(stats.deepseekBalance, null, 2)}</pre>
                )}
              </div>
            ) : stats.deepseekBalanceError ? (
              <p className="stats-gap">⚠ Couldn't fetch balance: {stats.deepseekBalanceError}</p>
            ) : (
              <p className="stats-gap">⚠ No DeepSeek API key configured.</p>
            )}
            <div className="stats-links">
              <a href="https://platform.deepseek.com/usage" target="_blank" rel="noreferrer">DeepSeek usage dashboard ↗</a>
            </div>
          </div>

          <div className="stats-card">
            <h2>🔮 Gemini usage &amp; limits</h2>
            <p className="stats-gap">
              ⚠️ Gemini doesn't expose usage/limits via a simple API. Its token usage is still
              tracked above (provider "gemini"). For your account's usage and rate limits, open:
            </p>
            <div className="stats-links">
              <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer">Google AI Studio ↗</a>
              <a href="https://console.cloud.google.com/apis/dashboard" target="_blank" rel="noreferrer">Cloud Console — APIs &amp; Services ↗</a>
              <a href="https://console.cloud.google.com/billing" target="_blank" rel="noreferrer">Cloud Billing ↗</a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
