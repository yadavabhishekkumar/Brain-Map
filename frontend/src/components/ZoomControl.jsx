import { useState } from 'react';
import { useReactFlow, useViewport } from 'reactflow';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;

export default function ZoomControl() {
  const { zoomTo, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const [open, setOpen] = useState(false);

  return (
    <div
      className="zoom-control"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className="zoom-icon"
        title="Zoom — hover or tap to fine-tune"
        aria-label="Toggle zoom controls"
        onClick={() => setOpen((o) => !o)}
      >
        🔍
      </button>
      <div className={`zoom-slider-wrap${open ? ' open' : ''}`}>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => zoomTo(Number(e.target.value), { duration: 0 })}
          className="zoom-slider"
          aria-label="Zoom level"
        />
        <span className="zoom-pct">{Math.round(zoom * 100)}%</span>
        <button
          className="zoom-fit"
          title="Fit view"
          onClick={() => fitView({ padding: 0.2 })}
        >
          ⤢
        </button>
      </div>
    </div>
  );
}
