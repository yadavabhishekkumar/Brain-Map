import { AI_MODELS, getAiModel } from '../aiModel';

export default function AiModelBadge() {
  const model = AI_MODELS.find((m) => m.id === getAiModel());
  return (
    <span className="ai-model-badge" title="The AI model used for this feature">
      🤖 {model ? model.label : 'DeepSeek'}
    </span>
  );
}
