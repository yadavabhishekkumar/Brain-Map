import { memo, useState } from 'react';
import { api } from '../api';
import { renderMarkdown } from '../markdown';
import MicButton from './MicButton';

function NodePreview({ node, left, top, onClose, onChanged }) {
  const content = (node.data && node.data.content) || '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

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
    <div className="node-preview-wrap" style={{ left, top }}>
      <div className="node-preview-actions">
        {!editing && (
          <button className="btn btn-sm node-preview-edit" onClick={startEdit} title="Edit" aria-label="Edit">
            ✏️
          </button>
        )}
        <button className="btn btn-ghost node-preview-close" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </div>
      <div className="node-preview">
        <div className="node-preview-body">
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
      </div>
    </div>
  );
}

export default memo(NodePreview);
