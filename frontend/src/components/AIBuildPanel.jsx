import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { renderMarkdown } from '../markdown';
import MicButton from './MicButton';
import AiModelBadge from './AiModelBadge';
import { getAiModel } from '../aiModel';

export default function AIBuildPanel({ canvasId, selectedNode, nodes, onBuilt, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState('');
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [targetNodeId, setTargetNodeId] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [chats, setChats] = useState([]);
  const [showChats, setShowChats] = useState(false);

  // Aggregate study context from ALL nodes' titles + descriptions.
  const buildContext = () => {
    const list = (nodes || [])
      .slice()
      .sort((a, b) => (((a.data && a.data.depth) || 0) - ((b.data && b.data.depth) || 0)));
    const body = list
      .map((n) => {
        const label = (n.data && n.data.label) || n.label || '';
        const content = (n.data && n.data.content) || n.content || '';
        return `Title: ${label}\nDescription: ${content || '(no description)'}`;
      })
      .join('\n\n');
    const intro =
      'The study context below is derived from a mind-map knowledge graph. ' +
      'Topics are listed in tree order — starting with the root topic, then its child topics, then their children, and so on. ' +
      'Each topic has a Title followed by its Description.';
    return `${intro}\n\n${body}`;
  };

  const loadChats = async () => {
    try {
      setChats(await api.listCanvasChats(canvasId));
    } catch (e) {
      // ignore — chat history is optional
    }
  };

  useEffect(() => {
    setContext(buildContext());
    loadChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const respond = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError('');
    setResponse('');
    setCopied(false);
    try {
      const r = await api.respond(prompt.trim(), context, getAiModel(), canvasId);
      setResponse(r.answer);
      loadChats();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const buildMap = async () => {
    if (!response.trim() || mapBusy) return;
    setMapBusy(true);
    setError('');
    try {
      await api.aiBuild(canvasId, response.trim(), selectedNode ? selectedNode.id : null, getAiModel());
      await onBuilt();
      onClose();
    } catch (e) {
      setError(e.message);
      setMapBusy(false);
    }
  };

  const copyToNode = async () => {
    if (!targetNodeId || !response.trim() || copyBusy) return;
    setCopyBusy(true);
    setError('');
    try {
      await api.updateNode(targetNodeId, { content: response.trim() });
      setCopied(true);
      await onBuilt();
    } catch (e) {
      setError(e.message);
    } finally {
      setCopyBusy(false);
    }
  };

  const sortedNodes = useMemo(() => {
    return (nodes || [])
      .slice()
      .sort((a, b) => (((a.data && a.data.depth) || 0) - ((b.data && b.data.depth) || 0)));
  }, [nodes]);

  const openChat = (chat) => {
    setPrompt(chat.question);
    setResponse(chat.answer);
    setCopied(false);
  };

  const toggleChats = async () => {
    if (showChats) {
      setShowChats(false);
    } else {
      await loadChats();
      setShowChats(true);
    }
  };

  return (
    <div className="ai-panel">
      <div className="ai-panel-header">
        <div className="ai-panel-title">
          <strong>🤖 Ask AI</strong>
          <AiModelBadge />
        </div>
        <button className="btn btn-ghost" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="ai-panel-body">
        <div className="ai-context">
          <div className="ai-context-label">
            <span>Study context (all topics — editable)</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setContext(buildContext())} title="Re-syncs the context to the latest nodes (includes new nodes, removes deleted ones)">↺ Reset</button>
          </div>
          <textarea
            rows={5}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Aggregated titles and descriptions of all nodes."
          />
        </div>
        <div className="voice-field">
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask anything, or describe the map you want…"
          />
          <MicButton onText={(t) => setPrompt((v) => (v ? v + ' ' + t : t))} />
        </div>
        {error && <div className="ai-error">{error}</div>}
        <button className="btn btn-primary" onClick={respond} disabled={busy || !prompt.trim()}>
          {busy ? 'Generating…' : 'Generate response'}
        </button>

        {response && (
          <>
            <div className="ai-answer">{renderMarkdown(response)}</div>
            <div className="ai-answer-actions">
              <button className="btn btn-sm btn-primary" onClick={buildMap} disabled={mapBusy}>
                {mapBusy ? 'Building map…' : '🗺️ Generate map from response'}
              </button>
            </div>
            <div className="ai-copy-row">
              <select
                className="ai-node-select"
                value={targetNodeId}
                onChange={(e) => setTargetNodeId(e.target.value)}
              >
                <option value="">Select a node to copy into…</option>
                {sortedNodes.map((n) => {
                  const label = (n.data && n.data.label) || n.label || '';
                  const depth = (n.data && n.data.depth) || 0;
                  return (
                    <option key={n.id} value={n.id}>
                      {'  '.repeat(Math.min(depth, 6))}{label}
                    </option>
                  );
                })}
              </select>
              <button className="btn btn-sm" onClick={copyToNode} disabled={copyBusy || !targetNodeId}>
                {copyBusy ? 'Copying…' : '📋 Copy to node'}
              </button>
            </div>
            {copied && <div className="muted">✓ Copied to node description.</div>}
          </>
        )}

        <button className="btn btn-sm view-chats-btn" onClick={toggleChats}>
          {showChats ? 'Hide previous chats' : '📜 View Previous Chats'}
        </button>
        {showChats && (
          <div className="chat-history">
            {chats.length === 0 && <div className="muted">No previous chats for this canvas.</div>}
            {chats.map((c) => (
              <div key={c.id} className="chat-item" onClick={() => openChat(c)}>
                <div className="chat-q">Q: {c.question}</div>
                <div className="chat-meta">{new Date(c.created_at).toLocaleString()} · {c.author}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
