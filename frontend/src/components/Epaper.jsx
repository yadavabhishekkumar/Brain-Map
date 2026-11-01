import { useRef, useState } from 'react';
import { api } from '../api';

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
  const [model, setModel] = useState('deepseek-chat');
  const [temperature, setTemperature] = useState(0.3);
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analyzeError, setAnalyzeError] = useState('');
  const fileInputRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

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
      fd.append('temperature', String(temperature));
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
              <option value="deepseek-chat">DeepSeek Chat (V3)</option>
              <option value="deepseek-reasoner">DeepSeek Reasoner (R1)</option>
            </select>
          </div>
          <div className="epaper-control epaper-control-wide">
            <label>Thinking level (temperature): {temperature}</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              disabled={model === 'deepseek-reasoner'}
            />
            <span className="muted">
              {model === 'deepseek-reasoner' ? 'Temperature is not used by DeepSeek Reasoner' : '0 = precise, 1 = creative'}
            </span>
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
