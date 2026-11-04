import { memo } from 'react';
import { renderMarkdown } from '../markdown';

function NodePreview({ node, left, top, onClose, onEdit }) {
  const label = (node.data && node.data.label) || 'Topic';
  const content = (node.data && node.data.content) || '';

  return (
    <div className="node-preview" style={{ left, top }}>
      <div className="node-preview-header">
        <span className="node-preview-title">{label}</span>
        <div className="node-preview-actions">
          {onEdit && (
            <button className="btn btn-sm node-preview-edit" onClick={onEdit}>
              ✏️ Edit
            </button>
          )}
          <button className="btn btn-ghost node-preview-close" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
      </div>
      <div className="node-preview-body">
        {content ? renderMarkdown(content) : <div className="muted">No notes for this topic.</div>}
      </div>
    </div>
  );
}

export default memo(NodePreview);
