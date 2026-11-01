import { useRef } from 'react';
import { useViewport } from 'reactflow';

export default function HorizontalAligner({
  line1,
  line2,
  onLine1Change,
  onLine2Change,
  onConfirm,
  onCancel,
}) {
  const { zoom, x: panX } = useViewport();
  const dragRef = useRef(null);

  const toScreen = (flowX) => flowX * zoom + panX;

  const startDrag = (line, e) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { line, startClientX: e.clientX, startFlowX: line === 1 ? line1 : line2 };

    const onMove = (ev) => {
      if (!dragRef.current) return;
      const dx = (ev.clientX - dragRef.current.startClientX) / zoom;
      const value = dragRef.current.startFlowX + dx;
      if (dragRef.current.line === 1) onLine1Change(value);
      else onLine2Change(value);
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
      <div
        className="align-line align-line-1"
        style={{ left: toScreen(line1) }}
        onPointerDown={(e) => startDrag(1, e)}
      >
        <span className="align-line-label">1</span>
      </div>
      <div
        className="align-line align-line-2"
        style={{ left: toScreen(line2) }}
        onPointerDown={(e) => startDrag(2, e)}
      >
        <span className="align-line-label">2</span>
      </div>
      <div className="align-controls">
        <span className="align-controls-title">Horizontal Aligner</span>
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
