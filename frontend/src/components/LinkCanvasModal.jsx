import { useEffect, useState } from 'react';
import { api } from '../api';

export default function LinkCanvasModal({ currentCanvasId, parentId, onClose, onLinked }) {
  const [canvases, setCanvases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listCanvases()
      .then((cs) => setCanvases(cs.filter((c) => c.id !== currentCanvasId)))
      .catch((e) => alert(e.message))
      .finally(() => setLoading(false));
  }, [currentCanvasId]);

  const link = async (targetId) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.linkCanvas(currentCanvasId, {
        target_canvas_id: targetId,
        parent_id: parentId || null,
        x: 0,
        y: 0,
      });
      await onLinked();
      onClose();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Link an existing canvas</h3>
          <button className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="muted">
            Choose a canvas to add as a topic node{parentId ? ' under the selected node' : ''}.
            Select it and use "Open" in the side panel to jump to that canvas.
          </p>
          {loading && <div className="muted">Loading…</div>}
          {!loading && canvases.length === 0 && <div className="muted">No other canvases yet.</div>}
          {canvases.map((c) => (
            <div key={c.id} className="canvas-pick" onClick={() => link(c.id)}>
              <span className="canvas-pick-name">📁 {c.name}</span>
              <span className="muted">{c.node_count} topics</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
