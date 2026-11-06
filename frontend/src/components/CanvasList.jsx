import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import MicButton from './MicButton';
import { AI_MODELS, getAiModel, setAiModel } from '../aiModel';

export default function CanvasList({ user, onOpen, onOpenEpaper, onSignIn, onSignOut }) {
  const [canvases, setCanvases] = useState([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiModel, setAiModelState] = useState(getAiModel());
  const [filter, setFilter] = useState('all'); // 'all' | 'private'

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
    if (!user) { onSignIn(); return; }
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

  const fork = async (id) => {
    if (!window.confirm('Fork this public canvas into your account?')) return;
    try {
      await api.forkCanvas(id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  };

  // Visible canvases after the public/private filter.
  const visibleCanvases = useMemo(() => {
    if (filter === 'private') return canvases.filter((c) => !c.is_public);
    return canvases;
  }, [canvases, filter]);

  // Build a parent/child tree from linked canvases so related canvases nest.
  const { childrenMap, roots } = useMemo(() => {
    const byId = new Map(visibleCanvases.map((c) => [c.id, c]));
    const childrenMap = new Map();
    const roots = [];
    for (const c of visibleCanvases) {
      const parentId =
        c.linked_from_canvas_id && byId.has(c.linked_from_canvas_id) ? c.linked_from_canvas_id : null;
      if (parentId) {
        if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
        childrenMap.get(parentId).push(c);
      } else {
        roots.push(c);
      }
    }
    return { childrenMap, roots };
  }, [visibleCanvases]);

  const formatDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const renderRow = (canvas, depth) => {
    const kids = childrenMap.get(canvas.id) || [];
    const related = depth > 0;
    const size =
      `${canvas.node_count} topic${canvas.node_count === 1 ? '' : 's'}` +
      (canvas.attachment_count ? ` · ${canvas.attachment_count} 📎` : '');
    return (
      <div key={canvas.id}>
        <div className={`canvas-row${related ? ' canvas-row-related' : ''}`}>
          <div className="canvas-row-name-cell" style={{ paddingLeft: depth * 28 }}>
            <div className="canvas-row-title">
              {related && <span className="canvas-row-connector">↳</span>}
              <span className="canvas-row-name" onClick={() => onOpen(canvas.id, canvas.name)}>
                {canvas.name}
              </span>
              {related && (
                <span className="canvas-link-badge" title="Linked from another canvas">
                  🔗 linked
                </span>
              )}
              <span className={`canvas-visibility-badge${canvas.is_public ? '' : ' canvas-visibility-private'}`}>
                {canvas.is_public ? '🌍 Public' : '🔒 Private'}
              </span>
            </div>
            <div className="canvas-row-desc">{canvas.description ? canvas.description : 'No description'}</div>
          </div>
          <span className="canvas-row-size">{size}</span>
          <span className="canvas-row-date">{formatDate(canvas.updated_at)}</span>
          <div className="canvas-row-actions">
            <button className="btn btn-sm" onClick={() => onOpen(canvas.id, canvas.name)}>
              Open
            </button>
            {canvas.is_public && user && (
              <button className="btn btn-sm" onClick={() => fork(canvas.id)}>
                🍴 Fork
              </button>
            )}
            {!canvas.is_public && user && canvas.owner_id === user.id && (
              <button className="btn btn-sm btn-danger" onClick={() => remove(canvas.id)}>
                Delete
              </button>
            )}
          </div>
        </div>
        {kids.map((k) => renderRow(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="canvas-list-page">
      <div className="account-bar">
        <div className="visibility-filter">
          {user && (
            <>
              <button className={`btn btn-sm${filter === 'all' ? ' btn-primary' : ''}`} onClick={() => setFilter('all')}>All maps</button>
              <button className={`btn btn-sm${filter === 'private' ? ' btn-primary' : ''}`} onClick={() => setFilter('private')}>🔒 Private</button>
            </>
          )}
        </div>
        <div className="account-bar-actions">
          {user ? (
            <>
              <span className="account-name">👤 {user.name || user.email}</span>
              <button className="btn btn-sm" onClick={onSignOut}>Sign out</button>
            </>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={onSignIn}>Sign in / Sign up</button>
          )}
        </div>
      </div>

      <div className="hero">
        <h1>🧠 UPSC Brain Map</h1>
        <p className="hero-sub">
          Build syllabus-anchored mind maps, attach screenshots of personal notes, extract
          their text with AI, and search everything instantly.
        </p>
        <div className="create-row">
          <div className="voice-field">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              placeholder="Canvas name (e.g. Polity, History, Geography)"
            />
            <MicButton onText={(t) => setName((v) => (v ? v + ' ' + t : t))} />
          </div>
          <button
            className="btn btn-primary btn-lg"
            onClick={create}
            disabled={creating || !name.trim()}
          >
            {creating ? 'Creating…' : '＋ Create a blank Canvas'}
          </button>
        </div>
      </div>

      <div className="ai-model-selector">
        <label htmlFor="ai-model">🤖 Default AI model</label>
        <select
          id="ai-model"
          value={aiModel}
          onChange={(e) => {
            setAiModel(e.target.value);
            setAiModelState(e.target.value);
          }}
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="ai-model-hint">{AI_MODELS.find((m) => m.id === aiModel)?.hint || ''}</div>

      <div className="epaper-banner">
        <div>
          <div className="epaper-banner-title">📰 The Hindu E-Paper</div>
          <div className="epaper-banner-sub">Systematically download daily e-paper PDFs by date.</div>
        </div>
        <button className="btn" onClick={onOpenEpaper}>
          Open Downloader
        </button>
      </div>

      {loading ? (
        <div className="muted">Loading canvases…</div>
      ) : canvases.length === 0 ? (
        <div className="empty">No canvases yet. Create your first blank canvas above.</div>
      ) : (
        <div className="canvas-list">
          <div className="canvas-list-header">
            <span>Canvas</span>
            <span>Size</span>
            <span>Modified</span>
            <span></span>
          </div>
          {roots.map((c) => renderRow(c, 0))}
        </div>
      )}
    </div>
  );
}
