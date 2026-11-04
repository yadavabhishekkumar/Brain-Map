import { memo } from 'react';
import { Handle, Position } from 'reactflow';

function MindMapNode({ data, selected, id }) {
  const { label, depth, isRoot, attachmentCount, linked_canvas_id, highlighted, editMode, connectMode, onAction, hasHiddenChildren, onExpand } = data;
  const scale = data.scale || 1;
  const labelFont = (isRoot ? 16 : 14) * scale;
  const paddingY = (isRoot ? 14 : 10) * scale;
  const paddingX = (isRoot ? 22 : 16) * scale;
  const badgeFont = 11 * scale;
  const iconFont = 15 * scale;
  const maxWidth = (isRoot ? 340 : 260) * scale;

  return (
    <div
      className={`mind-node${isRoot ? ' mind-node-root' : ''}${linked_canvas_id ? ' mind-node-link' : ''}${selected ? ' mind-node-selected' : ''}${highlighted ? ' mind-node-child-highlight' : ''}`}
      style={{ padding: `${paddingY}px ${paddingX}px` }}
    >
      {!connectMode && <Handle type="target" position={Position.Left} className="mind-handle" />}
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
      {!connectMode && <Handle type="source" position={Position.Right} className="mind-handle" />}

      {connectMode && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="parent-source"
            className="mind-connect-handle"
            style={{ left: '50%', top: '50%', right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }}
          />
          <Handle
            type="target"
            position={Position.Left}
            id="parent-target"
            className="mind-connect-target"
            style={{
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              minWidth: '100%',
              minHeight: '100%',
              transform: 'none',
              border: 'none',
              background: 'transparent',
              opacity: 0,
            }}
          />
        </>
      )}

      {editMode && !connectMode && (
        <>
          <button
            className="node-action node-action-right"
            title="Add child"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onAction(id, 'child');
            }}
          >
            +
          </button>
          <button
            className="node-action node-action-top"
            title="Add sibling above"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onAction(id, 'sibling-top');
            }}
          >
            +
          </button>
          <button
            className="node-action node-action-bottom"
            title="Add sibling below"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onAction(id, 'sibling-bottom');
            }}
          >
            +
          </button>
          {!isRoot && (
            <button
              className="node-action node-action-left node-action-minus"
              title="Detach from parent"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onAction(id, 'detach');
              }}
            >
              −
            </button>
          )}
        </>
      )}

      {!editMode && hasHiddenChildren && (
        <button
          className="node-expand node-expand-right"
          title="Show child nodes"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onExpand(id);
          }}
        >
          +
        </button>
      )}
    </div>
  );
}

export default memo(MindMapNode);

