import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  ReactFlowProvider, Background, BackgroundVariant, MiniMap,
  useReactFlow, useViewport, useNodesState, useEdgesState, applyNodeChanges, applyEdgeChanges, MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from '../api';
import { saveCanvasContent, loadCanvasContent } from '../localdb';
import MindMapNode from './MindMapNode';
import NodeEditor from './NodeEditor';
import SearchBar from './SearchBar';
import LinkCanvasModal from './LinkCanvasModal';
import ImportCanvasModal from './ImportCanvasModal';
import AIBuildPanel from './AIBuildPanel';
import NodePreview from './NodePreview';
import FocusSearch from './FocusSearch';
import ZoomControl from './ZoomControl';
import HorizontalAligner from './HorizontalAligner';
import ShapeDrawer from './ShapeDrawer';

const nodeTypes = { mindmap: MindMapNode };

// Map zoom level -> deepest visible depth (progressive disclosure)
function depthThreshold(zoom) {
  if (zoom < 0.3) return 0;
  if (zoom < 0.5) return 1;
  if (zoom < 0.75) return 2;
  if (zoom < 1.05) return 3;
  if (zoom < 1.4) return 4;
  if (zoom < 1.75) return 5;
  return 100;
}

function nodeOpacity(depth, threshold) {
  if (depth <= threshold) return 1;
  return Math.max(0, 1 - (depth - threshold) * 1.25);
}

// Grow remaining nodes as the user zooms out, so their text stays readable.
function nodeScale(zoom) {
  if (zoom >= 1) return 1;
  return Math.min(2.5, 1 / zoom);
}

function toNode(n) {
  return {
    id: n.id,
    type: 'mindmap',
    position: { x: Number(n.x) || 0, y: Number(n.y) || 0 },
    data: {
      label: n.label,
      content: n.content,
      depth: n.depth,
      isRoot: !n.parent_id,
      parent_id: n.parent_id,
      attachmentCount: Number(n.attachment_count) || 0,
      linked_canvas_id: n.linked_canvas_id || null,
      linked_canvas_name: n.linked_canvas_name || '',
    },
  };
}

function estimateNodeWidth(node) {
  const d = node.data || {};
  const isRoot = !!d.isRoot;
  const baseFont = isRoot ? 16 : 14;
  const label = d.label || '';
  const maxLabelWidth = isRoot ? 340 : 260;
  const labelWidth = Math.min(label.length * baseFont * 0.65, maxLabelWidth);
  const padding = (isRoot ? 22 : 16) * 2;
  let extra = 4; // border
  if (d.attachmentCount > 0) extra += 44; // badge
  if (d.linked_canvas_id) extra += 30; // link icon
  return Math.max(60, labelWidth + padding + extra);
}

// Build the hierarchical "Tree" sheet as an array-of-arrays plus merge ranges.
// Each leaf (bottom-most node) owns one column; internal nodes span the columns
// of all their descendant leaves. Every node occupies two rows: its label on
// top and its description (notes) directly below it.
function buildTreeSheet(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenMap = new Map();
  const roots = [];

  for (const n of nodes) {
    const pid = n.data && n.data.parent_id;
    if (pid && byId.has(pid)) {
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid).push(n);
    } else {
      roots.push(n);
    }
  }

  const byPos = (a, b) =>
    ((a.position && a.position.y) || 0) - ((b.position && b.position.y) || 0) ||
    ((a.position && a.position.x) || 0) - ((b.position && b.position.x) || 0);
  roots.sort(byPos);
  childrenMap.forEach((kids) => kids.sort(byPos));

  const colStart = new Map();
  const span = new Map();
  const depthMap = new Map();
  const visited = new Set();
  let col = 0;

  const walk = (n, depth) => {
    if (visited.has(n.id)) return;
    visited.add(n.id);
    const kids = childrenMap.get(n.id) || [];
    colStart.set(n.id, col);
    depthMap.set(n.id, depth);
    if (kids.length === 0) {
      span.set(n.id, 1);
      col += 1;
      return;
    }
    let total = 0;
    for (const k of kids) {
      walk(k, depth + 1);
      total += span.get(k.id) || 1;
    }
    span.set(n.id, total);
  };
  roots.forEach((r) => walk(r, 0));

  // Defensive: any orphaned node (not reached from a root) gets its own column.
  for (const n of nodes) {
    if (!span.has(n.id)) {
      colStart.set(n.id, col);
      span.set(n.id, 1);
      depthMap.set(n.id, 0);
      col += 1;
    }
  }

  const totalCols = Math.max(1, col);
  const maxDepth = Math.max(0, ...depthMap.values());

  const rows = [];
  const merges = [];
  for (let d = 0; d <= maxDepth; d++) {
    const labelRow = rows.length;
    rows.push(new Array(totalCols).fill(null));
    const descRow = rows.length;
    rows.push(new Array(totalCols).fill(null));

    const levelNodes = nodes
      .filter((n) => (depthMap.get(n.id) ?? 0) === d)
      .sort(byPos);

    for (const n of levelNodes) {
      const c0 = colStart.get(n.id) ?? 0;
      const w = span.get(n.id) ?? 1;
      const c1 = c0 + w - 1;
      const label = (n.data && n.data.label) || '';
      const desc = (n.data && n.data.content) || '';
      rows[labelRow][c0] = {
        v: label,
        depth: d,
        span: w,
        linked: (n.data && n.data.linked_canvas_id) || null,
      };
      rows[descRow][c0] = { v: desc, depth: d, span: w };
      if (w > 1) {
        merges.push({ s: { r: labelRow, c: c0 }, e: { r: labelRow, c: c1 } });
        merges.push({ s: { r: descRow, c: c0 }, e: { r: descRow, c: c1 } });
      }
    }
  }

  return { rows, merges, totalCols, maxDepth };
}

// Build the flat "Outline" sheet as an array-of-arrays. Returns the aoa plus
// the depth-sorted node list (used to attach hyperlinks by row index).
function buildOutline(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pathOf = (n) => {
    const parts = [];
    const seen = new Set();
    let cur = n;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.data && cur.data.label ? cur.data.label : '');
      cur = cur.data && cur.data.parent_id ? byId.get(cur.data.parent_id) : null;
    }
    return parts.join(' > ');
  };
  const sorted = [...nodes].sort((a, b) => {
    const da = (a.data && a.data.depth) || 0;
    const db = (b.data && b.data.depth) || 0;
    if (da !== db) return da - db;
    const ay = (a.position && a.position.y) || 0;
    const by = (b.position && b.position.y) || 0;
    return ay - by;
  });
  const aoa = [
    ['Level', 'Path', 'Topic', 'Notes', 'Parent Topic', 'Attachments', 'Linked Canvas'],
  ];
  for (const n of sorted) {
    const d = n.data || {};
    const parent = d.parent_id ? byId.get(d.parent_id) : null;
    aoa.push([
      d.depth != null ? d.depth : '',
      pathOf(n),
      d.label || '',
      d.content || '',
      parent && parent.data ? parent.data.label || '' : '',
      d.attachmentCount || 0,
      d.linked_canvas_name || '',
    ]);
  }
  return { aoa, sorted };
}

// Shared depth-based gradient (deep yellow -> faded yellow) and font-size ramp
// (root -> leaf). Used by both the Excel export and the in-app table view.
function depthGradient(maxDepth) {
  const safe = Math.max(0, maxDepth || 0);
  const tFor = (depth) => (safe <= 0 ? 0 : Math.min(1, depth / safe));
  const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase();
  const colorFor = (depth) => {
    const t = tFor(depth);
    const g = 195 + (249 - 195) * t;
    const b = 0 + (196 - 0) * t;
    return `#${hex2(255)}${hex2(g)}${hex2(b)}`;
  };
  const sizeFor = (depth) => Math.round(20 - 10 * tFor(depth));
  return { colorFor, sizeFor };
}

function TabularView({ nodes, onOpenCanvas }) {
  const data = useMemo(() => buildTreeSheet(nodes), [nodes]);
  const { colorFor, sizeFor } = depthGradient(data.maxDepth);
  return (
    <div className="tabular-view">
      {data.rows.map((row, r) => (
        <div
          key={r}
          className="tabular-row"
          style={{ gridTemplateColumns: `repeat(${data.totalCols}, minmax(72px, 1fr))` }}
        >
          {row.map((cell, c) => {
            if (!cell) return null;
            const isLabel = r % 2 === 0;
            const size = isLabel ? sizeFor(cell.depth) : Math.max(9, sizeFor(cell.depth) - 4);
            return (
              <div
                key={c}
                className={`tabular-cell${isLabel ? ' tabular-cell-label' : ' tabular-cell-desc'}${cell.linked ? ' tabular-cell-link' : ''}`}
                style={{
                  gridColumn: `span ${cell.span || 1}`,
                  backgroundColor: colorFor(cell.depth),
                  fontSize: `${size}px`,
                }}
                title={cell.linked ? 'Open linked canvas' : undefined}
                onClick={cell.linked ? () => onOpenCanvas(cell.linked, cell.v) : undefined}
              >
                {cell.v}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Icon-only action button. A single click reveals its two-word label; a
// double click (two clicks within a short window) runs the action.
function ToolIcon({ glyph, label, title, active, disabled, onActivate, immediate }) {
  const clickTimer = useRef(null);
  const labelTimer = useRef(null);
  const [showLabel, setShowLabel] = useState(false);

  useEffect(() => {
    return () => {
      clearTimeout(clickTimer.current);
      clearTimeout(labelTimer.current);
    };
  }, []);

  const handleClick = () => {
    if (disabled) return;
    if (immediate) {
      onActivate();
      return;
    }
    if (clickTimer.current) {
      // Second click inside the window => double-click => perform the action.
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      clearTimeout(labelTimer.current);
      setShowLabel(false);
      onActivate();
    } else {
      // First click => reveal the label briefly.
      setShowLabel(true);
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
      }, 350);
      clearTimeout(labelTimer.current);
      labelTimer.current = setTimeout(() => setShowLabel(false), 2000);
    }
  };

  return (
    <button
      type="button"
      className={`tool-icon${active ? ' tool-icon-active' : ''}`}
      onClick={handleClick}
      title={title}
      aria-label={label}
      disabled={disabled}
    >
      <span className="tool-icon-glyph" aria-hidden="true">{glyph}</span>
      {showLabel && <span className="tool-icon-label">{label}</span>}
    </button>
  );
}

// Compute a top-down (vertical) layout: depth flows down the y-axis and
// siblings spread along the x-axis, centered under their parent.
function layoutVertical(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map();
  const roots = [];
  for (const n of nodes) {
    const pid = n.data && n.data.parent_id;
    if (!pid || !byId.has(pid)) roots.push(n);
    else {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(n);
    }
  }
  for (const [pid, list] of children) {
    list.sort((a, b) => (a.position.y - b.position.y) || (((a.data && a.data.depth) || 0) - ((b.data && b.data.depth) || 0)));
  }

  const depthSpacing = 120;
  const leafSpacing = 280;
  const positions = new Map();
  let leafIndex = 0;

  const assignX = (n) => {
    const kids = children.get(n.id) || [];
    if (kids.length === 0) {
      const x = leafIndex * leafSpacing;
      leafIndex += 1;
      positions.set(n.id, x);
      return x;
    }
    const xs = kids.map(assignX);
    const x = (xs[0] + xs[xs.length - 1]) / 2;
    positions.set(n.id, x);
    return x;
  };

  roots.forEach(assignX);

  const out = new Map();
  for (const n of nodes) {
    const d = (n.data && n.data.depth) || 0;
    out.set(n.id, { x: positions.get(n.id) ?? 0, y: d * depthSpacing });
  }
  return out;
}

export default function BrainMapCanvas(props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ canvasId, canvasName, onBack, onOpenCanvas }) {
  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [previewNodeId, setPreviewNodeId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [parentCanvases, setParentCanvases] = useState([]);
  const [zoomLock, setZoomLock] = useState(false);
  const [tabularMode, setTabularMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importContext, setImportContext] = useState({ parentId: null, nodeId: null });
  const [panelRefresh, setPanelRefresh] = useState(0);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem('canvas_dark_mode') === '1';
    } catch (e) {
      return false;
    }
  });
  const [panelWidth, setPanelWidth] = useState(360);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const viewport = useViewport();
  const zoom = viewport.zoom;
  const { setCenter, fitView, zoomIn } = useReactFlow();
  const didFit = useRef(false);
  const clickTimer = useRef(null);
  const lastNodeClickRef = useRef({ id: null, time: 0 });
  const paneClickTimer = useRef(null);
  const baselineRef = useRef(null);
  const tempIdRef = useRef(0);
  const mergeRef = useRef([]);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [focusMode, setFocusMode] = useState(false);
  const [focusedNodeIds, setFocusedNodeIds] = useState([]);
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const [freezeNodes, setFreezeNodes] = useState(true);
  const [floatingControlsVisible, setFloatingControlsVisible] = useState(true);
  const hideControlsTimer = useRef(null);
  const [alignMode, setAlignMode] = useState(false);
  const [alignLines, setAlignLines] = useState([]);
  const [connectMode, setConnectMode] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [vertical, setVertical] = useState(false);
  const [compress, setCompress] = useState(1);
  const [nodesLocked, setNodesLocked] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [offline, setOffline] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const verticalPositions = useMemo(() => (vertical ? layoutVertical(nodes) : null), [vertical, nodes]);
  const alignBaselineRef = useRef(null);
  const [revealedParentIds, setRevealedParentIds] = useState(() => new Set());
  const [collapsedParentIds, setCollapsedParentIds] = useState(() => new Set());

  const expandChildren = useCallback((nodeId) => {
    setRevealedParentIds((prev) => {
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
    setCollapsedParentIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }, []);

  const collapseChildren = useCallback((nodeId) => {
    setRevealedParentIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
    setCollapsedParentIds((prev) => {
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    const applyData = (data) => {
      setNodes(data.nodes.map(toNode));
      setEdges(
        data.edges.map((e) => ({
          id: e.id,
          source: e.source_id,
          target: e.target_id,
          label: e.label || '',
        }))
      );
      setParentCanvases(data.parentCanvases || []);
      setCanEdit(!!(data.canvas && data.canvas.can_edit));
    };

    try {
      // Push any offline edits for this canvas before loading fresh.
      const pending = await loadCanvasContent(canvasId);
      if (pending && pending.pendingSync && pending.nodes) {
        await api.syncCanvas(canvasId, { nodes: pending.nodes, edges: pending.edges || [] });
      }
      const data = await api.getCanvas(canvasId);
      applyData(data);
      setOffline(false);
      // Mirror this canvas locally (clearing any pending-sync marker).
      saveCanvasContent(canvasId, { ...data, pendingSync: false });
    } catch (e) {
      const local = await loadCanvasContent(canvasId);
      if (local && local.nodes) {
        applyData(local);
        setOffline(true); // editable offline for canvases you own
      } else {
        console.error(e);
        alert('Failed to load canvas: ' + e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [canvasId, setNodes, setEdges, setParentCanvases]);

  useEffect(() => {
    load();
  }, [load]);

  // In edit mode, ignore React Flow's own removals so deletions are handled
  // (and made undoable) by our own staged handlers.
  const handleNodesChange = useCallback(
    (changes) => {
      if (editMode) {
        setNodes((nds) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), nds));
      } else {
        setNodes((nds) => applyNodeChanges(changes, nds));
      }
    },
    [editMode, setNodes]
  );

  const handleEdgesChange = useCallback(
    (changes) => {
      if (editMode) {
        setEdges((eds) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), eds));
      } else {
        setEdges((eds) => applyEdgeChanges(changes, eds));
      }
    },
    [editMode, setEdges]
  );

  const makeSnapshot = useCallback(
    () => ({
      nodes: nodes.map((n) => ({ ...n, position: { ...n.position }, data: { ...n.data } })),
      edges: edges.map((e) => ({ ...e })),
    }),
    [nodes, edges]
  );

  const pushUndo = useCallback(() => {
    setUndoStack((s) => [...s, makeSnapshot()]);
    setRedoStack([]);
  }, [makeSnapshot]);

  // Remove ids (and their subtrees) locally; returns the set of removed ids.
  const stageDelete = useCallback(
    (ids) => {
      const subtree = new Set(ids);
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of nodes) {
          if (n.data && n.data.parent_id && subtree.has(n.data.parent_id) && !subtree.has(n.id)) {
            subtree.add(n.id);
            changed = true;
          }
        }
      }
      pushUndo();
      setNodes((nds) => nds.filter((n) => !subtree.has(n.id)));
      setEdges((eds) => eds.filter((e) => !subtree.has(e.source) && !subtree.has(e.target)));
      return subtree;
    },
    [nodes, edges, setNodes, setEdges, pushUndo]
  );

  const undo = useCallback(() => {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, makeSnapshot()]);
    setNodes(prev.nodes);
    setEdges(prev.edges);
  }, [undoStack, makeSnapshot, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, makeSnapshot()]);
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [redoStack, makeSnapshot, setNodes, setEdges]);

  // Add a locally-created node (undoable) during edit mode.
  const stageAddNode = useCallback(
    (newNode) => {
      pushUndo();
      setNodes((nds) => [...nds, newNode]);
    },
    [pushUndo, setNodes]
  );

  // Detach a node from its parent (make it a root) — undoable.
  const stageDetach = useCallback(
    (nodeId) => {
      pushUndo();
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, parent_id: null, depth: 0, isRoot: true } } : n
        )
      );
    },
    [pushUndo, setNodes]
  );

  // Reparent a node under a new parent (undoable) — used by Connect Mode.
  const stageReparent = useCallback(
    (childId, newParentId) => {
      pushUndo();
      setNodes((nds) => {
        const child = nds.find((n) => n.id === childId);
        const parent = nds.find((n) => n.id === newParentId);
        if (!child || !parent) return nds;
        const newDepth = parent.data.depth + 1;
        const depthDelta = newDepth - child.data.depth;

        // Collect the child's subtree so its depths shift together.
        const subtree = new Set([childId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const n of nds) {
            if (n.data && n.data.parent_id && subtree.has(n.data.parent_id) && !subtree.has(n.id)) {
              subtree.add(n.id);
              changed = true;
            }
          }
        }

        return nds.map((n) => {
          if (n.id === childId) {
            return { ...n, data: { ...n.data, parent_id: newParentId, depth: newDepth, isRoot: false } };
          }
          if (subtree.has(n.id) && depthDelta !== 0) {
            return { ...n, data: { ...n.data, depth: Math.max(0, n.data.depth + depthDelta) } };
          }
          return n;
        });
      });
    },
    [pushUndo, setNodes]
  );

  const onNodeAction = useCallback(
    (nodeId, action) => {
      if (!editMode) return;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const parentDepth = (node.data && node.data.depth) || 0;

      const temp = (parentId, depth, x, y) => ({
        id: `tmp-${++tempIdRef.current}`,
        type: 'mindmap',
        position: { x, y },
        data: {
          label: 'New topic',
          content: '',
          depth,
          isRoot: !parentId,
          parent_id: parentId,
          attachmentCount: 0,
          linked_canvas_id: null,
          linked_canvas_name: '',
        },
      });

      if (action === 'child') {
        const childCount = nodes.filter((n) => n.data && n.data.parent_id === nodeId).length;
        stageAddNode(temp(nodeId, parentDepth + 1, node.position.x + 260, node.position.y + childCount * 90));
      } else if (action === 'sibling-top' || action === 'sibling-bottom') {
        const parentId = (node.data && node.data.parent_id) || null;
        const y = action === 'sibling-top' ? node.position.y - 90 : node.position.y + 90;
        stageAddNode(temp(parentId, parentDepth, node.position.x, y));
      } else if (action === 'detach') {
        stageDetach(nodeId);
      }
    },
    [editMode, nodes, stageAddNode, stageDetach]
  );

  const enterEditMode = useCallback(() => {
    if (!canEdit) return;
    baselineRef.current = makeSnapshot();
    setUndoStack([]);
    setRedoStack([]);
    setPreviewNodeId(null);
    setSelectedNodeId(null);
    setVertical(false);
    setCompress(1);
    setDrawMode(false);
    // Unlock nodes so they can be dragged while editing.
    setFreezeNodes(false);
    mergeRef.current = [];
    setEditMode(true);
  }, [makeSnapshot, canEdit]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setConnectMode(false);
    setDrawMode(false);
    setUndoStack([]);
    setRedoStack([]);
    baselineRef.current = null;
    mergeRef.current = [];
    setFreezeNodes(true);
  }, []);

  // Merge a node into its parent (undoable, staged): optionally append its
  // title/description to the parent, then move its children up and remove it.
  const stageMerge = useCallback(
    (nodeId, mode) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const parentId = (node.data && node.data.parent_id) || null;
      if (!parentId) return;

      pushUndo();
      mergeRef.current.push({ nodeId, mode });

      // Collect the node's subtree (children + descendants) to shift depths.
      const subtree = new Set([nodeId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const n of nodes) {
          if (n.data && n.data.parent_id && subtree.has(n.data.parent_id) && !subtree.has(n.id)) {
            subtree.add(n.id);
            changed = true;
          }
        }
      }

      setNodes((nds) =>
        nds
          .filter((n) => n.id !== nodeId)
          .map((n) => {
            if (n.id === parentId && mode === 'append') {
              const pLabel = (n.data && n.data.label) || '';
              const cLabel = (node.data && node.data.label) || '';
              const pContent = (n.data && n.data.content) || '';
              const cContent = (node.data && node.data.content) || '';
              const newLabel = pLabel && cLabel ? `${pLabel} & ${cLabel}` : pLabel || cLabel;
              const newContent = [pContent, cContent].filter((s) => s && String(s).trim()).join('\n\n');
              return { ...n, data: { ...n.data, label: newLabel, content: newContent } };
            }
            if (n.data && n.data.parent_id === nodeId) {
              return { ...n, data: { ...n.data, parent_id: parentId, depth: Math.max(0, (n.data.depth || 0) - 1) } };
            }
            if (subtree.has(n.id)) {
              return { ...n, data: { ...n.data, depth: Math.max(0, (n.data.depth || 0) - 1) } };
            }
            return n;
          })
      );

      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    },
    [nodes, pushUndo, setNodes, setEdges]
  );

  // Convert drawn shapes into staged (undoable) brain-map nodes at their drawn positions.
  const generateFromShapes = useCallback(
    (shapes) => {
      if (!shapes.length) return;
      pushUndo();
      const created = shapes.map((s) => {
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        return {
          id: `tmp-${++tempIdRef.current}`,
          type: 'mindmap',
          position: { x: (cx - viewport.x) / viewport.zoom, y: (cy - viewport.y) / viewport.zoom },
          data: {
            label: (s.text || '').trim() || 'New topic',
            content: '',
            depth: 0,
            isRoot: true,
            parent_id: null,
            attachmentCount: 0,
            linked_canvas_id: null,
            linked_canvas_name: '',
          },
        };
      });
      setNodes((nds) => [...nds, ...created]);
      setSelectedNodeId(null);
      setDrawMode(false);
    },
    [pushUndo, setNodes, viewport]
  );

  const persistLocalState = useCallback(async () => {
    const existing = (await loadCanvasContent(canvasId)) || {};
    const genId = () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    };
    const idMap = new Map();
    const mapId = (id) => {
      if (!id) return null;
      if (!String(id).startsWith('tmp-')) return id;
      if (!idMap.has(id)) idMap.set(id, genId());
      return idMap.get(id);
    };
    const rawNodes = nodes.map((n) => ({
      id: mapId(n.id),
      parent_id: mapId(n.data && n.data.parent_id),
      label: n.data.label,
      content: n.data.content || '',
      x: n.position.x,
      y: n.position.y,
      depth: n.data.depth || 0,
      linked_canvas_id: (n.data && n.data.linked_canvas_id) || null,
    }));
    const rawEdges = edges.map((e) => ({
      id: e.id,
      source_id: mapId(e.source),
      target_id: mapId(e.target),
      label: e.label || '',
    }));
    await saveCanvasContent(canvasId, {
      canvas: { ...(existing.canvas || {}), id: canvasId, name: canvasName, can_edit: true },
      nodes: rawNodes,
      edges: rawEdges,
      parentCanvases: existing.parentCanvases || [],
      pendingSync: true,
    });
  }, [nodes, edges, canvasId, canvasName]);

  const saveEdit = useCallback(async () => {
    const baseline = baselineRef.current;
    if (!baseline) return;
    if (!navigator.onLine) {
      await persistLocalState();
      exitEditMode();
      setSelectedNodeId(null);
      setOffline(true);
      await load();
      return;
    }
    try {
      const baseIds = new Set(baseline.nodes.map((n) => n.id));
      const currIds = new Set(nodes.map((n) => n.id));

      // 0. Merges first (reparent children + delete node atomically) so the
      // children aren't cascade-deleted along with the merged node.
      for (const m of mergeRef.current) {
        await api.mergeNode(m.nodeId, m.mode);
      }
      const mergedIds = new Set(mergeRef.current.map((m) => m.nodeId));
      mergeRef.current = [];

      // 1. Deleted nodes (topmost only; cascade handles descendants)
      const deletedNodes = baseline.nodes.filter((n) => !currIds.has(n.id) && !mergedIds.has(n.id));
      const deletedIds = new Set(deletedNodes.map((n) => n.id));
      const topmost = deletedNodes.filter(
        (n) => !(n.data && n.data.parent_id) || !deletedIds.has(n.data.parent_id)
      );
      for (const n of topmost) await api.deleteNode(n.id);

      // 2. Added nodes (temp ids -> create, parents first)
      const added = nodes.filter((n) => !baseIds.has(n.id));
      const idMap = new Map();
      const sortedAdded = [...added].sort(
        (a, b) => ((a.data && a.data.depth) || 0) - ((b.data && b.data.depth) || 0)
      );
      for (const n of sortedAdded) {
        const parentTemp = n.data && n.data.parent_id;
        const parentReal = parentTemp && idMap.has(parentTemp) ? idMap.get(parentTemp) : parentTemp || null;
        const created = await api.createNode(canvasId, {
          label: n.data.label,
          content: n.data.content || '',
          parent_id: parentReal,
          x: n.position.x,
          y: n.position.y,
        });
        idMap.set(n.id, created.id);
      }

      // 3. Detached nodes (parent changed)
      const baseMap = new Map(baseline.nodes.map((n) => [n.id, n]));
      for (const n of nodes) {
        if (!baseIds.has(n.id)) continue;
        const b = baseMap.get(n.id);
        const oldParent = (b.data && b.data.parent_id) || null;
        const newParent = (n.data && n.data.parent_id) || null;
        const moved = b.position.x !== n.position.x || b.position.y !== n.position.y;
        const payload = {};
        if (oldParent !== newParent) payload.parent_id = newParent;
        if (moved) {
          payload.x = n.position.x;
          payload.y = n.position.y;
        }
        if (Object.keys(payload).length) await api.updateNode(n.id, payload);
      }

      // 4. Deleted cross-link edges
      const currEdgeIds = new Set(edges.map((e) => e.id));
      for (const e of baseline.edges) {
        if (!currEdgeIds.has(e.id)) await api.deleteEdge(e.id);
      }

      exitEditMode();
      setSelectedNodeId(null);
      await load();
    } catch (e) {
      // Offline / server unreachable: keep changes locally for a later sync.
      await persistLocalState();
      exitEditMode();
      setSelectedNodeId(null);
      setOffline(true);
      await load();
    }
  }, [nodes, edges, canvasId, exitEditMode, load, persistLocalState]);

  const cancelEdit = useCallback(() => {
    const baseline = baselineRef.current;
    if (baseline) {
      setNodes(baseline.nodes);
      setEdges(baseline.edges);
    }
    exitEditMode();
  }, [exitEditMode, setNodes, setEdges]);

  const onDeleteNode = useCallback(
    (nodeId) => {
      stageDelete([nodeId]);
      setSelectedNodeId(null);
      setPreviewNodeId(null);
    },
    [stageDelete]
  );

  // parent-child edges (solid, from tree) + cross-links (dashed, from edges table)
  const derivedEdges = useMemo(() => {
    const parentStroke = darkMode ? '#768390' : '#94a3b8';
    const linkStroke = darkMode ? '#539bf5' : '#1a73e8';
    const pc = nodes
      .filter((n) => n.data && n.data.parent_id)
      .map((n) => ({
        id: `pc-${n.id}`,
        source: n.data.parent_id,
        target: n.id,
        type: 'smoothstep',
        deletable: false,
        style: { stroke: parentStroke, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: parentStroke },
      }));
    const cl = edges.map((e) => ({
      ...e,
      type: 'smoothstep',
      deletable: true,
      animated: true,
      style: { stroke: linkStroke, strokeWidth: 1.5, strokeDasharray: '6 6' },
      markerEnd: { type: MarkerType.ArrowClosed, color: linkStroke },
    }));
    return [...pc, ...cl];
  }, [nodes, edges, darkMode]);

  // In Focus Mode, only the most recently dropped node + its descendants
  // stay visible on the canvas; earlier focused nodes are "forgotten"
  // (but their chips remain in the bar).
  const focusedSubtreeIds = useMemo(() => {
    if (!focusMode || focusedNodeIds.length === 0) return null;
    const lastId = focusedNodeIds[focusedNodeIds.length - 1];
    const set = new Set([lastId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of nodes) {
        if (n.data && n.data.parent_id && set.has(n.data.parent_id) && !set.has(n.id)) {
          set.add(n.id);
          changed = true;
        }
      }
    }
    return set;
  }, [focusMode, focusedNodeIds, nodes]);

  // Depth of the focused node — makes progressive disclosure relative to the
  // focus, so the focused node is always treated as depth 0.
  const focusBaseDepth = useMemo(() => {
    if (!focusMode || focusedNodeIds.length === 0) return 0;
    const lastId = focusedNodeIds[focusedNodeIds.length - 1];
    const last = nodes.find((n) => n.id === lastId);
    return (last && last.data && last.data.depth) || 0;
  }, [focusMode, focusedNodeIds, nodes]);

  // Immediate children of the hovered node (highlighted).
  const hoveredChildIds = useMemo(() => {
    if (!hoveredNodeId) return new Set();
    return new Set(nodes.filter((n) => n.data && n.data.parent_id === hoveredNodeId).map((n) => n.id));
  }, [hoveredNodeId, nodes]);

  // Ancestor chain of the hovered node, up to and including the root (highlighted in orange).
  const hoveredParentIds = useMemo(() => {
    const set = new Set();
    if (!hoveredNodeId) return set;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let cur = byId.get(hoveredNodeId);
    while (cur && cur.data && cur.data.parent_id) {
      const parentId = cur.data.parent_id;
      set.add(parentId);
      cur = byId.get(parentId);
    }
    return set;
  }, [hoveredNodeId, nodes]);

  // progressive disclosure + focus mode filtering + hover highlight + reveal
  const visible = useMemo(() => {
    const threshold = depthThreshold(zoom);
    const scale = (nodesLocked ? 1 : nodeScale(zoom)) * compress;
    const hidden = new Set();

    // Pass 1: decide hidden nodes (zoom threshold + focus + manual collapse/reveal).
    nodes.forEach((n) => {
      const rawDepth = (n.data && n.data.depth) || 0;
      const d = focusedSubtreeIds ? Math.max(0, rawDepth - focusBaseDepth) : rawDepth;
      const parentId = n.data && n.data.parent_id;
      let op;
      if (parentId && collapsedParentIds.has(parentId)) {
        op = 0; // manually collapsed
      } else if (parentId && revealedParentIds.has(parentId)) {
        op = 1; // manually revealed
      } else {
        op = nodesLocked ? 1 : nodeOpacity(d, threshold);
      }
      const focusHidden = focusedSubtreeIds && !focusedSubtreeIds.has(n.id);
      if (op <= 0.03 || focusHidden) hidden.add(n.id);
    });

    // Pass 2: build visible nodes + flag nodes with hidden/visible children.
    const vnodes = nodes.map((n) => {
      const rawDepth = (n.data && n.data.depth) || 0;
      const d = focusedSubtreeIds ? Math.max(0, rawDepth - focusBaseDepth) : rawDepth;
      const parentId = n.data && n.data.parent_id;
      let op;
      if (parentId && collapsedParentIds.has(parentId)) {
        op = 0;
      } else if (parentId && revealedParentIds.has(parentId)) {
        op = 1;
      } else {
        op = nodesLocked ? 1 : nodeOpacity(d, threshold);
      }
      const focusHidden = focusedSubtreeIds && !focusedSubtreeIds.has(n.id);
      const hasHiddenChildren = nodes.some(
        (c) => c.data && c.data.parent_id === n.id && hidden.has(c.id)
      );
      const hasVisibleChildren = nodes.some(
        (c) => c.data && c.data.parent_id === n.id && !hidden.has(c.id)
      );
      const basePos = vertical ? (verticalPositions.get(n.id) || n.position) : n.position;
      return {
        ...n,
        hidden: op <= 0.03 || focusHidden,
        position: { x: basePos.x * compress, y: basePos.y * compress },
        style: { ...n.style, opacity: Math.max(op, 0), transition: 'opacity 200ms ease' },
        data: {
          ...n.data,
          scale,
          highlighted: hoveredChildIds.has(n.id),
          parentHighlighted: hoveredParentIds.has(n.id),
          editMode,
          connectMode,
          onAction: onNodeAction,
          onOpenLinked: onOpenCanvas,
          hasHiddenChildren,
          hasVisibleChildren,
          onExpand: expandChildren,
          onCollapse: collapseChildren,
        },
      };
    });
    const vedges = derivedEdges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target));
    return { nodes: vnodes, edges: vedges };
  }, [nodes, derivedEdges, zoom, focusedSubtreeIds, focusBaseDepth, hoveredChildIds, hoveredParentIds, editMode, connectMode, onNodeAction, revealedParentIds, collapsedParentIds, expandChildren, collapseChildren, vertical, verticalPositions, compress, nodesLocked, onOpenCanvas]);

  // Fit the whole tree to the screen: shrink node content AND spacing so the
  // tree fits at a readable zoom, without changing its orientation.
  const fitToScreen = useCallback(() => {
    if (!nodes.length) return;
    const nodeW = 260;
    const nodeH = 64;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const base = vertical ? (verticalPositions.get(n.id) || n.position) : n.position;
      minX = Math.min(minX, base.x);
      minY = Math.min(minY, base.y);
      maxX = Math.max(maxX, base.x + nodeW);
      maxY = Math.max(maxY, base.y + nodeH);
    }
    const W = Math.max(1, maxX - minX);
    const H = Math.max(1, maxY - minY);
    const margin = 24;
    const vw = Math.max(160, window.innerWidth - margin * 2);
    const vh = Math.max(160, window.innerHeight - margin * 2 - 60);
    const fit = Math.min(vw / W, vh / H);
    setCompress(Math.max(0.05, Math.min(1, fit)));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitView({ padding: 0.08, duration: 400, maxZoom: 1.5 }));
    });
  }, [nodes, vertical, verticalPositions, setCompress, fitView]);

  // Re-centre when the orientation is toggled.
  useEffect(() => {
    if (vertical) {
      requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 }));
    }
  }, [vertical, fitView]);

  useEffect(() => {
    if (!loading && !didFit.current && nodes.length > 0) {
      didFit.current = true;
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
    }
  }, [loading, nodes.length, fitView]);

  const exportExcel = useCallback(async () => {
    // Load SheetJS on demand so the export library isn't in the initial bundle.
    const XLSX = await import('xlsx-js-style');

    // Recursively collect the current canvas plus every linked canvas.
    const canvases = [];
    const canvasById = new Map();
    const visited = new Set();
    const queue = [{ id: canvasId, name: canvasName, nodes }];
    while (queue.length) {
      const item = queue.shift();
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      canvases.push(item);
      canvasById.set(item.id, item);
      for (const n of item.nodes) {
        const lid = n.data && n.data.linked_canvas_id;
        if (lid && !visited.has(lid)) {
          try {
            const d = await api.getCanvas(lid);
            queue.push({
              id: lid,
              name: (d.canvas && d.canvas.name) || 'Canvas',
              nodes: (d.nodes || []).map(toNode),
            });
          } catch (e) {
            console.warn('[export] failed to load linked canvas', lid, e && e.message);
          }
        }
      }
    }

    // Assign unique, Excel-safe sheet names (Outline + Tree per canvas).
    const sanitize = (s) =>
      String(s || 'Canvas')
        .replace(/[^\p{L}\p{N} .\-()&,]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 31) || 'Canvas';
    const used = new Set(['Outline', 'Tree']);
    const treeSheetName = new Map();
    const outlineSheetName = new Map();
    treeSheetName.set(canvasId, 'Tree');
    outlineSheetName.set(canvasId, 'Outline');
    for (const c of canvases) {
      if (c.id === canvasId) continue;
      const base = sanitize(c.name);

      let tname = base;
      for (let n = 2; used.has(tname); n++) {
        const suffix = ` (${n})`;
        tname = base.slice(0, 31 - suffix.length) + suffix;
      }
      used.add(tname);
      treeSheetName.set(c.id, tname);

      let oname = sanitize(`${base} Outline`);
      for (let n = 2; used.has(oname); n++) {
        const suffix = ` (${n})`;
        oname = sanitize(`${base} Outline`).slice(0, 31 - suffix.length) + suffix;
      }
      used.add(oname);
      outlineSheetName.set(c.id, oname);
    }

    const linkTarget = (id) => {
      const name = treeSheetName.get(id);
      return name ? `#'${name}'!A1` : null;
    };

    const safe =
      String(canvasName || 'brain-map').replace(/[\\/:*?"<>|]+/g, '').trim() || 'brain-map';
    const wb = XLSX.utils.book_new();

    for (const c of canvases) {
      const { aoa, sorted } = buildOutline(c.nodes);

      // --- Outline sheet ---
      const wsOutline = XLSX.utils.aoa_to_sheet(aoa);
      wsOutline['!cols'] = [
        { wch: 6 },
        { wch: 48 },
        { wch: 28 },
        { wch: 60 },
        { wch: 24 },
        { wch: 12 },
        { wch: 20 },
      ];
      // Wrap every cell so long Notes / Paths never get cut off. Excel auto-fits
      // these non-merged row heights when the file is opened.
      const refO = XLSX.utils.decode_range(wsOutline['!ref']);
      for (let R = refO.s.r; R <= refO.e.r; R++) {
        const node = R === 0 ? null : sorted[R - 1];
        for (let C = refO.s.c; C <= refO.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          if (!wsOutline[addr]) continue;
          wsOutline[addr].s =
            R === 0
              ? { alignment: { horizontal: 'center', vertical: 'center', wrapText: true } }
              : { alignment: { vertical: 'top', wrapText: true } };
          const lid = node && node.data && node.data.linked_canvas_id;
          if (C === 2 && lid && linkTarget(lid)) {
            wsOutline[addr].s.font = { color: { rgb: 'FF0563C1' }, underline: true };
            wsOutline[addr].l = {
              Target: linkTarget(lid),
              Tooltip: `Open linked canvas: ${(canvasById.get(lid) || {}).name || ''}`,
            };
          }
        }
      }
      XLSX.utils.book_append_sheet(wb, wsOutline, outlineSheetName.get(c.id));

      // --- Tree sheet ---
      const tree = buildTreeSheet(c.nodes);
      const wsTree = {};
      const maxDepth = tree.maxDepth || 0;
      const tFor = (depth) => (maxDepth <= 0 ? 0 : depth / maxDepth);
      const hex2 = (v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase();
      const fillFor = (depth) => {
        const t = tFor(depth);
        const g = 195 + (249 - 195) * t;
        const b = 0 + (196 - 0) * t;
        return { patternType: 'solid', fgColor: { rgb: `FF${hex2(255)}${hex2(g)}${hex2(b)}` } };
      };
      const sizeFor = (depth) => Math.round(20 - 10 * tFor(depth));

      for (let r = 0; r < tree.rows.length; r++) {
        for (let col = 0; col < tree.totalCols; col++) {
          const cell = tree.rows[r][col];
          if (!cell) continue;
          const font = { sz: sizeFor(cell.depth) };
          if (cell.linked && linkTarget(cell.linked)) {
            font.color = { rgb: 'FF0563C1' };
            font.underline = true;
          }
          const cellObj = {
            v: cell.v,
            t: 's',
            s: {
              alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
              fill: fillFor(cell.depth),
              font,
            },
          };
          if (cell.linked && linkTarget(cell.linked)) {
            cellObj.l = {
              Target: linkTarget(cell.linked),
              Tooltip: `Open linked canvas: ${(canvasById.get(cell.linked) || {}).name || ''}`,
            };
          }
          wsTree[XLSX.utils.encode_cell({ r, c: col })] = cellObj;
        }
      }
      wsTree['!ref'] = XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: tree.rows.length - 1, c: tree.totalCols - 1 },
      });
      wsTree['!merges'] = tree.merges;
      wsTree['!cols'] = Array.from({ length: tree.totalCols }, () => ({ wch: 18 }));

      const colWch = 18;
      const estimateLines = (text, span, fontSize) => {
        const s = String(text || '');
        if (!s) return 1;
        const charsPerLine = Math.max(6, Math.floor((span * colWch * 10) / Math.max(8, fontSize)));
        let total = 0;
        for (const line of s.split('\n')) {
          total += Math.max(1, Math.ceil(line.length / charsPerLine));
        }
        return total;
      };
      const rowHeights = [];
      for (let r = 0; r < tree.rows.length; r++) {
        const depth = Math.floor(r / 2);
        const fontSize = sizeFor(depth);
        let lines = 1;
        for (let col = 0; col < tree.totalCols; col++) {
          const cell = tree.rows[r][col];
          if (!cell) continue;
          const l = estimateLines(cell.v, cell.span || 1, fontSize);
          if (l > lines) lines = l;
        }
        rowHeights.push({ hpt: Math.ceil(lines * fontSize * 1.5) + 10 });
      }
      wsTree['!rows'] = rowHeights;
      XLSX.utils.book_append_sheet(wb, wsTree, treeSheetName.get(c.id));
    }

    XLSX.writeFile(wb, `${safe}.xlsx`);
  }, [nodes, canvasName, canvasId]);

  const handleConnect = useCallback(
    async (connection) => {
      // Connect Mode: reparent (target becomes a child of source).
      if (connectMode && connection.sourceHandle === 'parent-source' && connection.targetHandle === 'parent-target') {
        if (connection.source === connection.target) return;
        const targetNode = nodes.find((n) => n.id === connection.target);
        if (targetNode && targetNode.data && targetNode.data.parent_id === connection.source) return;
        // Reject if source is already a descendant of target (would create a cycle).
        let cur = connection.source;
        const seen = new Set();
        let cycle = false;
        while (cur) {
          if (seen.has(cur)) break;
          seen.add(cur);
          if (cur === connection.target) {
            cycle = true;
            break;
          }
          const n = nodes.find((x) => x.id === cur);
          cur = n && n.data && n.data.parent_id ? n.data.parent_id : null;
        }
        if (cycle) {
          alert('Cannot connect — this would create a cycle.');
          return;
        }
        stageReparent(connection.target, connection.source);
        return;
      }
      try {
        const edge = await api.createEdge(canvasId, {
          source_id: connection.source,
          target_id: connection.target,
          label: '',
        });
        setEdges((eds) => [
          ...eds,
          { id: edge.id, source: edge.source_id, target: edge.target_id, label: edge.label || '' },
        ]);
      } catch (e) {
        alert(e.message);
      }
    },
    [connectMode, canvasId, setEdges, stageReparent, nodes]
  );

  const addFocus = useCallback((id) => {
    setFocusedNodeIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }, []);

  const removeFocus = useCallback((id) => {
    setFocusedNodeIds((ids) => ids.filter((x) => x !== id));
  }, []);

  const handleFocusSelect = useCallback(
    (id) => {
      addFocus(id);
      requestAnimationFrame(() => fitView({ padding: 0.15, duration: 400 }));
    },
    [addFocus, fitView]
  );

  const handleNodeDragStart = useCallback(() => {
    if (editMode) pushUndo();
  }, [editMode, pushUndo]);

  const handleNodeDragStop = useCallback(
    (event, node) => {
      if (focusMode) {
        // Drop a node onto the focus bar (top of screen) to focus on it.
        const cy = event.clientY != null ? event.clientY : event.sourceEvent && event.sourceEvent.clientY;
        if (typeof cy === 'number' && cy < 70) {
          addFocus(node.id);
          load().finally(() => {
            requestAnimationFrame(() => fitView({ padding: 0.15, duration: 400 }));
          });
          return;
        }
      }
      if (editMode) return; // staged move — position already updated locally
      api.updateNode(node.id, { x: node.position.x, y: node.position.y }).catch(console.error);
    },
    [focusMode, editMode, addFocus, load, fitView]
  );

  const handleEdgesDelete = useCallback(
    (deleted) => {
      if (editMode) {
        pushUndo();
        setEdges((eds) => eds.filter((e) => !deleted.some((d) => d.id === e.id)));
        return;
      }
      deleted.forEach((e) => {
        if (!e.id.startsWith('pc-')) api.deleteEdge(e.id).catch(console.error);
      });
    },
    [editMode, pushUndo, setEdges]
  );

  const handleNodesDelete = useCallback(
    async (deleted) => {
      if (editMode) {
        const ids = deleted.map((n) => n.id);
        const subtree = stageDelete(ids);
        if (subtree.has(selectedNodeId)) setSelectedNodeId(null);
        if (subtree.has(previewNodeId)) setPreviewNodeId(null);
        return;
      }
      const ids = new Set(deleted.map((n) => n.id));
      const topmost = deleted.filter(
        (n) => !(n.data && n.data.parent_id) || !ids.has(n.data.parent_id)
      );
      await Promise.allSettled(topmost.map((n) => api.deleteNode(n.id)));
      if (ids.has(selectedNodeId)) setSelectedNodeId(null);
      await load();
    },
    [editMode, stageDelete, selectedNodeId, previewNodeId, load]
  );

  const enterAlignMode = useCallback(() => {
    alignBaselineRef.current = makeSnapshot();
    let maxDepth = 0;
    for (const n of nodes) {
      const d = (n.data && n.data.depth) || 0;
      if (d > maxDepth) maxDepth = d;
    }
    const lines = [];
    for (let d = 0; d <= maxDepth; d++) {
      let minX = Infinity;
      for (const n of nodes) {
        if (((n.data && n.data.depth) || 0) === d && n.position.x < minX) minX = n.position.x;
      }
      lines[d] = minX === Infinity ? d * 300 : minX;
    }
    setAlignLines(lines);
    setPreviewNodeId(null);
    setSelectedNodeId(null);
    setAlignMode(true);
  }, [nodes, makeSnapshot]);

  const moveDepth = useCallback(
    (depth, newX) => {
      setAlignLines((ls) => {
        const next = [...ls];
        next[depth] = newX;
        return next;
      });
      setNodes((nds) =>
        nds.map((n) =>
          ((n.data && n.data.depth) || 0) === depth
            ? { ...n, position: { ...n.position, x: newX } }
            : n
        )
      );
    },
    [setNodes]
  );

  const cancelAlign = useCallback(() => {
    if (alignBaselineRef.current) {
      setNodes(alignBaselineRef.current.nodes);
      setEdges(alignBaselineRef.current.edges);
    }
    alignBaselineRef.current = null;
    setAlignMode(false);
  }, [setNodes, setEdges]);

  const confirmAlign = useCallback(() => {
    if (editMode && alignBaselineRef.current) {
      setUndoStack((s) => [...s, alignBaselineRef.current]);
      setRedoStack([]);
    }
    alignBaselineRef.current = null;
    setAlignMode(false);
  }, [editMode, setUndoStack, setRedoStack]);

  const focusNode = useCallback(
    (id) => {
      clearTimeout(clickTimer.current);
      setSelectedNodeId(id);
      setPreviewNodeId(null);
      const n = nodes.find((x) => x.id === id);
      if (n) {
        const base = vertical ? (verticalPositions.get(n.id) || n.position) : n.position;
        const sx = base.x * compress * zoom + viewport.x;
        const available = window.innerWidth - sx - 60;
        setPanelWidth(Math.max(280, Math.min(520, available)));
        setCenter(base.x * compress, base.y * compress, { zoom: 1.6, duration: 800 });
      }
    },
    [nodes, setCenter, zoom, viewport.x, vertical, verticalPositions, compress]
  );

  const closePanels = useCallback(() => {
    clearTimeout(clickTimer.current);
    setPreviewNodeId(null);
    setSelectedNodeId(null);
  }, []);

  // Mobile only: auto-hide the floating controls (zoom / fullscreen / freeze /
  // fit) after 5s; tapping the left half of the bottom-left quadrant (of a
  // 4x4 grid) brings them back.
  const scheduleHideControls = useCallback(() => {
    clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      setFloatingControlsVisible(false);
    }, 5000);
  }, []);

  const handleShellPointerDown = useCallback(
    (e) => {
      if (window.innerWidth > 768) return;
      // Bottom-left quadrant = x < width/4 (left column of the 4x4 grid),
      // y > height/2 (the whole lower-left half), not just the single
      // bottom-left sub-cell.
      const inBottomLeft = e.clientX < window.innerWidth / 4 && e.clientY > window.innerHeight / 2;
      if (inBottomLeft) {
        setFloatingControlsVisible(true);
        scheduleHideControls();
      }
    },
    [scheduleHideControls]
  );

  useEffect(() => {
    if (window.innerWidth <= 768) scheduleHideControls();
    return () => clearTimeout(hideControlsTimer.current);
  }, [scheduleHideControls]);

  const handlePaneClick = useCallback(() => {
    closePanels();
    // Double-tap/click on the empty canvas zooms in (unless zoom is locked);
    // a single tap just deselects. Taps on a node never reach this handler.
    if (!zoomLock) {
      if (paneClickTimer.current) {
        clearTimeout(paneClickTimer.current);
        paneClickTimer.current = null;
        zoomIn();
      } else {
        paneClickTimer.current = setTimeout(() => {
          paneClickTimer.current = null;
        }, 260);
      }
    }
  }, [closePanels, zoomIn, zoomLock]);

  // Click handling with a manual, mobile-friendly double-click detector. Two
  // clicks on the same node within DOUBLE_CLICK_MS (300ms) count as a double
  // click: linked-canvas nodes navigate into the linked canvas, every other
  // node opens the editable side panel. A single click opens the read-only
  // preview only after PREVIEW_DELAY_MS so a (possibly slow) second click wins.
  const DOUBLE_CLICK_MS = 300;
  const PREVIEW_DELAY_MS = 350;

  const handleNodeClick = useCallback(
    (e, node) => {
      const d = node.data || {};
      const now = Date.now();
      const last = lastNodeClickRef.current;
      lastNodeClickRef.current = { id: node.id, time: now };
      const isDouble = last.id === node.id && now - last.time <= DOUBLE_CLICK_MS;

      if (isDouble) {
        clearTimeout(clickTimer.current);
        setPreviewNodeId(null);
        if (d.linked_canvas_id && !editMode) {
          onOpenCanvas(d.linked_canvas_id, d.linked_canvas_name || d.label);
          return;
        }
        setSelectedNodeId(node.id);
        const sx = node.position.x * zoom + viewport.x;
        const available = window.innerWidth - sx - 60;
        setPanelWidth(Math.max(280, Math.min(520, available)));
        return;
      }

      // Single click (linked-canvas nodes are skipped: only a double click navigates).
      if (d.linked_canvas_id) return;
      clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => {
        setPreviewNodeId(node.id);
        setSelectedNodeId(null);
      }, PREVIEW_DELAY_MS);
    },
    [editMode, onOpenCanvas, zoom, viewport.x]
  );

  useEffect(() => {
    const onKey = (e) => {
      const target = e.target;
      const isTyping =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (editMode && !isTyping) {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (editMode && !isTyping) {
          e.preventDefault();
          redo();
        }
        return;
      }
      if (e.key === 'Escape') closePanels();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode, undo, redo, closePanels]);

  const previewNode = nodes.find((n) => n.id === previewNodeId) || null;
  let previewStyle = null;
  if (previewNode) {
    const base = vertical ? (verticalPositions.get(previewNode.id) || previewNode.position) : previewNode.position;
    const sx = base.x * compress * zoom + viewport.x;
    const sy = base.y * compress * zoom + viewport.y;
    previewStyle = {
      left: Math.max(8, Math.min(sx + 150, Math.max(8, window.innerWidth - 430))),
      top: Math.max(44, Math.min(sy - 24, Math.max(44, window.innerHeight - 440))),
    };
  }

  const openSidePanel = () => {
    if (!previewNode) return;
    clearTimeout(clickTimer.current);
    setPreviewNodeId(null);
    setSelectedNodeId(previewNode.id);
    const base = vertical ? (verticalPositions.get(previewNode.id) || previewNode.position) : previewNode.position;
    const sx = base.x * compress * zoom + viewport.x;
    const available = window.innerWidth - sx - 60;
    setPanelWidth(Math.max(280, Math.min(520, available)));
  };

  return (
    <div
      className={`canvas-shell${editMode ? ' edit-mode' : ''}${fullscreenMode ? ' fullscreen-mode' : ''}${focusMode ? ' focus-mode' : ''}${darkMode ? ' dark-mode' : ''}${floatingControlsVisible ? '' : ' controls-hidden'}`}
      onPointerDown={handleShellPointerDown}
    >
      <div className="canvas-topbar">
        <button className="btn icon-btn" onClick={onBack} title="Back to canvases" aria-label="Back to canvases">
          <span aria-hidden="true">←</span>
        </button>
        {parentCanvases.length > 0 && (
          <div className="canvas-parents">
            {parentCanvases.map((p) => (
              <button
                key={p.id}
                className="btn canvas-parent-btn"
                title={`Back to parent canvas: ${p.name}`}
                onClick={() => onOpenCanvas(p.id, p.name)}
              >
                ↩ {p.name}
              </button>
            ))}
          </div>
        )}
        <div className="canvas-title">{canvasName}</div>
        <button
          className={`btn icon-btn nodes-locked-toggle${nodesLocked ? ' icon-btn-active' : ''}`}
          onClick={() => setNodesLocked((v) => !v)}
          title={nodesLocked ? 'Nodes Locked — all nodes stay visible while zooming' : 'Nodes Unlocked — child nodes fade in/out with zoom'}
          aria-label={nodesLocked ? 'Nodes Locked' : 'Nodes Unlocked'}
          aria-pressed={nodesLocked}
        >
          <span aria-hidden="true">{nodesLocked ? '🔒' : '🔓'}</span>
        </button>
        <button
          className={`btn icon-btn dark-mode-toggle${darkMode ? ' icon-btn-active' : ''}`}
          onClick={() => {
            setDarkMode((v) => {
              const next = !v;
              try { localStorage.setItem('canvas_dark_mode', next ? '1' : '0'); } catch (e) { /* ignore */ }
              return next;
            });
          }}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={darkMode}
        >
          <span aria-hidden="true">{darkMode ? '☀️' : '🌙'}</span>
        </button>
        <button
          className={`btn icon-btn tools-toggle${toolsOpen ? ' tools-toggle-open' : ''}`}
          onClick={() => setToolsOpen((o) => !o)}
          title="Tools"
          aria-label="Tools"
          aria-expanded={toolsOpen}
        >
          <span aria-hidden="true">⚙️</span>
        </button>
        {toolsOpen && (
          <div className="tools-menu">
            {!editMode ? (
              <>
                <ToolIcon glyph="🔍" label="Find topics" title="Search" active={searchOpen} onActivate={() => setSearchOpen((o) => !o)} />
                <ToolIcon glyph="🔃" label="Rotate view" title="Rotate the tree 90° (top-down)" active={vertical} onActivate={() => setVertical((v) => !v)} />
                <ToolIcon glyph="📊" label="Table view" title={tabularMode ? 'Return to canvas view' : 'View as a root-at-top tabular format'} active={tabularMode} onActivate={() => setTabularMode((v) => !v)} />
                <ToolIcon glyph={zoomLock ? '🔒' : '🔓'} label={zoomLock ? 'Unlock zoom' : 'Lock zoom'} title={zoomLock ? 'Zoom lock ON — scroll to pan the canvas' : 'Zoom lock OFF — scroll to zoom'} active={zoomLock} onActivate={() => setZoomLock((v) => !v)} />
                {canEdit && <ToolIcon glyph="🔗" label="Link canvas" title="Link another canvas" onActivate={() => setLinkModalOpen(true)} />}
                {canEdit && <ToolIcon glyph="📥" label="Import canvas" title="Copy another canvas's topics into this canvas as new roots" onActivate={() => { setImportContext({ parentId: null, nodeId: null }); setImportModalOpen(true); }} />}
                {canEdit && <ToolIcon glyph="🤖" label="Ask AI" title="AI Q&A / build map" active={aiPanelOpen} onActivate={() => setAiPanelOpen((o) => !o)} />}
                <ToolIcon glyph="⬇️" label="Export Excel" title="Download as Excel workbook" onActivate={exportExcel} />
                {canEdit && <ToolIcon glyph="✏️" label="Edit mode" title="Edit canvas" onActivate={enterEditMode} />}
                <ToolIcon glyph="🎯" label="Focus mode" title="Focus Mode" onActivate={() => { setFocusedNodeIds([]); setFocusMode(true); }} />
              </>
            ) : (
              <>
                <ToolIcon glyph="🎨" label="Draw shapes" title="Draw shapes and turn them into map nodes" active={drawMode} onActivate={() => setDrawMode((v) => !v)} />
                <ToolIcon glyph="↶" label="Undo" title="Undo (Ctrl+Z)" disabled={!undoStack.length} onActivate={undo} />
                <ToolIcon glyph="↷" label="Redo" title="Redo (Ctrl+A)" disabled={!redoStack.length} onActivate={redo} />
                <ToolIcon glyph="↔" label="Align nodes" title="Horizontal Aligner" onActivate={enterAlignMode} />
                <ToolIcon glyph="💾" label="Save changes" title="Save" immediate onActivate={saveEdit} />
                <ToolIcon glyph="✖" label="Cancel edit" title="Cancel" immediate onActivate={cancelEdit} />
              </>
            )}
          </div>
        )}
      </div>

      <div className="canvas-body">
        {offline && (
          <div className="canvas-offline-banner">
            ⚠️ Offline — saved locally
          </div>
        )}
        {tabularMode ? (
          <TabularView nodes={nodes} onOpenCanvas={onOpenCanvas} />
        ) : (
          <div className="canvas-flow">
          <ReactFlow
            nodes={visible.nodes}
            edges={visible.edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            onNodeMouseEnter={(e, node) => setHoveredNodeId(node.id)}
            onNodeMouseLeave={() => setHoveredNodeId(null)}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            onEdgesDelete={handleEdgesDelete}
            onNodesDelete={handleNodesDelete}
            onPaneClick={handlePaneClick}
            minZoom={0.2}
            maxZoom={2.5}
            zoomOnScroll={!zoomLock}
            zoomOnDoubleClick={false}
            zoomOnPinch={!zoomLock}
            panOnScroll={zoomLock}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            deleteKeyCode={editMode ? ['Backspace', 'Delete'] : null}
            nodesDraggable={canEdit && !freezeNodes && !alignMode && !connectMode && !vertical && compress === 1}
            nodesConnectable={canEdit && (!editMode || connectMode)}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={editMode ? '#f59e0b' : darkMode ? '#444c56' : '#cbd5e1'} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => (n.data && n.data.isRoot ? (darkMode ? '#539bf5' : '#1a73e8') : darkMode ? '#768390' : '#aecbfa')}
              maskColor={darkMode ? 'rgba(28,33,40,0.75)' : 'rgba(241,245,249,0.7)'}
              bgColor={darkMode ? '#22272e' : '#ffffff'}
            />
          </ReactFlow>

          {editMode && drawMode && (
            <ShapeDrawer
              onGenerate={generateFromShapes}
              onClose={() => setDrawMode(false)}
            />
          )}

          <div className="canvas-floating-actions">
            <button
              className="floating-btn"
              onClick={fitToScreen}
              aria-label="Fit screen"
            >
              ⤢
              <span className="floating-tooltip">Fit screen</span>
            </button>
            <button
              className={`floating-btn${fullscreenMode ? ' floating-btn-active' : ''}`}
              onClick={() => setFullscreenMode((v) => !v)}
              aria-label="Full Screen Mode"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
              <span className="floating-tooltip">{fullscreenMode ? 'Exit full screen' : 'Full screen'}</span>
            </button>
            {canEdit && (
              <button
                className={`floating-btn${freezeNodes ? ' floating-btn-active' : ''}`}
                onClick={() => setFreezeNodes((v) => !v)}
                aria-label="Freeze Nodes"
              >
                ❄️
                <span className="floating-tooltip">{freezeNodes ? 'Unfreeze nodes' : 'Freeze nodes'}</span>
              </button>
            )}
          </div>

          <ZoomControl />

          {alignMode && (
            <HorizontalAligner
              lines={alignLines}
              onLineDrag={moveDepth}
              onConfirm={confirmAlign}
              onCancel={cancelAlign}
            />
          )}

          {!fullscreenMode && editMode && (
            <div className="canvas-toolbar">
              <button
                className={`btn${connectMode ? ' btn-connect-active' : ''}`}
                onClick={() => setConnectMode((v) => !v)}
                title="Connect Mode — drag from a node's centre onto another node to make it a child"
              >
                🔗 {connectMode ? 'Connecting…' : 'Connect Mode'}
              </button>
              <span className="toolbar-hint edit-hint">
                {connectMode
                  ? "Drag from a node's centre and drop on another node to make it a child."
                  : '✏️ Edit mode — click a node and press Delete (or use the panel). Ctrl+Z / Ctrl+A to undo / redo.'}
              </span>
            </div>
          )}

          {!fullscreenMode && searchOpen && (
            <SearchBar canvasId={canvasId} onFocus={focusNode} onClose={() => setSearchOpen(false)} />
          )}

          {!fullscreenMode && linkModalOpen && (
            <LinkCanvasModal
              currentCanvasId={canvasId}
              parentId={selectedNodeId}
              onClose={() => setLinkModalOpen(false)}
              onLinked={load}
            />
          )}

          {!fullscreenMode && importModalOpen && (
            <ImportCanvasModal
              currentCanvasId={canvasId}
              parentId={importContext.parentId}
              nodeId={importContext.nodeId}
              onClose={() => setImportModalOpen(false)}
              onImported={async () => { setPanelRefresh((k) => k + 1); await load(); }}
            />
          )}

          {!fullscreenMode && aiPanelOpen && (
            <AIBuildPanel
              canvasId={canvasId}
              selectedNode={nodes.find((n) => n.id === selectedNodeId) || null}
              nodes={nodes}
              onBuilt={load}
              onClose={() => setAiPanelOpen(false)}
            />
          )}

          {previewNode && previewStyle && (
            <NodePreview
              node={previewNode}
              left={previewStyle.left}
              top={previewStyle.top}
              onClose={closePanels}
              onChanged={load}
              onOpenSidePanel={openSidePanel}
              readOnly={!canEdit}
            />
          )}
          </div>
        )}

        {!tabularMode && selectedNodeId && !fullscreenMode && (
          <NodeEditor
            nodeId={selectedNodeId}
            nodes={nodes}
            onChanged={editMode ? () => {} : load}
            onClose={closePanels}
            onOpenCanvas={onOpenCanvas}
            editMode={editMode}
            readOnly={!canEdit}
            onDeleteNode={onDeleteNode}
            onMergeNode={stageMerge}
            onImportCanvas={() => { setImportContext({ parentId: selectedNodeId, nodeId: selectedNodeId }); setImportModalOpen(true); }}
            refreshSignal={panelRefresh}
            width={panelWidth}
            onResize={setPanelWidth}
            tempNode={
              nodes.find((n) => n.id === selectedNodeId && String(n.id).startsWith('tmp-')) || null
            }
          />
        )}
      </div>

      {focusMode && !fullscreenMode && (
        <div className="focus-bar">
          <span className="focus-bar-title">🎯 Focus</span>
          <FocusSearch canvasId={canvasId} onSelect={handleFocusSelect} />
          {focusedNodeIds.length === 0 && (
            <span className="focus-bar-hint">or drag a node here</span>
          )}
          {focusedNodeIds.map((id) => {
            const n = nodes.find((x) => x.id === id);
            return (
              <span key={id} className="focus-chip">
                <span className="focus-chip-label">{n ? n.data.label : 'Node'}</span>
                <button className="focus-chip-x" title="Remove focus" onClick={() => removeFocus(id)}>
                  ✕
                </button>
              </span>
            );
          })}
          {editMode ? (
            <>
              <button className="btn btn-sm" onClick={undo} disabled={!undoStack.length} title="Undo (Ctrl+Z)">
                ↶
              </button>
              <button className="btn btn-sm" onClick={redo} disabled={!redoStack.length} title="Redo (Ctrl+A)">
                ↷
              </button>
              <button className="btn btn-sm" onClick={enterAlignMode} title="Depth Aligner">
                ↔
              </button>
              <button className="btn btn-sm btn-primary" onClick={saveEdit}>
                💾 Save
              </button>
              <button className="btn btn-sm" onClick={cancelEdit}>
                ✖ Cancel
              </button>
            </>
          ) : (
            canEdit && (
              <button className="btn btn-sm btn-edit" onClick={enterEditMode}>
                ✏️ Edit
              </button>
            )
          )}
          <button
            className="btn btn-sm focus-exit"
            onClick={() => {
              setFocusMode(false);
              setFocusedNodeIds([]);
            }}
          >
            ✖ Exit Focus
          </button>
        </div>
      )}

      {fullscreenMode && (
        <button className="btn fullscreen-exit" onClick={() => setFullscreenMode(false)} title="Exit Full Screen" aria-label="Exit Full Screen">
          ✕
        </button>
      )}
    </div>
  );
}

