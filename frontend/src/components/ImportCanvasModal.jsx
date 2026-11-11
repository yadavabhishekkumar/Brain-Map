import { useEffect, useState } from 'react';
import { api } from '../api';

export default function ImportCanvasModal({ currentCanvasId, parentId, nodeId, onClose, onImported }) {
  const [canvases, setCanvases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    api
      .listCanvases()
      .then((cs) => setCanvases(cs.filter((c) => c.id !== currentCanvasId)))
      .catch((e) => alert(e.message))
      .finally(() => setLoading(false));
  }, [currentCanvasId]);

  const run = async (action, sourceId) => {
    if (busy) return;
    setBusy(`${sourceId}:${action}`);
    try {
      if (action === 'copy') {
        await api.importCanvas(currentCanvasId, {
          source_canvas_id: sourceId,
          parent_id: parentId || null,
        });
      } else {
        await api.updateNode(nodeId, { linked_canvas_id: sourceId });
      }
      await onImported();
      onClose();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Import an existing canvas</h3>
          <button className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="muted">
            {nodeId ? (
              <>
                For each canvas choose <strong>Create a copy</strong> to bring its whole map into
                this canvas under the selected topic, or <strong>Link</strong> to make this topic
                open that canvas.
              </>
            ) : (
              <>
                Choose <strong>Create a copy</strong> to bring a canvas's whole map into this canvas
                as new root topics. To add a linked topic instead, use <strong>Link canvas</strong>{' '}
                in the tools menu.
              </>
            )}{' '}
            The original canvas is left untouched.
          </p>
          {loading && <div className="muted">Loading…</div>}
          {!loading && canvases.length === 0 && <div className="muted">No other canvases yet.</div>}
          {canvases.map((c) => (
            <div key={c.id} className="canvas-pick canvas-pick-multi">
              <div className="canvas-pick-info">
                <span className="canvas-pick-name">📁 {c.name}</span>
                <span className="muted">{c.node_count} topics</span>
              </div>
              <div className="canvas-pick-actions">
                <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => run('copy', c.id)}>
                  {busy === `${c.id}:copy` ? 'Copying…' : '📄 Create a copy'}
                </button>
                {nodeId && (
                  <button className="btn btn-sm" disabled={!!busy} onClick={() => run('link', c.id)}>
                    {busy === `${c.id}:link` ? 'Linking…' : '🔗 Link'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
