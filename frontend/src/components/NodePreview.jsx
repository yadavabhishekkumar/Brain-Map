import { memo, useRef, useState } from 'react';
import { api } from '../api';
import { renderMarkdown } from '../markdown';
import MicButton from './MicButton';

function NodePreview({ node, left, top, onClose, onChanged, onOpenSidePanel, readOnly }) {
  const content = (node.data && node.data.content) || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [size, setSize] = useState({ width: null, height: null });
  const boxRef = useRef(null);

  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current;
    const startW = size.width || (box ? box.offsetWidth : 400);
    const startH = size.height || (box ? box.offsetHeight : 200);
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev) => {
      const w = Math.max(260, Math.min(window.innerWidth - 24, startW + (ev.clientX - startX)));
      const h = Math.max(160, startH + (ev.clientY - startY));
      setSize({ width: w, height: h });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('preview-resizing');
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.classList.add('preview-resizing');
  };

  const startEdit = () => {
    setDraft(content);
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await api.updateNode(node.id, { content: draft });
      setEditing(false);
      if (onChanged) onChanged();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="node-preview-wrap" style={{ left, top, width: size.width || undefined }}>
      <div className="node-preview-actions">
        {!editing && !readOnly && (
          <button className="btn btn-sm node-preview-edit" onClick={startEdit} title="Edit" aria-label="Edit">
            ✏️
          </button>
        )}
        {onOpenSidePanel && (
          <button className="btn btn-sm node-preview-open" onClick={onOpenSidePanel} title="Open side panel" aria-label="Open side panel">
            📑
          </button>
        )}
        <button className="btn btn-ghost node-preview-close" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </div>
      <div className="node-preview" ref={boxRef} style={{ height: size.height || undefined }}>
        <div className="node-preview-body" style={size.height ? { maxHeight: 'none', flex: 1, minHeight: 0 } : undefined}>
          {editing ? (
            <div className="node-preview-editor">
              <div className="voice-field">
                <textarea
                  rows={6}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Write the description…"
                />
                <MicButton onText={(t) => setDraft((v) => (v ? v + ' ' + t : t))} />
              </div>
              <div className="node-preview-editor-actions">
                <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
              </div>
            </div>
          ) : (
            content ? renderMarkdown(content) : <div className="muted">No notes for this topic.</div>
          )}
        </div>
        <button
          className="node-preview-resize"
          onMouseDown={startResize}
          title="Drag to resize"
          aria-label="Drag to resize"
        />
      </div>
    </div>
  );
}

export default memo(NodePreview);
