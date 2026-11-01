import { useEffect, useState } from 'react';
import { api } from '../api';

export default function CanvasList({ onOpen, onOpenEpaper }) {
  const [canvases, setCanvases] = useState([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setCanvases(await api.listCanvases());
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const c = await api.createCanvas(name.trim());
      setName('');
      await load();
      onOpen(c.id, c.name);
    } catch (e) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this canvas and all its content?')) return;
    try {
      await api.deleteCanvas(id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div className="canvas-list-page">
      <div className="hero">
        <h1>🧠 UPSC Brain Map</h1>
        <p className="hero-sub">
          Build syllabus-anchored mind maps, attach screenshots of personal notes, extract
          their text with AI, and search everything instantly.
        </p>
        <div className="create-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Canvas name (e.g. Polity, History, Geography)"
          />
          <button
            className="btn btn-primary btn-lg"
            onClick={create}
            disabled={creating || !name.trim()}
          >
            {creating ? 'Creating…' : '＋ Create a blank Canvas'}
          </button>
        </div>
      </div>

      <div className="epaper-banner">
        <div>
          <div className="epaper-banner-title">📰 The Hindu E-Paper</div>
          <div className="epaper-banner-sub">Systematically download daily e-paper PDFs by date.</div>
        </div>
        <button className="btn" onClick={onOpenEpaper}>
          Open Downloader
        </button>
      </div>

      <div className="canvas-grid">
        {loading && <div className="muted">Loading canvases…</div>}
        {!loading && canvases.length === 0 && (
          <div className="empty">No canvases yet. Create your first blank canvas above.</div>
        )}
        {canvases.map((c) => (
          <div key={c.id} className="canvas-card" onClick={() => onOpen(c.id, c.name)}>
            <div className="canvas-card-title">{c.name}</div>
            <div className="canvas-card-meta">
              {c.node_count} topic{c.node_count === 1 ? '' : 's'} ·{' '}
              {new Date(c.updated_at).toLocaleDateString()}
            </div>
            <div className="canvas-card-actions">
              <button
                className="btn btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(c.id, c.name);
                }}
              >
                Open
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(c.id);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
