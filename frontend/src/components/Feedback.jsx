import { useEffect, useState } from 'react';
import { api } from '../api';
import { getAiModel } from '../aiModel';
import MicButton from './MicButton';

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function Feedback({ onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [fromDate, setFromDate] = useState(() => toYmd(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [toDate, setToDate] = useState(() => toYmd(new Date()));
  const [useAI, setUseAI] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const [resultOpen, setResultOpen] = useState(false);
  const [resultText, setResultText] = useState('');
  const [resultCount, setResultCount] = useState(0);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const rows = await api.listFeedback();
      setItems(rows);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      await api.createFeedback(text.trim());
      setText('');
      setComposing(false);
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (f) => {
    setEditingId(f.id);
    setEditText(f.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const saveEdit = async () => {
    if (!editText.trim() || saving || !editingId) return;
    setSaving(true);
    try {
      await api.updateFeedback(editingId, editText.trim());
      setEditingId(null);
      setEditText('');
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (f) => {
    if (!window.confirm('Delete this feedback?')) return;
    try {
      await api.deleteFeedback(f.id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  };

  const toggleStatus = async (f) => {
    const next = f.status === 'approved' ? 'unapproved' : 'approved';
    try {
      await api.setFeedbackStatus(f.id, next);
      await load();
    } catch (e) {
      alert(e.message);
    }
  };

  const openExport = () => {
    setFromDate(toYmd(new Date(Date.now() - 24 * 60 * 60 * 1000)));
    setToDate(toYmd(new Date()));
    setUseAI(false);
    setExportError('');
    setExportOpen(true);
  };

  const runExport = async () => {
    if (!fromDate || !toDate) { setExportError('Please choose both dates.'); return; }
    const from = new Date(fromDate + 'T00:00:00');
    const to = new Date(toDate + 'T23:59:59');
    if (from > to) { setExportError('Start date must be before end date.'); return; }
    const filtered = items.filter((f) => {
      const t = new Date(f.created_at);
      return t >= from && t <= to;
    });
    if (!filtered.length) { setExportError('No feedback in this date range.'); return; }

    setExportBusy(true);
    setExportError('');
    try {
      let text;
      if (useAI) {
        const r = await api.rephraseFeedback(filtered, getAiModel());
        text = r.result;
      } else {
        text = filtered.map((f, i) => `${i + 1}. ${f.content}`).join('\n\n');
      }
      setResultText(text);
      setResultCount(filtered.length);
      setExportOpen(false);
      setResultOpen(true);
    } catch (e) {
      setExportError(e.message);
    } finally {
      setExportBusy(false);
    }
  };

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(resultText);
      setCopied(true);
    } catch (e) {
      try {
        const ta = document.getElementById('feedback-result');
        if (ta) {
          ta.focus();
          ta.select();
          document.execCommand('copy');
          setCopied(true);
        }
      } catch (e2) {
        // ignore
      }
    }
    setTimeout(() => setCopied(false), 2000);
  };

  const saveResultAsItem = async () => {
    if (!resultText.trim() || saving) return;
    setSaving(true);
    try {
      await api.createFeedback(resultText.trim());
      setResultOpen(false);
      setResultText('');
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="feedback-page">
      <div className="feedback-aurora" aria-hidden="true" />
      <div className="feedback-shell">
        <header className="feedback-topbar">
          <button className="home-btn home-btn-ghost" onClick={onBack}>← Back</button>
          <h1 className="feedback-title">Feedback</h1>
          <button className="home-btn home-btn-ghost" onClick={openExport} disabled={items.length === 0}>📤 Export</button>
        </header>

        <section className="feedback-compose">
          {composing ? (
            <div className="feedback-composer">
              <div className="voice-field">
                <textarea
                  autoFocus
                  rows={4}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Tell me what to build, fix, or improve…"
                />
                <MicButton onText={(t) => setText((v) => (v ? v + ' ' + t : t))} />
              </div>
              <div className="feedback-actions">
                <button className="home-btn home-btn-primary" onClick={submit} disabled={saving || !text.trim()}>
                  {saving ? 'Saving…' : 'Submit'}
                </button>
                <button className="home-btn home-btn-ghost" onClick={() => { setComposing(false); setText(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="feedback-add"
              onClick={() => setComposing(true)}
              title="Add feedback"
              aria-label="Add feedback"
            >
              <span aria-hidden="true">＋</span>
            </button>
          )}
        </section>

        <section className="feedback-list">
          {loading ? (
            <div className="feedback-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="feedback-empty">
              <div className="feedback-empty-icon">📝</div>
              <p>No feedback yet. Tap the ＋ above to add your first note.</p>
            </div>
          ) : (
            items.map((f) => (
              <article key={f.id} className="feedback-item">
                <div className="feedback-item-head">
                  <button
                    className={`feedback-status${f.status === 'approved' ? ' feedback-status-approved' : ''}`}
                    onClick={() => toggleStatus(f)}
                    title="Toggle approval status"
                  >
                    {f.status === 'approved' ? '✓ Approved' : 'Unapproved'}
                  </button>
                  <div className="feedback-item-actions">
                    <button className="feedback-mini" onClick={() => startEdit(f)} title="Edit" aria-label="Edit">✏️</button>
                    <button className="feedback-mini feedback-mini-danger" onClick={() => remove(f)} title="Delete" aria-label="Delete">🗑</button>
                  </div>
                </div>
                <div className="feedback-item-date">{formatDate(f.created_at)}</div>
                {editingId === f.id ? (
                  <div className="feedback-edit">
                    <div className="voice-field">
                      <textarea
                        rows={3}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        autoFocus
                      />
                      <MicButton onText={(t) => setEditText((v) => (v ? v + ' ' + t : t))} />
                    </div>
                    <div className="feedback-edit-actions">
                      <button className="home-btn home-btn-primary" onClick={saveEdit} disabled={saving || !editText.trim()}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button className="home-btn home-btn-ghost" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="feedback-item-text">{f.content}</div>
                )}
              </article>
            ))
          )}
        </section>
      </div>

      {exportOpen && (
        <div className="home-modal-overlay" onClick={() => setExportOpen(false)}>
          <div className="home-modal" onClick={(e) => e.stopPropagation()}>
            <h3>📤 Export feedback</h3>
            <div className="feedback-export-field">
              <label className="home-label" htmlFor="export-from">Start date</label>
              <input id="export-from" className="home-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="feedback-export-field">
              <label className="home-label" htmlFor="export-to">End date</label>
              <input id="export-to" className="home-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <label className="feedback-export-ai">
              <input type="checkbox" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} />
              <span>✨ Rephrase with AI</span>
            </label>
            <div className="home-modal-actions">
              <button className="home-btn home-btn-ghost" onClick={() => setExportOpen(false)}>Cancel</button>
              <button className="home-btn home-btn-primary" onClick={runExport} disabled={exportBusy}>
                {exportBusy ? 'Exporting…' : 'Export'}
              </button>
            </div>
            {exportError && <div className="home-error">{exportError}</div>}
          </div>
        </div>
      )}

      {resultOpen && (
        <div className="home-modal-overlay" onClick={() => setResultOpen(false)}>
          <div className="home-modal home-modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>📋 {resultCount} feedback {resultCount === 1 ? 'entry' : 'entries'}</h3>
            <textarea id="feedback-result" className="feedback-result" readOnly value={resultText} />
            <div className="home-modal-actions">
              <button className="home-btn home-btn-ghost" onClick={() => setResultOpen(false)}>Close</button>
              <button className="home-btn home-btn-ghost" onClick={saveResultAsItem} disabled={saving}>💾 Save as item</button>
              <button className="home-btn home-btn-primary" onClick={copyResult}>📋 Copy</button>
            </div>
            {copied && <div className="feedback-copied">Copied to clipboard!</div>}
          </div>
        </div>
      )}
    </div>
  );
}
