import { useRef } from 'react';
import { useViewport } from 'reactflow';

export default function HorizontalAligner({ lines, onLineDrag, onConfirm, onCancel }) {
  const { zoom, x: panX } = useViewport();
  const dragRef = useRef(null);

  const toScreen = (flowX) => flowX * zoom + panX;

  const startDrag = (depth, e) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { depth, startClientX: e.clientX, startFlowX: lines[depth] };

    const onMove = (ev) => {
      if (!dragRef.current) return;
      const dx = (ev.clientX - dragRef.current.startClientX) / zoom;
      onLineDrag(dragRef.current.depth, dragRef.current.startFlowX + dx);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      {lines.map((x, depth) => (
        <div
          key={depth}
          className="align-line"
          style={{ left: toScreen(x) }}
          onPointerDown={(e) => startDrag(depth, e)}
        >
          <span className="align-line-label">D{depth}</span>
        </div>
      ))}
      <div className="align-controls">
        <span className="align-controls-title">Depth Aligner — drag a line to move that depth</span>
        <button className="btn btn-sm btn-primary" onClick={onConfirm}>
          ✓ Confirm
        </button>
        <button className="btn btn-sm" onClick={onCancel}>
          ✖ Cancel
        </button>
      </div>
    </>
  );
}

