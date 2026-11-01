import { useState } from 'react';
import { api } from '../api';

export default function Epaper({ onBack }) {
  const [date, setDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginMsg, setLoginMsg] = useState('');

  const download = async () => {
    if (!date) {
      setError('Please choose a start date.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const payload = {};
      if (toDate && toDate !== date) {
        payload.fromDate = date;
        payload.toDate = toDate;
      } else {
        payload.date = date;
      }
      if (folder.trim()) payload.folder = folder.trim();
      setResult(await api.downloadEpaper(payload));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    setLoggingIn(true);
    setError('');
    setLoginMsg('');
    try {
      const r = await api.epaperLogin();
      setLoginMsg(r.message || 'A browser window opened.');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <div className="epaper-page">
      <button className="btn" onClick={onBack}>
        ← Back to Canvases
      </button>

      <div className="epaper-hero">
        <h1>📰 The Hindu E-Paper Downloader</h1>
        <p className="muted">
          Pick a date (or a range) and the daily e-paper PDF will be downloaded to your chosen folder.
        </p>
      </div>

      <div className="epaper-card">
        <label>Start date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <label>End date (optional — for a range)</label>
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />

        <label>Save to folder (optional)</label>
        <input
          type="text"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="Leave empty to use ~/HinduEpaper"
        />

        <button className="btn" onClick={login} disabled={loggingIn}>
          {loggingIn ? 'Opening browser…' : '🔑 Login / refresh session'}
        </button>
        {loginMsg && <div className="epaper-login-msg">{loginMsg}</div>}
        <button className="btn btn-primary" onClick={download} disabled={busy || !date}>
          {busy ? 'Downloading…' : '⬇ Download PDF'}
        </button>
      </div>

      {error && <div className="epaper-error">⚠ {error}</div>}

      {result && (
        <div className="epaper-results">
          <div className="epaper-results-header">
            Saved to <code>{result.folder}</code>
          </div>
          {result.downloaded.length === 0 && result.skipped.length === 0 && (
            <div className="muted">Nothing to report.</div>
          )}
          {result.downloaded.map((d) => (
            <div key={d.date} className="epaper-result-ok">
              ✅ <strong>{d.filename}</strong> — {(d.size / 1024 / 1024).toFixed(2)} MB
            </div>
          ))}
          {result.skipped.map((s) => (
            <div key={s.date} className="epaper-result-skip">
              ⚠ {s.date}: {s.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
