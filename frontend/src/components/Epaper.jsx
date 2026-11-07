import { useEffect, useRef, useState } from 'react';
import { api, downloadEpaperFile } from '../api';

export default function Epaper({ onBack, onOpenCanvas }) {
  const [date, setDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginMsg, setLoginMsg] = useState('');
  const [lastDownload, setLastDownload] = useState(null);
  const [pickedFile, setPickedFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [prompt, setPrompt] = useState(
    'Summarize the key points of this e-paper relevant to the UPSC syllabus, and list important facts, data, and potential exam questions.'
  );
  const [model, setModel] = useState('deepseek-v4-pro');
  const [effort, setEffort] = useState('high');
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analyzeError, setAnalyzeError] = useState('');
  const fileInputRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [cookieText, setCookieText] = useState('');
  const [cookieBusy, setCookieBusy] = useState(false);
  const [cookieMsg, setCookieMsg] = useState('');
  const [savedCookieNames, setSavedCookieNames] = useState([]);
  const [downloadingFile, setDownloadingFile] = useState(null);

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
      const r = await api.downloadEpaper(payload);
      setResult(r);
      if (r && r.downloaded && r.downloaded.length > 0) {
        setLastDownload(r.downloaded[r.downloaded.length - 1]);
      }
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

  useEffect(() => {
    let active = true;
    api
      .epaperGetCookies()
      .then((r) => {
        if (active && r && r.names) setSavedCookieNames(r.names);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const saveCookies = async () => {
    if (!cookieText.trim()) {
      setCookieMsg('Paste your cookies first.');
      return;
    }
    setCookieBusy(true);
    setCookieMsg('');
    try {
      const r = await api.epaperSaveCookies(cookieText);
      setSavedCookieNames(r.names || []);
      setCookieMsg(`Saved ${r.count} cookie(s).`);
      setCookieText('');
    } catch (e) {
      setCookieMsg(e.message);
    } finally {
      setCookieBusy(false);
    }
  };

  const clearCookies = async () => {
    setCookieBusy(true);
    setCookieMsg('');
    try {
      await api.epaperClearCookies();
      setSavedCookieNames([]);
      setCookieMsg('Session cleared.');
    } catch (e) {
      setCookieMsg(e.message);
    } finally {
      setCookieBusy(false);
    }
  };

  const downloadFile = async (d) => {
    setDownloadingFile(d.date || d.filename);
    setError('');
    try {
      await downloadEpaperFile(d.filePath, d.filename);
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloadingFile(null);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) setPickedFile({ name: f.name, file: f });
  };

  const onPick = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) setPickedFile({ name: f.name, file: f });
    e.target.value = '';
  };

  const analyze = async () => {
    if (!prompt.trim()) {
      setAnalyzeError('Please enter a prompt.');
      return;
    }
    if (!pickedFile && !lastDownload) {
      setAnalyzeError('Drop a PDF, pick one, or download one first.');
      return;
    }
    setAnalyzeBusy(true);
    setAnalyzeError('');
    setAnalysis(null);
    try {
      const fd = new FormData();
      if (pickedFile) fd.append('file', pickedFile.file);
      else fd.append('filePath', lastDownload.filePath);
      fd.append('prompt', prompt.trim());
      fd.append('model', model);
      fd.append('effort', effort);
      setAnalysis(await api.analyzeEpaper(fd));
    } catch (e) {
      setAnalyzeError(e.message);
    } finally {
      setAnalyzeBusy(false);
    }
  };

  const exportToCanvas = async () => {
    if (!analysis || !analysis.analysis) return;
    setExporting(true);
    setExportMsg('');
    try {
      const name = `E-Paper Analysis${date ? ' - ' + date : ''}`;
      const r = await api.importTextToCanvas(analysis.analysis, name);
      setExportMsg(`Exported ${r.created_count} topics to a new canvas.`);
      onOpenCanvas(r.canvas_id, name);
    } catch (e) {
      setAnalyzeError(e.message);
    } finally {
      setExporting(false);
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

        <div className="epaper-cookie-section">
          <div className="epaper-cookie-title">🍪 Session cookie (for cloud / mobile)</div>
          <p className="muted">
            On a server without a desktop browser, paste your The Hindu session cookies instead of
            logging in. In your desktop browser, log in at <code>epaper.thehindu.com</code>, open
            DevTools → Network, copy the request's <code>Cookie</code> header, then paste it below.
          </p>
          <textarea
            rows={3}
            value={cookieText}
            onChange={(e) => setCookieText(e.target.value)}
            placeholder={'Cookie: name=value; name2=value2  (or a JSON cookie array)'}
          />
          <div className="epaper-cookie-actions">
            <button className="btn" onClick={saveCookies} disabled={cookieBusy}>
              {cookieBusy ? 'Saving…' : '💾 Save session'}
            </button>
            {savedCookieNames.length > 0 && (
              <button className="btn" onClick={clearCookies} disabled={cookieBusy}>
                Clear ({savedCookieNames.length})
              </button>
            )}
          </div>
          {cookieMsg && <div className="epaper-login-msg">{cookieMsg}</div>}
        </div>

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
              <button
                className="epaper-download-link"
                onClick={() => downloadFile(d)}
                disabled={downloadingFile === d.date}
                title="Download to device"
              >
                {downloadingFile === d.date ? '…' : '⬇'}
              </button>
            </div>
          ))}
          {result.skipped.map((s) => (
            <div key={s.date} className="epaper-result-skip">
              ⚠ {s.date}: {s.reason}
            </div>
          ))}
        </div>
      )}

      <div className="epaper-section">
        <h2>🔍 Step 2 — Analyze with AI</h2>
        <p className="muted">
          Drag &amp; drop a PDF (or use the last downloaded one), set your prompt and model, then analyze.
        </p>

        <div
          className={`epaper-drop${dragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
        >
          {pickedFile ? (
            <span>📄 {pickedFile.name}</span>
          ) : lastDownload ? (
            <span>
              📄 Using last download: <strong>{lastDownload.filename}</strong> (click to change)
              <button
                className="epaper-download-link"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadFile(lastDownload);
                }}
                title="Download to device"
              >
                ⬇
              </button>
            </span>
          ) : (
            <span>Drop a PDF here, or click to browse</span>
          )}
          <input ref={fileInputRef} type="file" accept="application/pdf" hidden onChange={onPick} />
        </div>

        <label>Prompt</label>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />

        <div className="epaper-analyze-controls">
          <div className="epaper-control">
            <label>Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
              <option value="deepseek-flash">DeepSeek V4.1 Flash</option>
            </select>
          </div>
          <div className="epaper-control">
            <label>Thinking level</label>
            <select value={effort} onChange={(e) => setEffort(e.target.value)}>
              <option value="low">Low (fast)</option>
              <option value="high">High (balanced)</option>
              <option value="max">Max (deepest)</option>
            </select>
          </div>
        </div>

        <button className="btn btn-primary" onClick={analyze} disabled={analyzeBusy}>
          {analyzeBusy ? 'Analyzing…' : '🤖 Analyze'}
        </button>

        {analyzeError && <div className="epaper-error">⚠ {analyzeError}</div>}
        {analysis && (
          <div className="epaper-analysis">
            <div className="epaper-analysis-meta">
              Extracted {analysis.extractedLength} characters
              {analysis.chunked ? ` · analyzed in ${analysis.chunks} sections` : ''}
              {analysis.truncated ? ' (truncated for context)' : ''}
            </div>
            <div className="epaper-analysis-body">{analysis.analysis}</div>
            <button className="btn" onClick={exportToCanvas} disabled={exporting}>
              {exporting ? 'Exporting…' : '📤 Export to canvas'}
            </button>
            {exportMsg && <div className="epaper-login-msg">{exportMsg}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
