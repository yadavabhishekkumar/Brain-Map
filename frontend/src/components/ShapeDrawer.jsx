import { useRef, useState } from 'react';
import MicButton from './MicButton';

const SHAPE_TYPES = ['circle', 'rounded', 'diamond', 'rect'];

const PRESET_TEXT_COLORS = ['#1a1a1a', '#ffffff', '#1a73e8', '#b45309', '#b91c1c', '#166534'];
const PRESET_FILL_COLORS = ['#e8f0fe', '#fce8e6', '#e6f4ea', '#fef7e0', '#f3e8fd', '#ffffff', '#1a73e8', '#34a853'];

let shapeCounter = 0;
const nextShapeId = () => `shape-${++shapeCounter}`;

function ShapeGlyph({ type }) {
  const common = { width: 16, height: 16, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': 'true' };
  if (type === 'circle') return <svg {...common}><circle cx="10" cy="10" r="7" /></svg>;
  if (type === 'rounded') return <svg {...common}><rect x="3" y="5" width="14" height="10" rx="4.5" /></svg>;
  if (type === 'diamond') return <svg {...common}><path d="M10 2 L18 10 L10 18 L2 10 Z" /></svg>;
  return <svg {...common}><rect x="3" y="5" width="14" height="10" /></svg>;
}

function SelectGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 3 L19 12 L12.5 13.5 L9.5 20 Z" />
    </svg>
  );
}

function ColorPicker({ value, onChange, presets }) {
  return (
    <span className="sd-colors">
      {presets.map((c) => (
        <button
          key={c}
          type="button"
          className={`sd-swatch${value === c ? ' sd-swatch-active' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => onChange(c)}
        />
      ))}
      <label className="sd-color-input-wrap" title="Custom color">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </span>
  );
}

export default function ShapeDrawer({ onGenerate, onClose }) {
  const [shapes, setShapes] = useState([]);
  const [tool, setTool] = useState(null); // null = select/move
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null); // live drawing preview
  const overlayRef = useRef(null);
  const dragRef = useRef(null);

  const selected = shapes.find((s) => s.id === selectedId) || null;

  const pointerPos = (e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onOverlayPointerDown = (e) => {
    if (e.target !== e.currentTarget) return; // clicked a shape / toolbar / editor
    setSelectedId(null);
    if (!tool) return; // select mode: just deselect
    const { x, y } = pointerPos(e);
    dragRef.current = { mode: 'draw', tool, startX: x, startY: y, curX: x, curY: y };
    setDraft({ x, y, w: 0, h: 0 });
    overlayRef.current.setPointerCapture(e.pointerId);
  };

  const onOverlayPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const { x, y } = pointerPos(e);
    if (d.mode === 'draw') {
      d.curX = x;
      d.curY = y;
      setDraft({ x: Math.min(d.startX, x), y: Math.min(d.startY, y), w: Math.abs(x - d.startX), h: Math.abs(y - d.startY) });
    } else if (d.mode === 'move') {
      setShapes((ss) => ss.map((s) => (s.id === d.id ? { ...s, x: x - d.offsetX, y: y - d.offsetY } : s)));
    }
  };

  const onOverlayPointerUp = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'draw') {
      let w = Math.abs(d.curX - d.startX);
      let h = Math.abs(d.curY - d.startY);
      const x = Math.min(d.startX, d.curX);
      const y = Math.min(d.startY, d.curY);
      if (w < 44) w = 160;
      if (h < 44) h = 90;
      const shape = { id: nextShapeId(), type: d.tool, x, y, w, h, text: '', textColor: '#1a1a1a', fillColor: '#e8f0fe' };
      setShapes((ss) => [...ss, shape]);
      setSelectedId(shape.id);
      setDraft(null);
    }
    dragRef.current = null;
    try { overlayRef.current.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };

  const onShapePointerDown = (e, shape) => {
    e.stopPropagation();
    setSelectedId(shape.id);
    const { x, y } = pointerPos(e);
    dragRef.current = { mode: 'move', id: shape.id, offsetX: x - shape.x, offsetY: y - shape.y };
    overlayRef.current.setPointerCapture(e.pointerId);
  };

  const updateShape = (id, patch) => setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const appendText = (id, t) =>
    setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, text: (s.text ? s.text + ' ' : '') + t } : s)));

  const deleteSelected = () => {
    if (!selectedId) return;
    setShapes((ss) => ss.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  };

  const clearAll = () => {
    setShapes([]);
    setSelectedId(null);
  };

  const generate = () => {
    if (!shapes.length) return;
    onGenerate(shapes);
    setShapes([]);
    setSelectedId(null);
  };

  const shapeStyle = (s) => {
    const style = { left: s.x, top: s.y, width: s.w, height: s.h, background: s.fillColor };
    if (s.type === 'circle') style.borderRadius = '50%';
    else if (s.type === 'rounded') style.borderRadius = Math.min(24, s.h / 3);
    else if (s.type === 'diamond') style.clipPath = 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)';
    else style.borderRadius = 4;
    return style;
  };

  return (
    <div
      className="shape-drawer"
      ref={overlayRef}
      onPointerDown={onOverlayPointerDown}
      onPointerMove={onOverlayPointerMove}
      onPointerUp={onOverlayPointerUp}
      onPointerCancel={onOverlayPointerUp}
    >
      {shapes.map((s) => (
        <div
          key={s.id}
          className={`sd-shape${selectedId === s.id ? ' sd-shape-selected' : ''}`}
          style={shapeStyle(s)}
          onPointerDown={(e) => onShapePointerDown(e, s)}
        >
          <span className="sd-shape-text" style={{ color: s.textColor }}>
            {s.text || <em className="sd-placeholder">Text</em>}
          </span>
        </div>
      ))}

      {draft && (
        <div
          className="sd-shape sd-shape-draft"
          style={shapeStyle({ x: draft.x, y: draft.y, w: draft.w, h: draft.h, type: tool || 'rect', fillColor: '#dbeafe' })}
        />
      )}

      {selected && (
        <div className="sd-editor">
          <div className="sd-editor-row">
            <input
              className="sd-text-input"
              value={selected.text}
              placeholder="Shape text"
              onChange={(e) => updateShape(selected.id, { text: e.target.value })}
            />
            <MicButton onText={(t) => appendText(selected.id, t)} />
            <button className="btn btn-ghost sd-x" onClick={deleteSelected} title="Delete shape">🗑</button>
          </div>
          <div className="sd-editor-row">
            <span className="sd-label">Text</span>
            <ColorPicker value={selected.textColor} onChange={(c) => updateShape(selected.id, { textColor: c })} presets={PRESET_TEXT_COLORS} />
            <span className="sd-label">Fill</span>
            <ColorPicker value={selected.fillColor} onChange={(c) => updateShape(selected.id, { fillColor: c })} presets={PRESET_FILL_COLORS} />
          </div>
        </div>
      )}

      <div className="sd-toolbar">
        <button className={`sd-tool${tool === null ? ' sd-tool-active' : ''}`} title="Select / move" onClick={() => setTool(null)}>
          <SelectGlyph />
        </button>
        {SHAPE_TYPES.map((t) => (
          <button key={t} className={`sd-tool${tool === t ? ' sd-tool-active' : ''}`} title={t} onClick={() => setTool(t)}>
            <ShapeGlyph type={t} />
          </button>
        ))}
        <button className="sd-tool" title="Clear all" onClick={clearAll}>🗑</button>
        <button className="sd-tool sd-tool-generate" title="Generate map from shapes" onClick={generate} disabled={!shapes.length}>
          ✓ Map
        </button>
        <button className="sd-tool" title="Close drawing" onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
