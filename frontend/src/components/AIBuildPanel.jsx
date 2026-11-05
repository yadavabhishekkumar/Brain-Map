import { useState } from 'react';
import { api } from '../api';
import MicButton from './MicButton';
import AiModelBadge from './AiModelBadge';
import { getAiModel } from '../aiModel';

export default function AIBuildPanel({ canvasId, selectedNode, onBuilt, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const build = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.aiBuild(canvasId, prompt.trim(), selectedNode ? selectedNode.id : null, getAiModel());
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
        <div className="ai-panel-title">
          <strong>🤖 Build your brain map with AI</strong>
          <AiModelBadge />
        </div>
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
        <div className="voice-field">
          <textarea
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Create a mind map for Indian Polity: Constitution, Parliament, Judiciary, Fundamental Rights, DPSP…"
          />
          <MicButton onText={(t) => setPrompt((v) => (v ? v + ' ' + t : t))} />
        </div>
        {error && <div className="ai-error">{error}</div>}
        <button className="btn btn-primary" onClick={build} disabled={busy || !prompt.trim()}>
          {busy ? 'Generating…' : 'Generate map'}
        </button>
      </div>
    </div>
  );
}
