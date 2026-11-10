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
        aria-label="Toggle zoom controls"
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
        <span className="floating-tooltip floating-tooltip-top">Zoom</span>
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
