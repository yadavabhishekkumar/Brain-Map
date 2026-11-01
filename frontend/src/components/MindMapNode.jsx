import { memo } from 'react';
import { Handle, Position } from 'reactflow';

function MindMapNode({ data, selected }) {
  const { label, depth, isRoot, attachmentCount, linked_canvas_id } = data;
  return (
    <div
      className={`mind-node${isRoot ? ' mind-node-root' : ''}${linked_canvas_id ? ' mind-node-link' : ''}${selected ? ' mind-node-selected' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="mind-handle" />
      <div className="mind-node-body">
        {linked_canvas_id && (
          <span className="mind-node-link-icon" title="Linked canvas">
            📁
          </span>
        )}
        <span className="mind-node-label">{label}</span>
        {attachmentCount > 0 && (
          <span className="mind-node-badge" title={`${attachmentCount} attached note(s)`}>
            📎{attachmentCount}
          </span>
        )}
        {linked_canvas_id && (
          <span className="mind-node-open" title="Linked canvas — open from the side panel">
            ↗
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="mind-handle" />
    </div>
  );
}

export default memo(MindMapNode);
