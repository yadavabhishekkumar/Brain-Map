import { useEffect, useState } from 'react';
import { api } from '../api';
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

export default function Feedback({ onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="feedback-page">
      <div className="feedback-aurora" aria-hidden="true" />
      <div className="feedback-shell">
        <header className="feedback-topbar">
          <button className="home-btn home-btn-ghost" onClick={onBack}>← Back</button>
          <h1 className="feedback-title">Feedback</h1>
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
                <div className="feedback-item-text">{f.content}</div>
                <div className="feedback-item-date">{formatDate(f.created_at)}</div>
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
