import { useEffect, useState } from 'react';
import { AI_MODELS, getAiModel, setAiModel, subscribeAiModel } from '../aiModel';

export default function AiModelBadge() {
  const [model, setModel] = useState(getAiModel());

  useEffect(() => subscribeAiModel((id) => setModel(id)), []);

  return (
    <select
      className="ai-model-badge"
      value={model}
      title="Switch the AI model used for this feature"
      onChange={(e) => setAiModel(e.target.value)}
    >
      {AI_MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          🤖 {m.label}
        </option>
      ))}
    </select>
  );
}
