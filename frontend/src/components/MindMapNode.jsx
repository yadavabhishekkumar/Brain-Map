import { memo } from 'react';
import { Handle, Position } from 'reactflow';

function MindMapNode({ data, selected }) {
  const { label, depth, isRoot, attachmentCount, linked_canvas_id } = data;
  const scale = data.scale || 1;
  const labelFont = (isRoot ? 16 : 14) * scale;
  const paddingY = (isRoot ? 14 : 10) * scale;
  const paddingX = (isRoot ? 22 : 16) * scale;
  const badgeFont = 11 * scale;
  const iconFont = 15 * scale;
  const maxWidth = (isRoot ? 340 : 260) * scale;

  return (
    <div
      className={`mind-node${isRoot ? ' mind-node-root' : ''}${linked_canvas_id ? ' mind-node-link' : ''}${selected ? ' mind-node-selected' : ''}`}
      style={{ padding: `${paddingY}px ${paddingX}px` }}
    >
      <Handle type="target" position={Position.Left} className="mind-handle" />
      <div className="mind-node-body">
        {linked_canvas_id && (
          <span className="mind-node-link-icon" style={{ fontSize: `${iconFont}px` }} title="Linked canvas">
            📁
          </span>
        )}
        <span className="mind-node-label" style={{ fontSize: `${labelFont}px`, maxWidth: `${maxWidth}px` }}>
          {label}
        </span>
        {attachmentCount > 0 && (
          <span className="mind-node-badge" style={{ fontSize: `${badgeFont}px` }} title={`${attachmentCount} attached note(s)`}>
            📎{attachmentCount}
          </span>
        )}
        {linked_canvas_id && (
          <span className="mind-node-open" style={{ fontSize: `${iconFont}px` }} title="Linked canvas — open from the side panel">
            ↗
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="mind-handle" />
    </div>
  );
}

export default memo(MindMapNode);
