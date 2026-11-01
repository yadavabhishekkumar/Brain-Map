import { useState } from 'react';
import { api } from '../api';

export default function AIBuildPanel({ canvasId, selectedNode, onBuilt, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const build = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.aiBuild(canvasId, prompt.trim(), selectedNode ? selectedNode.id : null);
      await onBuilt();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-panel">
      <div className="ai-panel-header">
        <strong>🤖 Build your brain map with AI</strong>
        <button className="btn btn-ghost" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="ai-panel-body">
        <p className="muted">
          {selectedNode
            ? `New topics will be added under “${selectedNode.data?.label || 'the selected node'}”.`
            : 'New topics will be added as a central topic.'}
        </p>
        <textarea
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Create a mind map for Indian Polity: Constitution, Parliament, Judiciary, Fundamental Rights, DPSP…"
        />
        {error && <div className="ai-error">{error}</div>}
        <button className="btn btn-primary" onClick={build} disabled={busy || !prompt.trim()}>
          {busy ? 'Generating…' : 'Generate map'}
        </button>
      </div>
    </div>
  );
}
