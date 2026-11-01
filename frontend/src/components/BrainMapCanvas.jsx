import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  useReactFlow, useViewport, useNodesState, useEdgesState, applyNodeChanges, applyEdgeChanges, MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from '../api';
import MindMapNode from './MindMapNode';
import NodeEditor from './NodeEditor';
import SearchBar from './SearchBar';
import LinkCanvasModal from './LinkCanvasModal';
import AIBuildPanel from './AIBuildPanel';
import NodePreview from './NodePreview';

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

// Simple left-to-right tree layout
function autoLayout(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map();
  const roots = [];
  nodes.forEach((n) => {
    const pid = n.data && n.data.parent_id;
    if (pid && byId.has(pid)) {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(n.id);
    } else {
      roots.push(n.id);
    }
  });
  const V_GAP = 90;
  const H_GAP = 260;
  const subtreeHeight = (id) => {
    const kids = children.get(id) || [];
    if (kids.length === 0) return V_GAP;
    return kids.reduce((s, k) => s + subtreeHeight(k), 0);
  };
  const positions = {};
  const place = (id, x, yTop) => {
    const kids = children.get(id) || [];
    const h = subtreeHeight(id);
    positions[id] = { x, y: yTop + h / 2 };
    let cy = yTop;
    for (const k of kids) {
      place(k, x + H_GAP, cy);
      cy += subtreeHeight(k);
    }
  };
  let rootY = 0;
  for (const r of roots) {
    place(r, 0, rootY);
    rootY += subtreeHeight(r) + V_GAP;
  }
  return nodes.map((n) => ({ ...n, position: positions[n.id] || n.position }));
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [panelWidth, setPanelWidth] = useState(360);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const viewport = useViewport();
  const zoom = viewport.zoom;
  const { setCenter, fitView } = useReactFlow();
  const didFit = useRef(false);
  const clickTimer = useRef(null);
  const baselineRef = useRef(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [focusMode, setFocusMode] = useState(false);
  const [focusedNodeIds, setFocusedNodeIds] = useState([]);
  const [studyMode, setStudyMode] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getCanvas(canvasId);
      setNodes(data.nodes.map(toNode));
      setEdges(
        data.edges.map((e) => ({
          id: e.id,
          source: e.source_id,
          target: e.target_id,
          label: e.label || '',
        }))
      );
    } catch (e) {
      console.error(e);
      alert('Failed to load canvas: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [canvasId, setNodes, setEdges]);

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

  const pushUndo = useCallback((entry) => {
    setUndoStack((s) => [...s, entry]);
    setRedoStack([]);
  }, []);

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
      const removedNodes = nodes.filter((n) => subtree.has(n.id));
      const removedEdges = edges.filter((e) => subtree.has(e.source) || subtree.has(e.target));
      setNodes((nds) => nds.filter((n) => !subtree.has(n.id)));
      setEdges((eds) => eds.filter((e) => !subtree.has(e.source) && !subtree.has(e.target)));
      pushUndo({ nodes: removedNodes, edges: removedEdges });
      return subtree;
    },
    [nodes, edges, setNodes, setEdges, pushUndo]
  );

  const undo = useCallback(() => {
    if (!undoStack.length) return;
    const entry = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, entry]);
    setNodes((nds) => [...nds, ...entry.nodes]);
    setEdges((eds) => [...eds, ...entry.edges]);
  }, [undoStack, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (!redoStack.length) return;
    const entry = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, entry]);
    setNodes((nds) => nds.filter((n) => !entry.nodes.some((x) => x.id === n.id)));
    setEdges((eds) => eds.filter((e) => !entry.edges.some((x) => x.id === e.id)));
  }, [redoStack, setNodes, setEdges]);

  const enterEditMode = useCallback(() => {
    baselineRef.current = makeSnapshot();
    setUndoStack([]);
    setRedoStack([]);
    setPreviewNodeId(null);
    setSelectedNodeId(null);
    setEditMode(true);
  }, [makeSnapshot]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setUndoStack([]);
    setRedoStack([]);
    baselineRef.current = null;
  }, []);

  const saveEdit = useCallback(async () => {
    const baseline = baselineRef.current;
    if (!baseline) return;
    const currIds = new Set(nodes.map((n) => n.id));
    const deletedNodes = baseline.nodes.filter((n) => !currIds.has(n.id));
    const deletedIds = new Set(deletedNodes.map((n) => n.id));
    const topmost = deletedNodes.filter(
      (n) => !(n.data && n.data.parent_id) || !deletedIds.has(n.data.parent_id)
    );
    for (const n of topmost) {
      await api.deleteNode(n.id);
    }
    const currEdgeIds = new Set(edges.map((e) => e.id));
    for (const e of baseline.edges) {
      if (!currEdgeIds.has(e.id)) await api.deleteEdge(e.id);
    }
    exitEditMode();
    setSelectedNodeId(null);
    await load();
  }, [nodes, edges, exitEditMode, load]);

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
    const pc = nodes
      .filter((n) => n.data && n.data.parent_id)
      .map((n) => ({
        id: `pc-${n.id}`,
        source: n.data.parent_id,
        target: n.id,
        type: 'smoothstep',
        deletable: false,
        style: { stroke: '#94a3b8', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      }));
    const cl = edges.map((e) => ({
      ...e,
      type: 'smoothstep',
      deletable: true,
      animated: true,
      style: { stroke: '#a855f7', strokeWidth: 1.5, strokeDasharray: '6 6' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#a855f7' },
    }));
    return [...pc, ...cl];
  }, [nodes, edges]);

  // In Focus Mode, focused nodes and ALL their descendants stay visible;
  // siblings and parents of focused nodes disappear from the canvas.
  const focusedSubtreeIds = useMemo(() => {
    if (!focusMode || focusedNodeIds.length === 0) return null;
    const set = new Set(focusedNodeIds);
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

  // Immediate children of the hovered node (highlighted).
  const hoveredChildIds = useMemo(() => {
    if (!hoveredNodeId) return new Set();
    return new Set(nodes.filter((n) => n.data && n.data.parent_id === hoveredNodeId).map((n) => n.id));
  }, [hoveredNodeId, nodes]);

  // progressive disclosure + focus mode filtering + hover highlight
  const visible = useMemo(() => {
    const threshold = depthThreshold(zoom);
    const scale = nodeScale(zoom);
    const hidden = new Set();
    const vnodes = nodes.map((n) => {
      const d = (n.data && n.data.depth) || 0;
      const op = nodeOpacity(d, threshold);
      const focusHidden = focusedSubtreeIds && !focusedSubtreeIds.has(n.id);
      if (op <= 0.03 || focusHidden) hidden.add(n.id);
      return {
        ...n,
        hidden: op <= 0.03 || focusHidden,
        style: { ...n.style, opacity: Math.max(op, 0), transition: 'opacity 200ms ease' },
        data: { ...n.data, scale, highlighted: hoveredChildIds.has(n.id) },
      };
    });
    const vedges = derivedEdges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target));
    return { nodes: vnodes, edges: vedges };
  }, [nodes, derivedEdges, zoom, focusedSubtreeIds, hoveredChildIds]);

  useEffect(() => {
    if (!loading && !didFit.current && nodes.length > 0) {
      didFit.current = true;
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 400 }));
    }
  }, [loading, nodes.length, fitView]);

  const addChild = useCallback(async () => {
    if (!selectedNodeId) {
      alert('Select a node first');
      return;
    }
    const parent = nodes.find((n) => n.id === selectedNodeId);
    if (!parent) return;
    const childCount = nodes.filter((n) => n.data && n.data.parent_id === parent.id).length;
    const node = await api.createNode(canvasId, {
      label: 'New topic',
      content: '',
      parent_id: parent.id,
      x: parent.position.x + 260,
      y: parent.position.y + childCount * 90,
    });
    setNodes((nds) => [...nds, toNode(node)]);
  }, [selectedNodeId, nodes, canvasId, setNodes]);

  const addSibling = useCallback(async () => {
    if (!selectedNodeId) {
      alert('Select a node first');
      return;
    }
    const sel = nodes.find((n) => n.id === selectedNodeId);
    if (!sel) return;
    const node = await api.createNode(canvasId, {
      label: 'New topic',
      content: '',
      parent_id: sel.data.parent_id || null,
      x: sel.position.x,
      y: sel.position.y + 90,
    });
    setNodes((nds) => [...nds, toNode(node)]);
  }, [selectedNodeId, nodes, canvasId, setNodes]);

  const addRoot = useCallback(async () => {
    const node = await api.createNode(canvasId, {
      label: 'New central topic',
      content: '',
      parent_id: null,
      x: 0,
      y: nodes.length * 90,
    });
    setNodes((nds) => [...nds, toNode(node)]);
  }, [canvasId, nodes.length, setNodes]);

  const handleConnect = useCallback(
    async (connection) => {
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
    [canvasId, setEdges]
  );

  const addFocus = useCallback((id) => {
    setFocusedNodeIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }, []);

  const removeFocus = useCallback((id) => {
    setFocusedNodeIds((ids) => ids.filter((x) => x !== id));
  }, []);

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
      api.updateNode(node.id, { x: node.position.x, y: node.position.y }).catch(console.error);
    },
    [focusMode, addFocus, load, fitView]
  );

  const handleEdgesDelete = useCallback(
    (deleted) => {
      if (editMode) {
        pushUndo({ nodes: [], edges: deleted });
        return;
      }
      deleted.forEach((e) => {
        if (!e.id.startsWith('pc-')) api.deleteEdge(e.id).catch(console.error);
      });
    },
    [editMode, pushUndo]
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

  const autoLayoutAndSave = useCallback(async () => {
    const layouted = autoLayout(nodes);
    setNodes(layouted);
    await Promise.allSettled(
      layouted.map((n) => api.updateNode(n.id, { x: n.position.x, y: n.position.y }))
    );
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 500 }));
  }, [nodes, setNodes, fitView]);

  const focusNode = useCallback(
    (id) => {
      clearTimeout(clickTimer.current);
      setSelectedNodeId(id);
      setPreviewNodeId(null);
      const n = nodes.find((x) => x.id === id);
      if (n) {
        const sx = n.position.x * zoom + viewport.x;
        const available = window.innerWidth - sx - 60;
        setPanelWidth(Math.max(280, Math.min(520, available)));
        setCenter(n.position.x, n.position.y, { zoom: 1.6, duration: 800 });
      }
    },
    [nodes, setCenter, zoom, viewport.x]
  );

  const closePanels = useCallback(() => {
    clearTimeout(clickTimer.current);
    setPreviewNodeId(null);
    setSelectedNodeId(null);
  }, []);

  const handlePaneClick = useCallback(() => {
    closePanels();
  }, [closePanels]);

  // Single click -> read-only preview (after a short delay so a double-click wins).
  const handleNodeClick = useCallback((e, node) => {
    clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      setPreviewNodeId(node.id);
      setSelectedNodeId(null);
    }, 220);
  }, []);

  // Double click -> editable side panel.
  const handleNodeDoubleClick = useCallback(
    (e, node) => {
      clearTimeout(clickTimer.current);
      setPreviewNodeId(null);
      setSelectedNodeId(node.id);
      // Default panel width depends on where the node sits on screen.
      const sx = node.position.x * zoom + viewport.x;
      const available = window.innerWidth - sx - 60;
      setPanelWidth(Math.max(280, Math.min(520, available)));
    },
    [zoom, viewport.x]
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
    const sx = previewNode.position.x * zoom + viewport.x;
    const sy = previewNode.position.y * zoom + viewport.y;
    previewStyle = {
      left: Math.max(8, Math.min(sx + 150, Math.max(8, window.innerWidth - 430))),
      top: Math.max(8, Math.min(sy - 24, Math.max(8, window.innerHeight - 440))),
    };
  }

  return (
    <div className={`canvas-shell${editMode ? ' edit-mode' : ''}${studyMode ? ' study-mode' : ''}${focusMode ? ' focus-mode' : ''}`}>
      <div className="canvas-topbar">
        <button className="btn" onClick={onBack}>
          ← Canvases
        </button>
        <div className="canvas-title">{canvasName}</div>
        <div className="topbar-actions">
          {!editMode ? (
            <>
              <button className="btn" onClick={() => setSearchOpen((o) => !o)}>
                🔍 Search
              </button>
              <button className="btn" onClick={() => fitView({ padding: 0.2 })}>
                Fit view
              </button>
              <button className="btn" onClick={autoLayoutAndSave}>
                Auto layout
              </button>
              <button className="btn" onClick={() => setLinkModalOpen(true)}>
                🔗 Link canvas
              </button>
              <button className="btn" onClick={() => setAiPanelOpen((o) => !o)}>
                🤖 AI
              </button>
              <button className="btn btn-edit" onClick={enterEditMode}>
                ✏️ Edit
              </button>
              <button
                className="btn btn-focus"
                onClick={() => {
                  setFocusedNodeIds([]);
                  setFocusMode(true);
                }}
              >
                🎯 Focus Mode
              </button>
              <button className="btn" onClick={() => setStudyMode(true)}>
                🖥 Study Mode
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={undo} disabled={!undoStack.length} title="Undo (Ctrl+Z)">
                ↶ Undo
              </button>
              <button className="btn" onClick={redo} disabled={!redoStack.length} title="Redo (Ctrl+A)">
                ↷ Redo
              </button>
              <button className="btn btn-primary" onClick={saveEdit}>
                💾 Save
              </button>
              <button className="btn" onClick={cancelEdit}>
                ✖ Cancel
              </button>
            </>
          )}
        </div>
      </div>

      <div className="canvas-body">
        <div className="canvas-flow">
          <ReactFlow
            nodes={visible.nodes}
            edges={visible.edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            onNodeMouseEnter={(e, node) => setHoveredNodeId(node.id)}
            onNodeMouseLeave={() => setHoveredNodeId(null)}
            onNodeDragStop={handleNodeDragStop}
            onEdgesDelete={handleEdgesDelete}
            onNodesDelete={handleNodesDelete}
            onPaneClick={handlePaneClick}
            minZoom={0.2}
            maxZoom={2.5}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            deleteKeyCode={editMode ? ['Backspace', 'Delete'] : null}
            nodesDraggable={!editMode}
            nodesConnectable={!editMode}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={editMode ? '#f59e0b' : '#cbd5e1'} />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => (n.data && n.data.isRoot ? '#6d28d9' : '#818cf8')}
              maskColor="rgba(241,245,249,0.7)"
            />
          </ReactFlow>

          {!studyMode && (
            <div className="canvas-toolbar">
              {!editMode ? (
                <>
                  <button className="btn btn-primary" onClick={addChild}>
                    ＋ Child
                  </button>
                  <button className="btn" onClick={addSibling}>
                    ＋ Sibling
                  </button>
                  <button className="btn" onClick={addRoot}>
                    ＋ Root
                  </button>
                  <span className="toolbar-hint">Drag between nodes to connect topics</span>
                </>
              ) : (
                <span className="toolbar-hint edit-hint">
                  ✏️ Edit mode — click a node and press Delete (or use the panel). Ctrl+Z / Ctrl+A to undo / redo.
                </span>
              )}
            </div>
          )}

          {!studyMode && searchOpen && (
            <SearchBar canvasId={canvasId} onFocus={focusNode} onClose={() => setSearchOpen(false)} />
          )}

          {!studyMode && linkModalOpen && (
            <LinkCanvasModal
              currentCanvasId={canvasId}
              parentId={selectedNodeId}
              onClose={() => setLinkModalOpen(false)}
              onLinked={load}
            />
          )}

          {!studyMode && aiPanelOpen && (
            <AIBuildPanel
              canvasId={canvasId}
              selectedNode={nodes.find((n) => n.id === selectedNodeId) || null}
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
            />
          )}
        </div>

        {selectedNodeId && !studyMode && (
          <NodeEditor
            nodeId={selectedNodeId}
            nodes={nodes}
            onChanged={editMode ? () => {} : load}
            onClose={closePanels}
            onOpenCanvas={onOpenCanvas}
            editMode={editMode}
            onDeleteNode={onDeleteNode}
            width={panelWidth}
            onResize={setPanelWidth}
          />
        )}
      </div>

      {focusMode && !studyMode && (
        <div className="focus-bar">
          <span className="focus-bar-title">🎯 Focus</span>
          {focusedNodeIds.length === 0 && (
            <span className="focus-bar-hint">Drag a node here to focus on it</span>
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

      {studyMode && (
        <button className="btn study-exit" onClick={() => setStudyMode(false)}>
          ✕ Exit Study Mode
        </button>
      )}
    </div>
  );
}

