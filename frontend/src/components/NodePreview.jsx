import { memo } from 'react';
import { renderMarkdown } from '../markdown';

function NodePreview({ node, left, top, onClose, onEdit }) {
  const content = (node.data && node.data.content) || '';

  return (
    <div className="node-preview" style={{ left, top }}>
      <div className="node-preview-header">
        <div className="node-preview-actions">
          {onEdit && (
            <button className="btn btn-sm node-preview-edit" onClick={onEdit} title="Edit" aria-label="Edit">
              ✏️
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
